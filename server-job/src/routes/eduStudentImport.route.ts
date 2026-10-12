/**
 * 学生导入路由
 *
 * 提供两个接口：
 *   1. GET  /api/edu/student/import-template  → 下载导入模板（带一行示例）
 *   2. POST /api/edu/student/import           → 上传 Excel/CSV，解析后入库
 *
 * ⚠️ 设计要点：
 *   - 表头用中文，业务老师可以直接照着原型表格的列名填写
 *   - 枚举列（性别/部门/学生状态/学习阶段）既认中文也认数字，容错
 *   - 一行出错不影响其他行，最后返回「成功几条 / 失败几条 / 每行为什么失败」
 *   - 学号重复的行跳过，不覆盖已有学生（防止误改真实数据）
 */

import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import {
  BizCode,
  Gender,
  DeptCode,
  StudentStatus,
  GENDER_NAME,
  DEPT_NAME,
  STUDENT_STATUS_NAME,
  STAGE_NAME,
} from 'shared-types/edu';
import { ok } from '../utils/response';
import { db } from '../utils/db';
import { wrap } from '../utils/wrap';
import { checkPermission } from '../middleware/auth';
import { BizError } from '../middleware/errorHandler';

export const studentImportRouter = Router();

const TABLE = 'sms_edu.t_student_base';

/* ============================================================
 * 1. 模板表头定义
 *
 * 「表头 → 解析键」的映射。中文表头业务老师看得懂，
 * 同时兼容英文/拼音写法（怕有人从别的系统导出）。
 * ============================================================ */

type FieldKey =
  | 'studentName'
  | 'studentNo'
  | 'gender'
  | 'age'
  | 'dept'
  | 'className'
  | 'phone'
  | 'parentPhone'
  | 'dormNo'
  | 'enrollDate'
  | 'education'
  | 'attendanceRate'
  | 'lastClassCount'
  | 'studentStatus'
  | 'stage'
  | 'remark'
  | 'quality';

/** 表头别名表：一个字段可以有多种写法 */
const HEADER_ALIASES: Record<FieldKey, string[]> = {
  studentName: ['姓名', '学生姓名', 'name', 'studentname'],
  studentNo: ['学号', '学生学号', '编号', 'studentno', 'no'],
  gender: ['性别', 'gender', 'sex'],
  age: ['年龄', 'age'],
  dept: ['部门', '学部', '所属部门', 'dept', 'deptcode'],
  className: ['班级', '班级名称', 'class', 'classname'],
  phone: ['手机号', '手机号码', '电话', '联系电话', 'phone'],
  parentPhone: ['家长手机号', '家长电话', '家长联系方式', 'parentphone'],
  dormNo: ['宿舍号', '宿舍', '寝室号', 'dormno', 'dorm'],
  enrollDate: ['入学时间', '入学日期', '入校时间', 'enrolldate'],
  education: ['学历', 'education'],
  attendanceRate: ['出勤率', 'attendancerate'],
  lastClassCount: ['末班次数', '未班次数', 'lastclasscount'],
  studentStatus: ['学生状态', '状态', 'studentstatus', 'status'],
  stage: ['学习阶段', '阶段', 'stage'],
  remark: ['备注', 'remark'],
  quality: ['综合素养', '综合素质', '素养', '素质', 'quality'],
};

/** 模板里实际写出的表头（按顺序） */
const TEMPLATE_HEADERS: Record<FieldKey, string> = {
  studentName: '姓名',
  studentNo: '学号',
  gender: '性别',
  age: '年龄',
  dept: '部门',
  className: '班级',
  phone: '手机号',
  parentPhone: '家长手机号',
  dormNo: '宿舍号',
  enrollDate: '入学时间',
  education: '学历',
  attendanceRate: '出勤率',
  lastClassCount: '末班次数',
  studentStatus: '学生状态',
  stage: '学习阶段',
  remark: '备注',
  quality: '综合素养',
};

/** 归一化：去空格、去星号（必填标记）、转小写 */
function norm(s: string): string {
  return String(s ?? '')
    .replace(/[\s*＊]/g, '')
    .toLowerCase();
}

/** 建立 「归一化表头 → 字段键」 的查找表 */
const HEADER_LOOKUP = (() => {
  const map: Record<string, FieldKey> = {};
  for (const key of Object.keys(HEADER_ALIASES) as FieldKey[]) {
    for (const alias of HEADER_ALIASES[key]) {
      map[norm(alias)] = key;
    }
  }
  return map;
})();

/* ============================================================
 * 2. 枚举反查：中文 → 数字
 *
 * 用户在表格里可以填「男」也可以填「1」，两边都要认。
 * ============================================================ */

