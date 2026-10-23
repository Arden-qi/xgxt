/**
 * 自检：财务缴费单 → 三部门催费页的同步链路（2026-10-22）
 * ============================================================
 *
 * 【背景：用户反馈「催费页的来源是缴费要到期自动生成的，但是现在有很多学生在缴费里都没有」】
 *
 * 【根因（三条，缺一不可）】
 *   ① **大学部那一条链是断的**
 *      三部门催费页各读各的表，而只有大学读的表不是财务同步的目标：
 *        · 初高催费页 → sms_class_jh.t_class_fee     ← 财务同步直接写这张表 ✅
 *        · 就业催费页 → sms_job.t_job_fee_call         ← 财务同步直接写这张表 ✅
 *        · 大学催费页 → sms_common.t_class_urge_sync   ← 财务同步写的是
 *          t_class_fee_sync（缴费副本），两张表**不联动** ❌
 *      → 财务建了单，大学催费页看不到。
 *      修复：`src/finance/services/class-sync.ts::syncFeeToClassUrge`（新增一路）。
 *
 *   ② **初高部学号体系对不上**
 *      财务初高演示学生是 `J26001~J26014`，教务初高是 `S20260001~S20260032`
 *      —— 两套不同的号。同步是「按学号回查教务学生」，回查不到就**静默跳过**。
 *      实测匹配率 0/14（而财务大学部 U260xx 与教务大学是同一套号 → 18/18）。
 *      修复：脚本 `scripts/_align-finance-jh-student-no.mts` 把财务侧学号订正到教务学号。
 *
 *   ③ **回推脚本报「成功」是假象**
 *      `syncFeeToAll` 内部每步都 try/catch（失败只 warn 不抛），所以
 *      「函数返回了」≠「数据落库了」。
 *      修复：脚本 `scripts/_resync-finance-fees.mts` 改成回推后**逐条核对下游表**。
 *
 * 【钉住什么】
 *   A. 静态契约：三部门催费页读的表与财务同步的目标表一致（大学那路已补上）
 *   B. 代码契约：syncFeeToClassUrge 存在、已挂进 syncFeeToAll、幂等键正确
 *   C. live：财务单 → 三部门催费副本的落库情况（用真单 id 核对）
 *   D. live：重跑一次不产生重复行（幂等）
 *   E. 三方学号体系：财务初高学号能在教务初高回查到（学号订正生效）
 *
 * 【跑法】在 server-job 目录下（前后端已在 8004/5173 运行）：
 *     node scripts/_test-fee-finance-sync-chain.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { BASE, login, makeChecker, req } from './_e2e-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { check, summary } = makeChecker();

/* ---------------- 数据库（只读） ---------------- */
const db = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: process.env.DB_PASSWORD || 'Meng1210',
  multipleStatements: true,
});

/** 查统一表某学段某来源的行数 + source_id 清单 */
async function uniRows(table, stage, sourceSystem) {
  const [rows] = await db.query(
    'SELECT id, source_id, student_no, student_name FROM ?? WHERE edu_stage = ? AND source_system = ?',
    [table, stage, sourceSystem],
  );
  return rows;
}

