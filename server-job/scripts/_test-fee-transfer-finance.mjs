/**
 * 自检：催费页「批量上传到财务缴费管理」（2026-10-20 用户要求）
 * ============================================================
 * 【需求（用户原话）】上传缴费金额默认为应缴金额；整体有一个「批量上传到财务缴费管理」的按钮，
 *   点开后有「全选」「只选未上传过」，也可以在序号前用复选框点选，把凭证信息转交给财务。
 *
 * 【落地口径】
 *   · 「转交」= 在财务 `sms_finance.t_finance_fee` 里**生成对应的缴费单**（凭证/实缴金额/缴费日期/备注），
 *     走财务自己的 `addFee()`，凭证唯一性等规则不在本模块重写；
 *   · 转交成功后回写 `finance_fee_id`（★ 2026-10-23 三部门统一判重口径）
 *     + 老的 `source_system='finance' + source_id`（财务侧单 id，兼容老数据），
 *     既表示「已转交」（transferred），也保证财务后续同步不会多出一条；
 *     ⚠️ 回写必须落在**统一表** `sms_common.t_uni_fee`（接口读的也是它），
 *     写老表 `t_class_fee` = 页面永远看不到「已转交」→ 反复转交重复建单。
 *   · 已转交 / 未登记缴费 / 非初高 的单会被**跳过**（返回 skip 原因），不算失败；
 *   · 实缴金额写进财务的 amount；缴费方式财务表没有列 → 拼进财务 remark（现金另外标注无凭证）。
 *
 * 【钉住什么】
 *   A. 静态：接口/校验/财务 addFee 复用/前端弹窗（全选、只选未上传过、selection 在序号前）
 *   B. live：造 3 行夹具（老表 + 统一表双写）→ 转交 → 财务表真出现 2 条（金额/状态/凭证/备注对得上）、
 *      台账回写 finance_fee_id、重复转交被跳过、未登记单被跳过、空数组报错、候选项带 transferred
 *   C. 清理：逻辑删除台账夹具 + 财务侧新建单
 *
 * 【跑法】在 server-job 目录下（后端 8004 / 前端 5173 已运行）：
 *     node scripts/_test-fee-transfer-finance.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BASE, conn, login, makeChecker, req } from './_e2e-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const { check, summary } = makeChecker();

/** 夹具前缀 */
const P = 'testtr-';
const FIX_A = `${P}a`; // 微信支付 + 有凭证
const FIX_B = `${P}b`; // 现金 + 无凭证
const FIX_C = `${P}c`; // 没登记缴费（应被跳过）

const dayOffset = (n) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const nowText = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** 记录财务侧本次新建的单，收尾逻辑删除 */
const createdFinanceIds = [];

function baseRow(over = {}) {
  return {
    create_time: nowText(),
    is_deleted: 0,
    student_id: `${P}stu`,
    student_no: `${P}NO`,
    student_name: '转交测试生',
    class_id: null,
    class_name: null,
    dept_code: 1,
    fee_type: 1,
    fee_amount: 100000,
    pay_status: 2,
    pay_date: null,
    expire_date: dayOffset(-1),
    voucher_url: null,
    source_system: 'local',
    source_id: null,
    // ★ 2026-10-23：必须显式清掉「已转交」标记，否则上一轮跑完的行带着
    //   finance_fee_id 进来 → 候选里被标成已转交 → 本轮「转交成功」断言假红
    finance_fee_id: null,
    finance_transfer_time: null,
    period: null,
    pay_method: null,
    paid_amount: null,
    pay_remark: null,
    ...over,
  };
}

