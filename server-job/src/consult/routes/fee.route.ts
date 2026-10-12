/**
 * 收款与缴费路由
 *
 * 路径前缀：/api/consult/fee
 *
 * ⚠️ 本文件的职责：
 *    咨询侧「发起收费 → 上传缴费截图 → 看财务核对结果」
 *    真实金额与核对由财务模块（8005）决定，本模块只做发起与展示。
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { BizCode, FeeType, FEE_TYPE_NAME, DeptCode, nameOf } from 'shared-types/consult';
import { ok, page } from '../utils/response';
import { db } from '../utils/db';
import { wrap } from '../utils/wrap';
import { validate } from '../middleware/validate';
import { checkRole } from '../middleware/auth';
import { ConsultRole, FULL_FEE_TYPES } from 'shared-types/consult';
import { BizError } from '../middleware/errorHandler';
import {
  FEE_ORDER_TABLE,
  buildOrderQuery,
  toOrderView,
  getFeeStats,
  createFees,
  uploadVoucher,
  resubmitOrder,
  syncFromFinance,
  centToYuan,
} from '../services/fee-order.service';
import { financeClient } from '../services/finance.client';
import { config } from '../config';

export const feeRouter = Router();

/* ============================================================
 * 1. 收款单列表
 *    GET /api/consult/fee/list
 *
 * ⚠️ 每次列表请求会顺带从财务同步一次状态（保证核对结果及时可见）
 * ============================================================ */

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  studentName: z.string().optional(),
  ownerName: z.string().optional(),
  className: z.string().optional(),
  feeType: z.coerce.number().int().optional(),
  status: z.coerce.number().int().optional(),
  keyword: z.string().optional(),
  /** 是否跳过财务同步（默认同步；传 false 可跳过，加快响应） */
  sync: z.coerce.boolean().optional(),
});

feeRouter.get(
  '/list',
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;

    // ---- 先从财务同步状态（失败不阻断，只是状态可能滞后）----
    if (q.sync !== false) {
      try {
        await syncFromFinance();
      } catch (err) {
        console.warn('[fee/list] 财务同步失败，使用本地状态', err);
      }
    }

    const query = buildOrderQuery(q);
    const [{ total }] = await query.clone().count({ total: '*' });

    const rows = await query
      .clone()
      .select('*')
      .orderBy('create_time', 'desc')
      .limit(q.size)
      .offset((q.page - 1) * q.size);

    // ★ 2026-10-09 补学生当前咨询状态：
    //    收款单是快照，学生退费后状态变了，但「分班」按钮如果只看单据状态
    //    就仍会出现 —— 前端要按学生最新状态隐藏（已退费/退费中不可分班）。
    const stuIds = Array.from(
      new Set(rows.map((r: any) => r.consult_student_id).filter(Boolean)),
    );
    const stateMap = new Map<string, number>();
    if (stuIds.length) {
      const stus: any[] = await db('t_consult_student')
        .whereIn('id', stuIds)
        .select('id', 'consult_state');
      for (const s of stus) stateMap.set(s.id, s.consult_state);
    }

    res.json(
      page(
        rows.map((r: any) =>
          toOrderView({ ...r, consult_state: stateMap.get(r.consult_student_id) }),
        ),
        Number(total),
        q,
      ),
    );
  }),
);

/* ============================================================
 * 2. 收款统计（列表页顶部 4 张卡）
 *    GET /api/consult/fee/stats
 * ============================================================ */

feeRouter.get(
  '/stats',
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;
    res.json(ok(await getFeeStats(q)));
  }),
);

/* ============================================================
 * 3. 收款单详情
 *    GET /api/consult/fee/detail?id=xxx
 * ============================================================ */

feeRouter.get(
  '/detail',
  validate(z.object({ id: z.string().min(1) })),
  wrap(async (req, res) => {
    const { id } = (req as any).validated as { id: string };
    const row = await db(FEE_ORDER_TABLE).where({ id, is_deleted: false }).first();
    if (!row) throw new BizError(BizCode.ORDER_NOT_FOUND, '收款单不存在');
    res.json(ok(toOrderView(row)));
  }),
);