function buildLookup(nameMap: Record<number, string>): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [k, v] of Object.entries(nameMap)) {
    map[norm(v)] = Number(k);
    map[k] = Number(k); // 数字本身
  }
  return map;
}

const GENDER_LOOKUP = buildLookup(GENDER_NAME);
const DEPT_LOOKUP = buildLookup(DEPT_NAME);
const STATUS_LOOKUP = buildLookup(STUDENT_STATUS_NAME);
const STAGE_LOOKUP = buildLookup(STAGE_NAME);

/* ============================================================
 * 3. 单元格取值 / 格式化
 * ============================================================ */

function cell(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** 日期：可能是 Date 对象、Excel 序列号、或字符串，统一转成 YYYY-MM-DD */
function parseDate(v: any): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }

  // 纯数字 → 当作 Excel 日期序列号
  if (typeof v === 'number') {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const d = new Date(excelEpoch + v * 86400 * 1000);
    if (!Number.isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    }
  }

  const s = String(v).trim();
  if (!s) return undefined;
  const m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) {
    const p = (n: string) => n.padStart(2, '0');
    return `${m[1]}-${p(m[2])}-${p(m[3])}`;
  }
  return s;
}

/** 数字：空字符串返回 undefined，非法返回 NaN */
function parseNum(v: any): number | undefined {
  const s = cell(v);
  if (!s) return undefined;
  const n = Number(s.replace('%', ''));
  return Number.isNaN(n) ? undefined : n;
}

/* ============================================================
 * 4. 下载导入模板
 *    GET /api/edu/student/import-template
 * ============================================================ */

studentImportRouter.get(
  '/import-template',
  wrap(async (_req, res) => {
    const headers = Object.values(TEMPLATE_HEADERS);

    const sample = [
      '张伟',
      'S20260001',
      '男',
      16,
      '初高部',
      '高一1班',
      '13812345678',
      '13912345678',
      'A栋301',
      '2024-09-01',
      '初中',
      95.5,
      0,
      '正式在读',
      '高中部一期',
      '学习态度端正',
      '自律较强，理解力好，表达能力突出',
    ];

    const sheet = XLSX.utils.aoa_to_sheet([headers, sample]);
    sheet['!cols'] = headers.map((h) => ({ wch: Math.max(h.length * 2, 12) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, '学生导入模板');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const filename = encodeURIComponent('学生导入模板.xlsx');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.end(buf);
  }),
);

/* ============================================================
 * 5. 上传并导入
 *    POST /api/edu/student/import
 *    form-data: file=<xlsx|xls|csv>
 * ============================================================ */

// 文件放内存里（模板很小，没必要落盘再删）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(null, ok);
  },
});

interface RowFailure {
  row: number;
  studentNo: string;
  reason: string;
}