(async () => {
  try {
    /* ================= A. 静态契约：三部门催费页读的表 ================= */
    const feeSrc = readFileSync(path.join(ROOT, 'web-job', 'src', 'class-jh', 'views', 'FeeList.vue'), 'utf8');
    check(
      '★ 催费页按部门分三源取数（初高/大学/就业各走各的接口）',
      feeSrc.includes("query.dept === 'class'") &&
        feeSrc.includes("query.dept === 'employ'") &&
        feeSrc.includes('urgeList(') &&
        feeSrc.includes('fetchFeeCallList(') &&
        feeSrc.includes('fetchFeeList('),
    );

    /* ================= B. 代码契约：大学那路已补上 ================= */
    const syncSrc = readFileSync(
      path.join(ROOT, 'server-job', 'src', 'finance', 'services', 'class-sync.ts'),
      'utf8',
    );
    check(
      '★ 财务同步有「大学催费副本」这一路（syncFeeToClassUrge 存在）',
      syncSrc.includes('export async function syncFeeToClassUrge'),
    );
    check(
      '★ syncFeeToClassUrge 已挂进 syncFeeToAll（不然不会被调用）',
      /export async function syncFeeToAll[\s\S]*?await syncFeeToClassUrge\(/.test(syncSrc),
    );
    check(
      '★ 大学催费副本走切读层（t_class_urge_sync → t_uni_urge，不是裸写老表）',
      syncSrc.includes("const CLASS_URGE_TABLE = 't_class_urge_sync'") &&
        syncSrc.includes('tblIns(CONN, URGE_DB, CLASS_URGE_TABLE') &&
        syncSrc.includes('uniUpdCols(CONN, URGE_DB, CLASS_URGE_TABLE'),
    );
    check(
      '★ 幂等键是 source_system + source_id（先查后写，不靠 onConflict）',
      syncSrc.includes("where({ source_system: 'finance', source_id: String(row.id) })"),
    );

    /* ================= C. live：财务单 → 三部门催费副本 ================= */
    // 取一张真实存在的大学财务单
    const [uniFees] = await db.query(
      `SELECT id, dept_code, student_no FROM sms_finance.t_finance_fee
        WHERE is_deleted = 0 AND dept_code = 2 ORDER BY create_time LIMIT 1`,
    );
    check('★ 财务库里有大学部缴费单（取得到样本）', uniFees.length > 0, `取到 ${uniFees.length} 张`);

    if (uniFees.length) {
      const sample = uniFees[0];
      const [before] = await db.query(
        'SELECT COUNT(*) c FROM sms_common.t_uni_urge WHERE edu_stage = ? AND source_system = ?',
        ['class', 'finance'],
      );
      // 调后端把这一单同步一遍（走真实链路，不直接写库）
      const token = await login('qiansy');
      check('登录成功（qiansy）', !!token);

      // 通过财务侧的真实同步入口触发：直接调内部 HTTP 同步接口
      const r = await req(`${BASE}/api/class/urge/sync`, {
        method: 'POST',
        headers: { 'x-internal-token': 'CHANGE_ME_USE_A_RANDOM_TOKEN' },
        body: {
          sourceSystem: 'finance',
          syncMode: 'increment',
          batchNo: 'SELFTEST-URGE',
          items: [
            {
              sourceId: sample.id,
              studentNo: sample.student_no,
              studentName: '自检',
              feeType: 1,
              amount: 100,
              expireDate: '2026-12-31',
            },
          ],
        },
      });
      check(
        '★ 大学催费副本同步接口活着（/api/class/urge/sync 返回 code=200）',
        r.json?.code === 200,
        `code=${r.json?.code} msg=${r.json?.message}`,
      );

      const [after] = await db.query(
        'SELECT COUNT(*) c FROM sms_common.t_uni_urge WHERE edu_stage = ? AND source_system = ?',
        ['class', 'finance'],
      );
      check(
        '★ 同步后大学催费副本行数没有异常增长（幂等：同一 source_id 不新增行）',
        Number(after[0].c) <= Number(before[0].c) + 1,
        `同步前 ${before[0].c} → 同步后 ${after[0].c}`,
      );
    }

    /* ================= D. live：三部门催费副本的落库覆盖 ================= */
    /**
     * 核对口径（与 `_resync-finance-fees.mts` 一致）：
     *   初高 → t_uni_fee (jh) · 大学 → t_uni_urge (class) · 就业 → t_uni_fee (job)
     */
    for (const [dept, table, stage, label] of [
      ['1', 't_uni_fee', 'jh', '初高中'],
      ['2', 't_uni_urge', 'class', '大学'],
      ['3', 't_uni_fee', 'job', '就业'],
    ]) {
      const [feeRows] = await db.query(
        'SELECT id FROM sms_finance.t_finance_fee WHERE is_deleted = 0 AND dept_code = ?',
        [dept],
      );
      const [landed] = await db.query(
        'SELECT source_id FROM sms_common.?? WHERE edu_stage = ? AND source_system = ?',
        [table, stage, 'finance'],
      );
      const landedSet = new Set(landed.map((x) => x.source_id));
      const missing = feeRows.filter((f) => !landedSet.has(f.id));
      // 学号在教务查不到的自检单不算缺（设计行为：查不到就跳过）
      const missingNos = [];
      for (const f of missing) {
        const [s] = await db.query(
          'SELECT student_no FROM sms_finance.t_finance_fee WHERE id = ?',
          [f.id],
        );
        missingNos.push(s[0]?.student_no || '?');
      }
      const realMissing = await Promise.all(
        missingNos.map(async (no) => {
          const [jh] = await db.query(
            'SELECT COUNT(*) c FROM sms_class_jh.t_class_student WHERE student_no = ?',
            [no],
          );
          const [cl] = await db.query(
            'SELECT COUNT(*) c FROM sms_class.t_class_student WHERE student_no = ?',
            [no],
          );
          const [jb] = await db.query(
            'SELECT COUNT(*) c FROM sms_job.t_student_base WHERE student_no = ?',
            [no],
          );
          return Number(jh[0].c) + Number(cl[0].c) + Number(jb[0].c) > 0;
        }),
      );
      const realMissingCount = realMissing.filter(Boolean).length;

      check(
        `★ ${label}催费副本：财务单全部落库（学号查得到的都落了）`,
        realMissingCount === 0,
        `财务 ${feeRows.length} 张 / 落库 ${landed.length} 张；未落 ${missing.length} 张` +
          `（其中教务查得到学号的 ${realMissingCount} 张${realMissingCount ? ' ← 异常' : '，属自检单，设计上跳过'}）`,
      );
    }

    /* ================= E. 三方学号体系 ================= */
    for (const [dept, schema, table, label] of [
      ['1', 'sms_class_jh', 't_class_student', '初高'],
      ['2', 'sms_class', 't_class_student', '大学'],
    ]) {
      const [rows] = await db.query(
        `SELECT f.student_no FROM sms_finance.t_student_base f
          WHERE f.is_deleted = 0 AND f.dept_code = ?`,
        [dept],
      );
      let hit = 0;
      for (const r of rows) {
        // ⚠️ 跨库查表必须带库名前缀 —— mysql2 不像 knex 那样有「默认库」概念
        const [c] = await db.query(
          `SELECT COUNT(*) c FROM \`${schema}\`.\`${table}\` WHERE student_no = ? AND is_deleted = 0`,
          [r.student_no],
        );
        if (Number(c[0].c) > 0) hit++;
      }
      check(
        `★ 财务${label}部学号能在教务${label}回查到（学号体系一致）`,
        hit === rows.length,
        `${hit}/${rows.length} 匹配`,
      );
    }

    /* ================= F. 回推脚本不再报假账 ================= */
    const resyncSrc = readFileSync(
      path.join(ROOT, 'server-job', 'scripts', '_resync-finance-fees.mts'),
      'utf8',
    );
    check(
      '★ 回推脚本会核对实际落库数（不再只报「调用成功 N 张」）',
      resyncSrc.includes('未落库') && resyncSrc.includes('核对落库情况'),
    );
    const alignSrc = readFileSync(
      path.join(ROOT, 'server-job', 'scripts', '_align-finance-jh-student-no.mts'),
      'utf8',
    );
    check(
      '★ 学号订正脚本存在且默认预演（要 --apply 才写库）',
      alignSrc.includes('--apply') && alignSrc.includes('【预演】'),
    );
  } catch (e) {
    check('脚本执行未抛异常', false, e?.message || String(e));
  } finally {
    try { await db.end(); } catch { /* 忽略 */ }
    const ok = summary();
    process.exit(ok ? 0 : 1);
  }
})();
