/**
 * 自检：缴费状态补「逾期」+ 逾期一律算紧急 + 就业状态统一（2026-10-20 用户反馈）
 * ============================================================
 * 【用户报的两个问题】
 *   ① 「有些人没有缴费状态是什么鬼？」→ 缴费状态列空白
 *   ② 「逾期的都是紧急」            → 逾期行没打「紧急」标记
 *   ③ 「就业的缴费状态采用初高中大学的」→ 就业别再单列一套催费状态码
 *
 * 【根因（同一个）】`t_class_fee.pay_status` 的列注释一直是
 *   「1待缴 2已缴 3已核对 **4逾期** 5冻结」，演示数据里也确实写着 4，
 *   但 shared-types 的 PayStatus 枚举**漏了 4** →
 *     · nameOf(PAY_STATUS_NAME, 4) 取不到名字 → 列渲染成空 tag（问题①）；
 *     · UNPAID_STATUSES=[1,5] 不含 4 → 逾期行不算未结清 → 不打紧急（问题②）。
 *
 * 【钉住什么】
 *   A. 静态
 *      ① 初高/大学两侧枚举都有 OVERDUE=4 与「逾期」中文名；
 *      ② 后端未结清集合（催费列表 + 首页统计）都含 4；
 *      ③ 状态标签色：4 → danger（不能落到「冻结」的灰色）；
 *      ④ 就业状态：下拉三部门共用 PAY_STATUS_NAME，催费单状态折算成缴费状态（3→已缴，1/2→待缴）；
 *      ⑤ 就业接口 callStatus 支持逗号多值（「待缴」= 1,2 两种状态）。
 *   B. live
 *      初高列表**每一行都有缴费状态名**（核心回归），且逾期行 isUrgent=true；
 *      就业造 3 行夹具（待催缴/催缴中/已缴清），验证单值/多值筛选与「已缴」口径。
 *
 * 【跑法】在 server-job 目录下（后端 8004 / 前端 5173 已运行）：
 *     node scripts/_test-fee-status-unified.mjs
 *   就业夹具测完按项目铁律逻辑删除（is_deleted=1），不物理删。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BASE, conn, login, makeChecker, req } from './_e2e-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const { check, summary } = makeChecker();

/** 就业夹具前缀 */
const P = 'testpay-';

