/**
 * 初始化「教学域统一配置表」t_teaching_conf（sms_common）
 * ============================================================
 *
 * 做两件事（都可重复执行，幂等）：
 *   ① 建表（复用迁移文件里的 up()，已存在则跳过）
 *   ② 灌入两条默认配置：attendance.statusMap / attendance.scope
 *
 * 【为什么要单独一个脚本，而不是直接 npm run migrate】
 *   `npm run migrate` 会连带跑其它所有待执行迁移，动静大。
 *   这里只处理本表，安全、可重复。
 *
 * 用法：
 *   cd server-job
 *   node scripts/seed-teaching-conf.cjs
 *
 * ⚠️ 这里的两份 JSON 必须与 src/teaching/shared/conf.ts 的 DEFAULT_* 保持一致。
 *    代码里那份是"表读不到时的兜底"，这里这份是"落库留痕、方便人工核对与修改"。
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const knex = require('knex');
const { randomUUID } = require('crypto');
const migration = require('../migrations-class-common/20261009_001_create_teaching_conf.js');

const CONN = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME_COMMON || 'sms_common',
  charset: 'utf8mb4',
  timezone: '+08:00',
};

const db = knex({ client: 'mysql2', connection: CONN, pool: { min: 0, max: 4 } });

/** 出勤状态码映射：学段 → { 原始码: 统一码 } */
const STATUS_MAP = {
  jh: { 1: 1, 2: 3, 3: 7, 4: 6, 5: 2 },
  class: {},
  job: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 },
};

/** 出勤口径：应到/实到怎么算 + 未达标线 + 是否手工填人数 */
const SCOPE = {
  jh: { shouldStatuses: [3, 4, 5], presentStatuses: [1, 3], targetRate: 90, manualInput: false },
  class: { shouldStatuses: [], presentStatuses: [], targetRate: 90, manualInput: true },
  job: { shouldStatuses: 'all', presentStatuses: [1, 3, 4], targetRate: 90, manualInput: false },
};

/**
 * 成绩公式（★ 三套真的不一样）
 *   jh    综合 = 笔试+机试+面试+其他（直接求和），再按「总分 ≥ 满分×0.6」判定通过
 *   class 综合 = 笔试×50% + 面试×50%（缺项按 0 计）
 *   job   笔试均分 = 卷面×50% + 机试×50%；综合 = 笔试均分×50% + 面试×50%（缺项留空）
 * 缺项策略：missingAsZero=true 按 0 算（大学）；false 整项留空（实训/初高，避免"没考"被当"0 分"）
 */
const SCORE_FORMULA = {
  jh: {
    writtenAvg: null,
    total: {
      parts: [
        { field: 'written', weight: 1 },
        { field: 'machine', weight: 1 },
        { field: 'interview', weight: 1 },
        { field: 'other', weight: 1 },
      ],
      missingAsZero: false,
    },
    passByRatio: true,
    passRatio: 0.6,
    judgeMode: 'auto',
  },
  class: {
    writtenAvg: null,
    total: {
      parts: [
        { field: 'written', weight: 0.5 },
        { field: 'interview', weight: 0.5 },
      ],
      missingAsZero: true,
    },
    passByRatio: false,
    passRatio: 0.6,
    judgeMode: 'manual',
  },
  job: {
    writtenAvg: {
      parts: [
        { field: 'written', weight: 0.5 },
        { field: 'machine', weight: 0.5 },
      ],
      missingAsZero: false,
    },
    total: {
      parts: [
        { field: 'writtenAvg', weight: 0.5 },
        { field: 'interview', weight: 0.5 },
      ],
      missingAsZero: false,
    },
    passByRatio: false,
    passRatio: 0.6,
    judgeMode: 'action',
  },
};

/**
 * ★ 退费状态映射（学段 → { read: 老码→统一码, write: 统一码→老码 }）
 *
 * 统一码 = 实训那套 ApprovalStatus：
 *   1 待提交 · 2 待学管审批 · 3 待校长审批 · 4 已通过 · 5 已驳回 · 6 已撤销
 *
 * 初高 / 大学老码（1~7 逐值一致，8=已撤回）：
 *   1 待提交 · 2 待经理 · 3 待教务核算 · 4 待财务出款 · 5 待校长 · 6 已退费 · 7 已驳回 · 8 已撤回
 *   读：3/4/5 都归并成统一 3（都是"审批中"）；6→4；7→5；8→6
 *   写：统一 3 → 老 5（直接落"待校长"，**跳过 3/4 = 新链生效点**）；4→6；5→7；6→8
 * 实训本来就是统一码 → 恒等。
 *
 * ⚠️ 反向映射必须显式写死：3/4/5 都正向映射到 3，反推无法确定该落哪个。
 */
const REFUND_STATUS_MAP = {
  jh: {
    read: { 1: 1, 2: 2, 3: 3, 4: 3, 5: 3, 6: 4, 7: 5, 8: 6 },
    write: { 1: 1, 2: 2, 3: 5, 4: 6, 5: 7, 6: 8 },
  },
  class: {
    read: { 1: 1, 2: 2, 3: 3, 4: 3, 5: 3, 6: 4, 7: 5, 8: 6 },
    write: { 1: 1, 2: 2, 3: 5, 4: 6, 5: 7, 6: 8 },
  },
  job: {
    read: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 },
    write: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 },
  },
};