/* ============================================================
 * 4. ⭐ 发起收费
 *    POST /api/consult/fee/create
 *
 * 请求体：
 *   { consultStudentId, feeTypes: [1] 或 [1,2,3,4], payMethod }
 *
 * ⚠️ 本接口不接收 amount —— 金额一律由财务费用标准决定（规则2）
 * ============================================================ */

const createSchema = z.object({
  consultStudentId: z.string().min(1, '必须传学生 id'),
  feeTypes: z.array(z.coerce.number().int().min(1).max(5)).min(1, '至少选择一个费用类型'),
  payMethod: z.string().max(20).optional(),
});

feeRouter.post(
  '/create',
  validate(createSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof createSchema>;
    const operator = req.user!;

    const result = await createFees(
      body.consultStudentId,
      body.feeTypes as FeeType[],
      { name: operator.userName, title: operator.roleTitle },
      body.payMethod,
    );

    res.json(ok(result, result.message));
  }),
);

/* ============================================================
 * 5. ⭐ 上传缴费截图
 *    POST /api/consult/fee/upload-voucher
 *
 * ⚠️ 业务规则（用户已确认）：
 *    凭证由咨询侧上传，财务只负责核对，不额外增加审查环节。
 *    如财务发现凭证有问题，在核对页「打回」，本模块状态变「已驳回」，
 *    咨询侧可重传后「重新提交」。
 * ============================================================ */

const voucherSchema = z.object({
  orderId: z.string().min(1, '必须传收款单 id'),
  voucherUrl: z.string().min(1, '必须传凭证图片地址'),
  voucherNo: z.string().max(100).optional(),
});

feeRouter.post(
  '/upload-voucher',
  validate(voucherSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof voucherSchema>;
    const operator = req.user!;

    await uploadVoucher(body.orderId, body.voucherUrl, body.voucherNo, {
      name: operator.userName,
      title: operator.roleTitle,
    });

    res.json(ok(null, '缴费截图已上传，等待财务核对'));
  }),
);

/* ============================================================
 * 6. 上传图片文件（拿到可存库的 URL）
 *    POST /api/consult/fee/upload-file
 *
 * ⚠️ 实现说明：
 *    演示环境用 base64 传图（前端 el-upload 设 auto-upload=false 后转 base64），
 *    后端解码写文件到 uploads/voucher/ 并返回相对 URL。
 *    这样不依赖 multer，避免多加一个依赖。
 *
 *    生产环境建议改成 multer + 对象存储。
 * ============================================================ */

const uploadFileSchema = z.object({
  /** data:image/png;base64,xxxx */
  dataUrl: z.string().min(1, '必须传图片数据'),
  /** 文件名前缀，便于识别 */
  prefix: z.string().max(50).optional(),
});