const nowText = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** 相对今天偏移 N 天 → YYYY-MM-DD */
function dayOffset(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 就业夹具：1 待催缴（逾期） / 2 催缴中（未到期） / 3 已缴清（逾期也不该算紧急） */
const CALL_FIX = [
  { key: 'wait', callStatus: 1, due: -3, label: '待催缴·已逾期' },
  { key: 'doing', callStatus: 2, due: 10, label: '催缴中·未到期' },
  { key: 'paid', callStatus: 3, due: -10, label: '已缴清·已过期' },
];

(async () => {
  let db = null;
  try {
    /* ================= A. 静态契约 ================= */
    const enumsJh = read('shared-types', 'src', 'class-jh', 'enums.ts');
    const enumsClass = read('shared-types', 'src', 'class', 'enums.ts');
    const dictClass = read('server-job', 'src', 'class', 'lib', 'dict.ts');
    const feeRoute = read('server-job', 'src', 'class-jh', 'routes', 'fee.route.ts');
    const statsRoute = read('server-job', 'src', 'class-jh', 'routes', 'stats.route.ts');
    const feeCallRoute = read('server-job', 'src', 'routes', 'feeCall.route.ts');
    const fmt = read('web-job', 'src', 'class-jh', 'utils', 'format.ts');
    const feeList = read('web-job', 'src', 'class-jh', 'views', 'FeeList.vue');

    check('① 初高枚举补了 OVERDUE = 4', /OVERDUE = 4/.test(enumsJh));
    check(
      '① 初高状态字典有「逾期」',
      /\[PayStatus\.OVERDUE\]:\s*'逾期'/.test(enumsJh),
    );
    check('① 大学侧枚举也补了 OVERDUE = 4（两套码对齐）', /OVERDUE = 4/.test(enumsClass));
    check('① 大学侧字典 PayStatusName 有「逾期」', /\[PayStatus\.OVERDUE\]:\s*'逾期'/.test(dictClass));

    check(
      '② 未结清集合含 4 逾期（催费列表）',
      /UNPAID_STATUSES = \[PayStatus\.UNPAID, PayStatus\.OVERDUE, PayStatus\.FROZEN\]/.test(feeRoute),
    );
    check(
      '② 首页「紧急催费数」同口径（列表紧急、首页不算 = 两处口径打架）',
      /whereIn\('pay_status', \[PayStatus\.UNPAID, PayStatus\.OVERDUE, PayStatus\.FROZEN\]\)/.test(statsRoute),
    );
    check('③ 逾期标签色 = danger（原来落到冻结的灰色，看着像没状态）', /status === 4\) return 'danger'/.test(fmt));

    check(
      '④ 缴费状态下拉三部门共用 PAY_STATUS_NAME',
      /Object\.entries\(PAY_STATUS_NAME\)\.map/.test(feeList) && !/FEE_CALL_STATUS_NAME/.test(feeList),
    );
    check(
      '④ 就业催费单状态折算：已缴清→已缴，待催缴/催缴中→待缴',
      /function callStatusToPayStatus[\s\S]{0,200}?PayStatus\.PAID[\s\S]{0,120}?PayStatus\.UNPAID/.test(feeList),
    );
    check(
      '④ 就业行按折算后的状态显示（原始催缴状态挂 title 备查）',
      /payStatus: callStatusToPayStatus\(r\.callStatus\)/.test(feeList) && /催费单状态：/.test(feeList),
    );
    check(
      '⑤ 就业接口 callStatus 支持多值（「待缴」= 待催缴 1 + 催缴中 2）',
      /z\.union\(\[z\.coerce\.number\(\)\.int\(\), z\.string\(\)\]\)/.test(feeCallRoute) &&
        /split\(','\)/.test(feeCallRoute) &&
        /base\.whereIn\('call_status', arr\)/.test(feeCallRoute),
    );

    /* 块注释里加粗紧跟斜杠会提前闭合注释 → tsc 报一屏 Invalid character，先自查 */
    check(
      '块注释安全：改动的 8 个源文件里没有 **/',
      [enumsJh, enumsClass, dictClass, feeRoute, statsRoute, feeCallRoute, fmt, feeList].every((s) => !s.includes('**/')),
    );

    /* ================= B. live ================= */
    const token = await login('admin');
    check('管理员登录拿到 token（live 断言前置）', !!token, token ? 'ok' : '登录失败 → 下面必然红');
    if (!token) throw new Error('登录失败，live 段无法继续');

    /* ---- B1. 初高：每行都要有缴费状态名（用户报的「没有缴费状态」） ---- */
    const jhRes = await req(`${BASE}/api/class-jh/fee/list?page=1&size=100`, { token, timeout: 20000 });
    const jhRows = jhRes.json?.data?.list || [];
    check('★ 初高催费列表有数据（live 前置）', jhRes.json?.code === 200 && jhRows.length > 0, `rows=${jhRows.length}`);
    const noName = jhRows.filter((r) => !r.payStatusName);
    check(
      '★ 每一行都有缴费状态名（不再出现空白 tag）',
      noName.length === 0,
      noName.length ? `缺 ${noName.length} 行，例：payStatus=${noName[0].payStatus}` : `${jhRows.length} 行全部有名字`,
    );
    const statusSet = [...new Set(jhRows.map((r) => r.payStatusName))];
    check('★ 状态名都在字典里（不含空串/未知）', statusSet.every((s) => s && s !== '未知'), statusSet.join(' / '));

    const overdueRows = jhRows.filter((r) => r.payStatus === 4);
    check(
      '★ 逾期行（pay_status=4）全部标「紧急」',
      overdueRows.length > 0 && overdueRows.every((r) => r.isUrgent === true),
      overdueRows.length ? `逾期 ${overdueRows.length} 行，未标紧急 ${overdueRows.filter((r) => !r.isUrgent).length} 行` : '当前库里没有逾期行（无法断言）',
    );
    check(
      '★ 逾期行的状态名就是「逾期」',
      overdueRows.length === 0 || overdueRows.every((r) => r.payStatusName === '逾期'),
      [...new Set(overdueRows.map((r) => r.payStatusName))].join('/') || '无逾期行',
    );

    /* ---- B2. 就业：造 3 行夹具，验证统一状态与多值筛选 ---- */
    db = conn('sms_job');
    const now = nowText();
    for (const [i, f] of CALL_FIX.entries()) {
      const row = {
        id: `${P}${f.key}`,
        create_time: now,
        create_by: 'selftest',
        is_deleted: 0,
        fee_type: 1,
        student_id: `${P}stu${i}`,
        student_no: `${P}NO${i}`,
        student_name: `状态测试${f.key}`,
        phone: null,
        parent_phone: null,
        class_id: null,
        class_name: null,
        dept_code: null,
        head_teacher_id: null,
        head_teacher_name: null,
        fee_amount: 50000,
        due_date: dayOffset(f.due),
        call_reason: '自检夹具',
        remark: null,
        call_status: f.callStatus,
        handle_time: null,
        handle_remark: null,
        applicant_id: null,
        applicant_name: '自检',
      };
      const exists = await db('t_job_fee_call').where({ id: row.id }).first('id');
      if (exists) await db('t_job_fee_call').where({ id: row.id }).update(row);
      else await db('t_job_fee_call').insert(row);
    }
    check(`★ 造了 ${CALL_FIX.length} 行就业夹具（待催缴逾期 / 催缴中未到期 / 已缴清过期）`, true);

    const page = async (qs) => {
      const r = await req(`${BASE}/api/job/fee-call/page?page=1&size=50&keyword=${P}${qs}`, { token, timeout: 20000 });
      return { code: r.json?.code, list: r.json?.data?.list || [], total: r.json?.data?.total };
    };
    const all = await page('');
    check(
      '★ 就业列表默认出全部 3 行（夹具可见）',
      all.code === 200 && all.total === 3,
      `code=${all.code} total=${all.total}`,
    );
    const waiting = await page('&callStatus=1,2');
    check(
      '★ callStatus=1,2 → 只出「待催缴 + 催缴中」2 行（= 统一口径的「待缴」）',
      waiting.total === 2 && waiting.list.every((r) => [1, 2].includes(Number(r.callStatus))),
      `total=${waiting.total} 状态=${waiting.list.map((r) => r.callStatus).join(',')}`,
    );
    const paid = await page('&callStatus=3');
    check(
      '★ callStatus=3 → 只出「已缴清」1 行（= 统一口径的「已缴」）',
      paid.total === 1 && paid.list.every((r) => Number(r.callStatus) === 3),
      `total=${paid.total}`,
    );
    const overdueOnly = await page('&callStatus=1,2&onlyOverdue=true');
    check(
      '★ 待缴 + 只看逾期 → 只剩「待催缴且已过应缴日」1 行（= 统一口径的「逾期」）',
      overdueOnly.total === 1 && overdueOnly.list[0]?.callStatus === 1,
      `total=${overdueOnly.total} 状态=${overdueOnly.list.map((r) => r.callStatus).join(',')}`,
    );

    /* ---- B3. 前端编译产物：状态不再空白、提示文案已改 ---- */
    const fe = await req(`${BASE}/src/class-jh/views/FeeList.vue`, { timeout: 15000 });
    check(
      '★ 催费页 Vite 编译通过，且含「三部门统一缴费状态」的提示文案',
      fe.status === 200 && fe.raw.includes('缴费状态三部门统一'),
      `status=${fe.status} len=${fe.raw.length}`,
    );
  } catch (e) {
    check('脚本执行未抛异常', false, e?.message || String(e));
  } finally {
    if (db) {
      try {
        await db('t_job_fee_call').whereIn('id', CALL_FIX.map((f) => `${P}${f.key}`)).update({ is_deleted: 1 });
        console.log(`\n（已逻辑删除 ${CALL_FIX.length} 行就业夹具）`);
      } catch (e) {
        console.log(`\n（清理失败，人工处理：${e?.message || e}）`);
      }
      await db.destroy();
    }
    const ok = summary();
    process.exit(ok ? 0 : 1);
  }
})();