/**
 * ★ 学籍异动审批（休学/退学/复学）· 业务类型映射
 * 统一类型码：1 休学 · 2 退学 · 3 复学（= 实训 StudentLeaveBizType）
 *   初高 FlowType：1休学 2复学 3升班转班 4换人 5退学 6就业协议 7末班 → 只取 1/2/5
 *   大学 ApplyType：1休学 2退学 3退费 4升学 → **没有复学**
 *   实训 biz_type = 统一码（恒等）
 */
const LEAVE_BIZ_MAP = {
  jh: { read: { 1: 1, 5: 2, 2: 3 }, write: { 1: 1, 2: 5, 3: 2 } },
  class: { read: { 1: 1, 2: 2 }, write: { 1: 1, 2: 2 } },
  job: { read: { 1: 1, 2: 2, 3: 3 }, write: { 1: 1, 2: 2, 3: 3 } },
};

/**
 * ★ 学籍异动审批 · 状态映射
 * 统一状态码 = ApprovalStatus：1待提交 2待学管 3待校长 4已通过 5已驳回 6已撤销
 *   初高 SuspendStatus：1待提交 2待经理 3已同意 4已驳回（原本无 5/6，本次补齐）
 *       读：3→4（已同意=已通过）、4→5（已驳回）、5→3（待校长）、6→6
 *       写：3→5（待校长）、4→3（已同意）、5→4（已驳回）、6→6
 *   大学 SuspendStatus：1待提交 2待经理 3待校长 4已同意 5已驳回（原本无 6，本次补齐）→ 恒等
 *   实训 approval_status = ApprovalStatus → 恒等
 * ⚠️ 初高与大学的值**不同**（初高 3=已同意，大学 3=待校长）→ 必须各配一张表
 */
const LEAVE_STATUS_MAP = {
  jh: {
    read: { 1: 1, 2: 2, 3: 4, 4: 5, 5: 3, 6: 6 },
    write: { 1: 1, 2: 2, 3: 5, 4: 3, 5: 4, 6: 6 },
  },
  class: {
    read: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 },
    write: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 },
  },
  job: {
    read: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 },
    write: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 },
  },
};

const CONF = [
  {
    key: 'attendance.statusMap',
    value: STATUS_MAP,
    remark:
      '出勤状态码映射（学段 → 原始码:统一码）。初高原码 1出勤2迟到3病假4事假5缺勤；实训 1出勤2缺勤3迟到4早退5请假6事假7病假；统一码取实训那套',
  },
  {
    key: 'attendance.scope',
    value: SCOPE,
    remark:
      '出勤口径：应到/实到怎么算、未达标线、是否教师手工填人数（大学 manualInput=true）',
  },
  {
    key: 'score.formula',
    value: SCORE_FORMULA,
    remark:
      '成绩公式（学段 → 笔试均分/综合成绩的加权项 + 缺项策略 + 是否按满分比例判定通过）',
  },
  {
    key: 'refund.statusMap',
    value: REFUND_STATUS_MAP,
    remark:
      '退费状态映射（read 老码→统一码 / write 统一码→老码）。统一码 = 实训 ApprovalStatus；★ 审批链统一用实训那套（学管→校长）',
  },
  {
    key: 'leave.bizMap',
    value: LEAVE_BIZ_MAP,
    remark:
      '学籍异动业务类型映射：统一码 1休学 2退学 3复学。初高 FlowType 2=复学 5=退学；大学 ApplyType 无复学；实训恒等',
  },
  {
    key: 'leave.statusMap',
    value: LEAVE_STATUS_MAP,
    remark:
      '学籍异动状态映射。统一码 = ApprovalStatus；⚠️ 初高 3=已同意、大学 3=待校长，两边值不同故各配一张表',
  },
];

(async () => {
  try {
    // ① 建表（幂等）
    await migration.up(db);
    console.log('[1/2] 表 t_teaching_conf 已就绪（已存在则跳过）');

    // ② 灌配置（存在则更新，不存在则插入）
    const now = new Date();
    for (const c of CONF) {
      const existed = await db('t_teaching_conf').where({ conf_key: c.key }).first();
      const json = JSON.stringify(c.value, null, 2);
      if (existed) {
        await db('t_teaching_conf')
          .where({ id: existed.id })
          .update({
            conf_value: json,
            remark: c.remark,
            is_deleted: 0,
            update_time: now,
            update_by: 'seed',
          });
        console.log(`[2/2] 更新配置：${c.key}`);
      } else {
        await db('t_teaching_conf').insert({
          id: randomUUID(),
          conf_key: c.key,
          conf_value: json,
          remark: c.remark,
          create_time: now,
          create_by: 'seed',
          update_time: now,
          update_by: 'seed',
          is_deleted: 0,
        });
        console.log(`[2/2] 新增配置：${c.key}`);
      }
    }

    const rows = await db('t_teaching_conf').where({ is_deleted: 0 }).select('conf_key');
    console.log('完成。当前配置项：', rows.map((r) => r.conf_key).join('、'));
  } catch (e) {
    console.error('失败：', e.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
})();