studentImportRouter.post(
  '/import',
  checkPermission('edu:student:add'),
  upload.single('file'),
  wrap(async (req, res) => {
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      throw new BizError(BizCode.PARAM_ERROR, '请选择要导入的文件');
    }

    // ---- 解析成二维数组 ----
    const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      throw new BizError(BizCode.PARAM_ERROR, '文件内容为空，没有可读取的工作表');
    }

    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (rows.length < 2) {
      throw new BizError(BizCode.PARAM_ERROR, '文件中没有数据行（至少要有 1 条学生记录）');
    }

    // ---- 第一行当表头，映射到字段键 ----
    const headerRow = rows[0].map((h) => norm(cell(h)));
    const colToKey: Record<number, FieldKey> = {};
    headerRow.forEach((h, idx) => {
      if (h && HEADER_LOOKUP[h]) colToKey[idx] = HEADER_LOOKUP[h];
    });

    const missing = (['studentName', 'studentNo'] as FieldKey[]).filter(
      (k) => !Object.values(colToKey).includes(k),
    );
    if (missing.length) {
      throw new BizError(
        BizCode.PARAM_ERROR,
        `表头缺少必需列：${missing.map((k) => TEMPLATE_HEADERS[k]).join('、')}。请先下载模板再填写`,
      );
    }

    // ---- 预先查出表里已有的学号，避免逐行查库 ----
    const existing = await db(TABLE).select('student_no');
    const existingSet = new Set<string>(
      existing.map((r: any) => String(r.student_no).trim().toLowerCase()),
    );

    // ---- 逐行校验 ----
    const failures: RowFailure[] = [];
    const toInsert: Record<string, any>[] = [];
    const seenInFile = new Set<string>();

    for (let i = 1; i < rows.length; i++) {
      const line = rows[i];
      const excelRow = i + 1; // 给用户看的行号（含表头）

      // ⚠️ 这里保留原始值（Date / number / string），不要提前 String()，
      //    否则 Excel 的日期对象会被转成 "Mon Sep 01 2024..." 这种无法入库的字符串
      const raw: Partial<Record<FieldKey, any>> = {};
      for (const [idxStr, key] of Object.entries(colToKey)) {
        raw[key] = line[Number(idxStr)];
      }

      const studentName = cell(raw.studentName);
      const studentNo = cell(raw.studentNo);

      // 空行跳过
      if (!studentName && !studentNo) continue;

      if (!studentName) {
        failures.push({ row: excelRow, studentNo, reason: '姓名不能为空' });
        continue;
      }
      if (!studentNo) {
        failures.push({ row: excelRow, studentNo, reason: '学号不能为空' });
        continue;
      }

      // 性别（默认男）
      let gender = Gender.MALE;
      if (raw.gender) {
        const g = GENDER_LOOKUP[norm(raw.gender)];
        if (g === undefined) {
          failures.push({ row: excelRow, studentNo, reason: `性别「${raw.gender}」无法识别，请填 男/女` });
          continue;
        }
        gender = g;
      }

      // 部门（默认当前初高部）
      let deptCode = DeptCode.JUNIOR_SENIOR;
      if (raw.dept) {
        const d = DEPT_LOOKUP[norm(raw.dept)];
        if (d === undefined) {
          failures.push({ row: excelRow, studentNo, reason: `部门「${raw.dept}」无法识别，请填 初高部/大学部` });
          continue;
        }
        deptCode = d;
      }

      // 学生状态（默认待咨询）
      let studentStatus = StudentStatus.WAIT_CONSULT;
      if (raw.studentStatus) {
        const s = STATUS_LOOKUP[norm(raw.studentStatus)];
        if (s === undefined) {
          failures.push({
            row: excelRow,
            studentNo,
            reason: `学生状态「${raw.studentStatus}」无法识别，请参照模板填写`,
          });
          continue;
        }
        studentStatus = s;
      }

      // 学习阶段（可空）
      let stage: number | null = null;
      if (raw.stage) {
        const st = STAGE_LOOKUP[norm(raw.stage)];
        if (st === undefined) {
          failures.push({ row: excelRow, studentNo, reason: `学习阶段「${raw.stage}」无法识别，请参照模板填写` });
          continue;
        }
        stage = st;
      }

      // 学号重复（库里已有 / 文件内重复）
      const noKey = studentNo.toLowerCase();
      if (existingSet.has(noKey) || seenInFile.has(noKey)) {
        failures.push({ row: excelRow, studentNo, reason: `学号 ${studentNo} 已存在，已跳过` });
        continue;
      }
      seenInFile.add(noKey);

      // ⚠️ 入学时间单独走 parseDate（raw 里保留着 Date 对象），其余文本列统一 cell()
      const enrollDate = parseDate(raw.enrollDate);
      const attendance = parseNum(raw.attendanceRate);
      const lastClass = parseNum(raw.lastClassCount);
      const age = parseNum(raw.age);

      toInsert.push({
        id: randomUUID(),
        student_no: studentNo,
        student_name: studentName,
        gender,
        age: age ?? null,
        dept_code: deptCode,
        class_name: cell(raw.className) || null,
        phone: cell(raw.phone) || null,
        parent_phone: cell(raw.parentPhone) || null,
        dorm_no: cell(raw.dormNo) || null,
        education: cell(raw.education) || null,
        enroll_date: enrollDate ?? null,
        attendance_rate: attendance ?? null,
        last_class_count: lastClass ?? 0,
        stage,
        student_status: studentStatus,
        remark: cell(raw.remark) || null,
        quality: cell(raw.quality) || null,
        is_deleted: false,
        create_time: new Date(),
        create_by: req.user?.userId || 'system',
      });
    }

    // ---- 批量入库 ----
    let successCount = 0;
    if (toInsert.length) {
      await db.transaction(async (trx) => {
        // MySQL 参数上限，分批插
        for (let i = 0; i < toInsert.length; i += 200) {
          await trx(TABLE).insert(toInsert.slice(i, i + 200));
        }
      });
      successCount = toInsert.length;
    }

    if (successCount === 0 && failures.length === 0) {
      throw new BizError(BizCode.PARAM_ERROR, '没有解析到任何有效数据行');
    }

    res.json(
      ok(
        {
          successCount,
          failCount: failures.length,
          failures: failures.slice(0, 50), // 最多回传 50 条，避免响应过大
        },
        failures.length
          ? `导入完成：成功 ${successCount} 条，失败 ${failures.length} 条`
          : `导入成功，共 ${successCount} 条`,
      ),
    );
  }),
);

export default studentImportRouter;