feeRouter.post(
  '/upload-file',
  validate(uploadFileSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof uploadFileSchema>;

    const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(body.dataUrl);
    if (!m) {
      throw new BizError(BizCode.FORMAT_ERROR, '只支持 PNG / JPG / GIF / WEBP 格式的图片');
    }

    const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
    const buffer = Buffer.from(m[2], 'base64');

    // ⚠️ 限制 5MB，防止上传大文件把服务打挂
    if (buffer.length > 5 * 1024 * 1024) {
      throw new BizError(BizCode.PARAM_ERROR, '图片不能超过 5MB，请压缩后重试');
    }

    const fileName = `${body.prefix || 'voucher'}_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
    const uploadDir = path.resolve(process.cwd(), 'uploads/voucher');

    // 确保目录存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    fs.writeFileSync(path.join(uploadDir, fileName), buffer);

    /*
     * ⚠️ 双写财务侧 uploads 目录（跨模块图片共享）
     *
     * 问题：`<img src>` 带不上 Authorization 头，凭证图片必须走静态托管；
     *      而财务侧的 express.static 只映射自己项目下的 uploads 目录，
     *      访问不到咨询侧的文件 —— 财务在核对页就看不到截图。
     *
     * 解决：本地开发两个服务同机，上传时把文件同步写一份到财务目录，
     *      两边用同一个相对路径 /uploads/voucher/xxx.jpg，都能访问。
     *
     * ⚠️ 生产环境应改为对象存储（OSS / COS），把图片地址存成绝对 URL，
     *    两端直接访问同一个 CDN 地址，就不需要双写了。
     */
    const financeUploadDir = config.services.financeUploadDir
      ? path.resolve(__dirname, '../../', config.services.financeUploadDir)
      : '';
    if (financeUploadDir) {
      try {
        const target = path.join(financeUploadDir, 'voucher');
        if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, fileName), buffer);
      } catch (err: any) {
        // 双写失败不阻断上传：本地已有文件，只是财务侧暂时看不到，
        // 记一条日志方便排查（财务侧核对页看不到凭证时好定位）。
        console.warn('[upload-file] 同步到财务 uploads 目录失败:', err?.message);
      }
    }

    // 返回相对 URL（前端拼上 base 或用代理访问）
    const url = `/uploads/voucher/${fileName}`;
    res.json(ok({ url, size: buffer.length }, '上传成功'));
  }),
);

/* ============================================================
 * 7. 被驳回后重新提交
 *    POST /api/consult/fee/resubmit
 * ============================================================ */

feeRouter.post(
  '/resubmit',
  validate(z.object({ orderId: z.string().min(1) })),
  wrap(async (req, res) => {
    const { orderId } = (req as any).validated as { orderId: string };
    const operator = req.user!;

    await resubmitOrder(orderId, { name: operator.userName, title: operator.roleTitle });
    res.json(ok(null, '已重新提交，等待财务核对'));
  }),
);

/* ============================================================
 * 8. ⭐ 取费用标准（转发财务接口）
 *    GET /api/consult/fee/standard?feeType=1&deptCode=1
 *
 * ⚠️ 为什么不给前端直接调财务？
 *    ① 跨域（前端 5174 → 财务 8005）
 *    ② 超时兜底要统一做
 * ============================================================ */

feeRouter.get(
  '/standard',
  validate(
    z.object({
      feeType: z.coerce.number().int().min(1).max(5),
      deptCode: z.coerce.number().int().min(1).max(2).default(1),
    }),
  ),
  wrap(async (req, res) => {
    const { feeType, deptCode } = (req as any).validated as {
      feeType: number;
      deptCode: number;
    };
    const std = await financeClient.getStandard(feeType as FeeType, deptCode as DeptCode);
    res.json(ok(std));
  }),
);

/* ============================================================
 * 9. ⭐ 批量取费用标准（转正式弹窗预览金额）
 *    GET /api/consult/fee/standard-batch?deptCode=1
 * ============================================================ */

feeRouter.get(
  '/standard-batch',
  validate(
    z.object({
      deptCode: z.coerce.number().int().min(1).max(2).default(1),
      feeTypes: z.string().optional(),
    }),
  ),
  wrap(async (req, res) => {
    const q = (req as any).validated as { deptCode: number; feeTypes?: string };
    const feeTypes = q.feeTypes
      ? (q.feeTypes.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n)) as FeeType[])
      : FULL_FEE_TYPES;

    const result = await financeClient.getStandardBatch(feeTypes, q.deptCode as DeptCode);
    res.json(ok(result));
  }),
);

/* ============================================================
 * 10. 财务模块健康检查（前端显示「财务服务是否在线」）
 *     GET /api/consult/fee/finance-health
 * ============================================================ */

feeRouter.get(
  '/finance-health',
  wrap(async (_req, res) => {
    const online = await financeClient.health();
    res.json(
      ok(
        { online },
        online ? '财务模块在线' : '财务模块未启动或不可达（请确认 8005 端口服务已启动）',
      ),
    );
  }),
);

export default feeRouter;