(async () => {
  let dbJh = null;
  let dbFin = null;
  let dbUni = null;
  try {
    /* ================= A. 静态契约 ================= */
    const route = read('server-job', 'src', 'class-jh', 'routes', 'fee.route.ts');
    // ★ 2026-10-23：催费页弹窗现在走**三部门统一接口**（初高老接口只留作兼容），
    //   凡是「候选口径 / 判重口径」的断言都要钉统一接口这份源码。
    const uRoute = read('server-job', 'src', 'teaching', 'fee', 'transfer.route.ts');
    const api = read('web-job', 'src', 'class-jh', 'api', 'fee.ts');
    const feeList = read('web-job', 'src', 'class-jh', 'views', 'FeeList.vue');
    const types = read('shared-types', 'src', 'class-jh', 'api', 'fee.api.ts');

    check(
      '① 后端：候选接口只取「已登记缴费」的初高单',
      /'\/transfer\/candidates'/.test(route) && /whereNotNull\('pay_method'\)\.orWhereNotNull\('paid_amount'\)/.test(route),
    );
    check(
      '① 后端：一次最多 200 条 + 空数组报「请先勾选」',
      /\.max\(200, '一次最多转交 200 条'\)/.test(route) && /\.min\(1, '请先勾选要转交的记录'\)/.test(route),
    );
    check(
      '① 后端：复用财务 addFee（凭证唯一性等规则不重写）',
      /import \{ addFee as financeAddFee \} from '\.\.\/\.\.\/finance\/services\/fee\.service'/.test(route) &&
        /await financeAddFee\(/.test(route),
    );
    check(
      '① 后端：跳过条件齐全（不存在 / 非初高 / 未登记 / 已转交）',
      ['缴费单不存在', '只有初高的缴费单能转交财务', '还没登记缴费', '已转交过财务'].every((m) => route.includes(m)),
    );
    check(
      '① 后端：转交后回写 finance_fee_id（三部门统一判重口径）+ 老的 source_system/source_id 兜底',
      /finance_fee_id: financeFeeId/.test(route) && /source_system: 'finance'/.test(route),
    );
    check(
      /*
       * ★ 2026-10-23 口径变更：判重锚点从 `source_system + source_id` 改成 `finance_fee_id`。
       *   原因：`source_system='finance'` 对本表还有另一层意思是「这张单本来就从财务同步过来」，
       *   拿它当「已转交」会把财务同步来的单全标成已转交（转交弹窗里就一条都选不了）。
       *   断言钉**行为**（有 finance_fee_id 即已转交），不钉旧写法。
       *
       * ★ 2026-10-23 二次变更：候选接口已把「已转交」的行**直接过滤掉**，
       *   所以弹窗里不再有「只选未上传过」。前端仅剩「全选」。
       */
      '① 后端：判重函数只看 finance_fee_id（isTransferred）',
      // 函数体里有一大段注释，窗口放宽（注释长度会变，别写刚好卡住的值）
      /function isTransferred[\s\S]{0,1500}?return !!row\.finance_fee_id;/.test(uRoute) &&
        /transferred: isTransferred\(row, dept\)/.test(uRoute),
    );
    check('① 类型：FeeTransferPayload / FeeTransferResult 已定义', /interface FeeTransferPayload/.test(types) && /interface FeeTransferResult/.test(types));

    check(
      // 默认视图是「全部部门」，所以按钮不能只给初高显示（用户第一版就是因此看不见）
      // ★ 2026-10-22 口径变更：按钮已从「初高 + 全部」放开成**三个部门都显示**
      //   （用户要求「大学部和就业部也要能批量上传到财务」）→ 断言同步更新。
      //   钉住的是「按钮存在 + 可点 + 不被部门条件挡住」。
      '② 前端：筛选行有「批量上传到财务」，且不被部门条件挡住（三部门都可见）',
      /批量上传到财务/.test(feeList) &&
        /@click="openTransfer"/.test(feeList) &&
        // 按钮上不能有「只在初高/全部部门才显示」这种 v-if 守卫
        !/v-if="query\.dept === 'jh' \|\| query\.dept === 'all'"[\s\S]{0,300}?批量上传到财务/.test(feeList),
    );
    check(
      // ★ 2026-10-23 口径变更：候选接口已在 SQL 里过滤掉已转交的行，
      //   弹窗里每一条都可转交 → 「只选未上传过」按钮没意义，已删除。
      //   断言钉**代码标识**，不钉注释里的字样（注释里仍留着改造原因）。
      '② 前端弹窗：全选按钮在，「只选未上传过」按钮已删',
      /selectAllTransfer/.test(feeList) &&
        !/untransferredCount/.test(feeList) &&
        !/selectUntransferred/.test(feeList),
    );
    // 只看转交弹窗那一段（主列表也有 type="index"，全局下标比会误判）
    const tStart = feeList.indexOf('title="批量上传到财务缴费管理"');
    const transferBlock = tStart >= 0 ? feeList.slice(tStart, feeList.indexOf('</el-dialog>', tStart)) : '';
    check(
      '② 前端弹窗：复选框列在序号之前（type="selection" 早于 type="index"）',
      transferBlock.indexOf('type="selection"') > 0 &&
        transferBlock.indexOf('type="selection"') < transferBlock.indexOf('type="index"'),
    );
    check(
      // ★ 2026-10-23：列表里已不存在「已转交」的行 → 转交状态列没有意义，已删
      '② 前端弹窗：只留「凭证」列，「转交状态」列已删',
      /label="凭证"/.test(transferBlock) &&
        !/label="转交状态"/.test(transferBlock) &&
        !/row\.transferred/.test(transferBlock),
    );
    check(
      '② 前端：不再靠前端过滤已转交（服务端候选接口已过滤）',
      !/filter\(\(r\) => !r\.transferred\)/.test(feeList) &&
        /还没上传到财务/.test(feeList),
    );
    // ★ 2026-10-25 用户要求：重新登记的行要回到候选列表，并标明「重新登记」（不新建单）
    check(
      '★ ② 前端：转交弹窗能区分「重新登记」（retransfer），并说明会更新财务原单',
      /retransfer/.test(feeList) &&
        /重新登记/.test(feeList) &&
        /(更新财务原单|上传后又重新登记)/.test(feeList),
    );
    check(
      '③ 上传缴费金额默认带出「应缴金额」',
      /paymentForm\.amountYuan = Number\(\(row\.feeAmount \|\| 0\) \/ 100\)/.test(feeList),
    );
    check('③ 接口层：fetchTransferCandidates / transferFees 已挂上', /fetchTransferCandidates/.test(api) && /transferFees/.test(api));

    check(
      '块注释安全：改动的 4 个文件里没有 **/',
      [route, api, feeList, types].every((s) => !s.includes('**/')),
    );

    /* ================= B. live ================= */
    let token = '';
    let who = '';
    for (const acc of ['sunmin', 'qiansy']) {
      const t = await login(acc);
      if (!t) continue;
      const probe = await req(`${BASE}/api/class-jh/fee/transfer`, { method: 'POST', token: t, timeout: 15000, body: { feeIds: ['__probe__'] } });
      // 不存在的 id 会走「跳过」，说明权限已通过
      if (probe.json?.code === 200 || probe.json?.data?.skipped) {
        token = t;
        who = acc;
        break;
      }
    }
    check('拿到有转交权限的账号（live 前置）', !!token, who || 'sunmin / qiansy 都无权 → 下面必然红');
    if (!token) throw new Error('无可用账号，live 段无法继续');

    dbJh = conn('sms_class_jh');
    dbFin = conn('sms_finance');

    const rows = [
      baseRow({
        id: FIX_A,
        student_no: `${P}NOA`,
        pay_method: 1, // 微信支付
        paid_amount: 123456,
        pay_date: dayOffset(0),
        pay_remark: '自检-转账单号 WX999',
        voucher_url: `/uploads/voucher/${P}a.png`,
      }),
      baseRow({
        id: FIX_B,
        student_no: `${P}NOB`,
        pay_method: 3, // 现金
        paid_amount: 90000,
        pay_date: dayOffset(-1),
        pay_remark: null,
        voucher_url: null,
      }),
      baseRow({ id: FIX_C, student_no: `${P}NOC`, pay_method: null, paid_amount: null, pay_date: null }),
    ];
    /**
     * ★★ 2026-10-23：夹具必须**双写**（老表 + 统一表 `sms_common.t_uni_fee`）
     *   转交候选/回写都走 `tbl()` → 统一表；只写老表 →
     *   候选里查不到、转交回「缴费单不存在」，断言全红（实测 18/29，红的是夹具）。
     */
    dbUni = conn('sms_common');
    for (const r of rows) {
      try {
        const exists = await dbJh('t_class_fee').where({ id: r.id }).first('id');
        if (exists) await dbJh('t_class_fee').where({ id: r.id }).update(r);
        else await dbJh('t_class_fee').insert(r);
      } catch (e) {
        console.log(`（老表 t_class_fee 写入跳过：${e?.message || e}）`);
      }
      const uniRow = { ...r, edu_stage: 'jh' };
      const uniExists = await dbUni('t_uni_fee').where({ id: r.id }).first('id');
      if (uniExists) await dbUni('t_uni_fee').where({ id: r.id }).update(uniRow);
      else await dbUni('t_uni_fee').insert(uniRow);
    }
    check('★ 造了 3 行夹具（老表 + 统一表双写；微信+凭证 / 现金无凭证 / 未登记）', true);

    const cand = await req(`${BASE}/api/class-jh/fee/transfer/candidates`, { token, timeout: 20000 });
    const candRows = cand.json?.data || [];
    const candIds = candRows.map((r) => r.feeId);
    check(
      '★ 候选列表：含已登记的 A/B，不含未登记的 C',
      cand.json?.code === 200 && candIds.includes(FIX_A) && candIds.includes(FIX_B) && !candIds.includes(FIX_C),
      `候选 ${candRows.length} 条`,
    );
    check(
      '★ 候选行带 transferred 标记（新夹具应为 false）',
      candRows.find((r) => r.feeId === FIX_A)?.transferred === false,
    );

    const res = await req(`${BASE}/api/class-jh/fee/transfer`, {
      method: 'POST',
      token,
      timeout: 40000,
      body: { feeIds: [FIX_A, FIX_B, FIX_C] },
    });
    const r1 = res.json?.data || {};
    check(
      '★ 转交：A/B 成功、C 被跳过（未登记缴费）',
      res.json?.code === 200 && r1.success === 2 && r1.failed?.length === 0 && r1.skipped?.some((x) => x.feeId === FIX_C),
      `success=${r1.success} skipped=${r1.skipped?.length} failed=${r1.failed?.length}` +
        (r1.failed?.length ? ` 原因：${r1.failed.map((x) => `${x.feeId.slice(-8)}=${x.reason}`).join('；')}` : ''),
    );

    // ★ 回写发生在统一表（接口写的就是它）→ 断言必须查统一表
    const aRow = await dbUni('t_uni_fee').where({ id: FIX_A }).first();
    const bRow = await dbUni('t_uni_fee').where({ id: FIX_B }).first();
    const finIdOf = (r) => String(r?.finance_fee_id || r?.source_id || '');
    check(
      '★ 台账回写：finance_fee_id 有值（= 已转交；老的 source_system/source_id 也一并写）',
      !!aRow?.finance_fee_id && !!bRow?.finance_fee_id && aRow?.source_system === 'finance' && bRow?.source_system === 'finance',
      `A=${aRow?.finance_fee_id?.slice(0, 8)} B=${bRow?.finance_fee_id?.slice(0, 8)}`,
    );
    if (finIdOf(aRow)) createdFinanceIds.push(finIdOf(aRow));
    if (finIdOf(bRow)) createdFinanceIds.push(finIdOf(bRow));

    const finA = await dbFin('t_finance_fee').where({ id: finIdOf(aRow) }).first();
    const finB = await dbFin('t_finance_fee').where({ id: finIdOf(bRow) }).first();
    check(
      '★ 财务侧真的生成了单据：金额=实缴、状态=待核对(2)、凭证带过去',
      Number(finA?.amount) === 123456 &&
        Number(finA?.pay_status) === 2 &&
        finA?.voucher_url === aRow?.voucher_url &&
        Number(finA?.dept_code) === 1,
      JSON.stringify({ amount: finA?.amount, status: finA?.pay_status, voucher: finA?.voucher_url }),
    );
    check(
      '★ 现金单：无凭证也转交成功，备注里写明「现金收取，无凭证」',
      Number(finB?.amount) === 90000 && String(finB?.remark || '').includes('现金') && String(finB?.remark || '').includes('无凭证'),
      `备注=${finB?.remark}`,
    );
    check(
      '★ 微信单备注带缴费方式（财务表没有 pay_method 列，方式只能写在备注里）',
      String(finA?.remark || '').includes('微信支付'),
      `备注=${finA?.remark}`,
    );
    check(
      '★ 财务单据带学号/姓名，财务能对上是谁交的',
      finA?.student_no === `${P}NOA` && finA?.student_name === '转交测试生',
      `${finA?.student_no} ${finA?.student_name}`,
    );

    /* ---- 重复转交：应被跳过，不会再建一张单 ---- */
    const res2 = await req(`${BASE}/api/class-jh/fee/transfer`, {
      method: 'POST',
      token,
      timeout: 30000,
      body: { feeIds: [FIX_A] },
    });
    const r2 = res2.json?.data || {};
    const finCount = await dbFin('t_finance_fee').where({ id: finIdOf(aRow) }).count({ n: '*' });
    check(
      '★ 重复转交 → 跳过（已上传到位），财务侧不会多出一张单',
      r2.success === 0 && r2.skipped?.some((x) => x.reason.includes('已转交')),
      `success=${r2.success} skipped=${JSON.stringify(r2.skipped)}`,
    );
    check('★ 财务侧那条单仍是唯一一条', Number(finCount?.[0]?.n) === 1, `count=${finCount?.[0]?.n}`);

    /* ---- 入参校验 ---- */
    const empty = await req(`${BASE}/api/class-jh/fee/transfer`, { method: 'POST', token, timeout: 15000, body: { feeIds: [] } });
    check('★ 不勾任何行直接提交 → 被拒（请先勾选）', empty.json?.code !== 200, `code=${empty.json?.code} msg=${empty.json?.message || ''}`);

    /* ---- 前端编译产物 ---- */
    const fe = await req(`${BASE}/src/class-jh/views/FeeList.vue`, { timeout: 15000 });
    check(
      '★ 催费页编译通过，且产物里有「批量上传到财务」与「还没上传到财务」提示',
      fe.status === 200 &&
        fe.raw.includes('批量上传到财务') &&
        fe.raw.includes('还没上传到财务'),
      `status=${fe.status} len=${fe.raw.length}`,
    );
  } catch (e) {
    check('脚本执行未抛异常', false, e?.message || String(e));
  } finally {
    if (dbJh) {
      try {
        await dbJh('t_class_fee').whereIn('id', [FIX_A, FIX_B, FIX_C]).update({ is_deleted: 1 });
        // ★ 双写就双清
        if (dbUni) await dbUni('t_uni_fee').whereIn('id', [FIX_A, FIX_B, FIX_C]).update({ is_deleted: 1 });
        console.log('（已逻辑删除 3 行初高夹具：老表 + 统一表）');
      } catch (e) {
        console.log(`（初高夹具清理失败：${e?.message || e}）`);
      }
      await dbJh.destroy();
    }
    if (dbFin) {
      try {
        if (createdFinanceIds.length) {
          await dbFin('t_finance_fee').whereIn('id', createdFinanceIds).update({ is_deleted: 1 });
          console.log(`（已逻辑删除财务侧自检建的 ${createdFinanceIds.length} 条缴费单）`);
        }
      } catch (e) {
        console.log(`（财务单据清理失败：${e?.message || e}）`);
      }
      await dbFin.destroy();
    }
    if (dbUni) await dbUni.destroy();
    const ok = summary();
    process.exit(ok ? 0 : 1);
  }
})();
