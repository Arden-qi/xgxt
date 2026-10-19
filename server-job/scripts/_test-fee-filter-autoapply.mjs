/**
 * 自检：催费/缴费域四页筛选「选完即查」（2026-10-19 用户要求）
 * ============================================================
 * 【背景】催费/缴费（教学域 fee，页签式：初高 FeeList / 大学 Urge /
 *   实训 FeeCallList / 教务 PaymentList）原来选完筛选要点「查询/筛选」才生效，
 *   用户视角就是「筛选没生效」。本批把四页筛选全部改成「选完即查」。
 *
 * 【钉住什么】
 *   ① 筛选区里每个 el-select / el-switch / el-checkbox / el-date-picker
 *      都必须带 @change（关键字 input 用 @keyup.enter + @clear）——
 *      以后新增筛选项忘了接 @change，这里直接红；
 *   ② 四页都要过 Vite 编译（改动是纯模板属性，编译失败立刻暴露）。
 *
 * 【跑法】在 server-job 目录下（前端 5173 运行中）：
 *     node scripts/_test-fee-filter-autoapply.mjs
 *   静态段不依赖服务；编译段需要 Vite。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BASE, makeChecker, req } from './_e2e-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PAGES = [
  { name: '初高 FeeList', rel: 'web-job/src/class-jh/views/FeeList.vue', form: '<el-form :model="query" inline>' },
  { name: '大学 Urge', rel: 'web-job/src/class/views/Urge.vue', form: null },
  { name: '实训 FeeCallList', rel: 'web-job/src/views/FeeCallList.vue', form: '<el-form :model="query" inline>' },
  { name: '教务 PaymentList·总记录', rel: 'web-job/src/views/edu/PaymentList.vue', form: '<el-form :model="totalQuery" inline>' },
  { name: '教务 PaymentList·即将到期', rel: 'web-job/src/views/edu/PaymentList.vue', form: '<el-form :model="expQuery" inline>' },
  { name: '费用中转 TeachingFeeHub', rel: 'web-job/src/teaching/views/TeachingFeeHub.vue', form: null },
];

const { check, summary } = makeChecker();

/** 筛选区里没有 @change 的控件清单（select/switch/checkbox/datepicker） */
function unwired(section) {
  const bad = [];
  for (const m of section.matchAll(/<(el-select|el-switch|el-checkbox|el-date-picker)\b[^>]*>/g)) {
    if (!m[0].includes('@change')) bad.push(m[0].slice(0, 60).replace(/\s+/g, ' '));
  }
  return bad;
}

(async () => {
  try {
    /* ---------- A. 静态契约：每个筛选控件都带 @change ---------- */
    for (const pg of PAGES) {
      const full = readFileSync(path.join(ROOT, pg.rel.replace('/', '\\')), 'utf8');
      let section = full;
      if (pg.form) {
        const i = full.indexOf(pg.form);
        const j = full.indexOf('</el-form>', i);
        section = full.slice(i, j);
      }
      const bad = unwired(section);
      check(
        `★ ${pg.name}：筛选控件全部「选完即查」（无漏接 @change 的 select/switch/checkbox/date-picker）`,
        bad.length === 0,
        bad.length ? '漏接：' + bad.join(' | ') : '全部已接 @change',
      );
    }

    /* ---------- A2. 催费页部门维度（2026-10-19 二次要求：列表部门列 + 部门筛选） ---------- */
    const feeSrc = readFileSync(path.join(ROOT, 'web-job', 'src', 'class-jh', 'views', 'FeeList.vue'), 'utf8');
    check(
      '★ 催费页有部门筛选（全部部门/初高/大学/就业）且列表有部门列',
      feeSrc.includes('label="部门"') && feeSrc.includes("dept: 'all'") && feeSrc.includes("row.dept || '初高'"),
    );
    check(
      '★ 三源接线（初高台账 fetchFeeList + 大学催缴 urgeList + 就业催费单 fetchFeeCallList）',
      feeSrc.includes('fetchFeeList(') && feeSrc.includes('urgeList(') && feeSrc.includes('fetchFeeCallList('),
    );
    check(
      '★ 初高功能保留：催费推送/记录按钮仅在初高行，导出与催费记录按钮在初高视图',
      feeSrc.includes('isJhRow(row)') && feeSrc.includes('v-if="query.dept === \'jh\'"'),
    );

    /* ---------- B. live：Vite 编译通过 ---------- */
    for (const pg of PAGES) {
      const r = await req(`${BASE}/src/${pg.rel.replace('web-job/src/', '')}`, { timeout: 8000 });
      check(
        `★ ${pg.name} 编译通过（Vite 200 且产出渲染函数）`,
        r.status === 200 && (r.raw.includes('render') || r.raw.includes('createVNode') || r.raw.length > 500),
        `status=${r.status} len=${r.raw.length}`,
      );
    }
  } catch (e) {
    check('脚本执行未抛异常', false, e?.message || String(e));
  } finally {
    const ok = summary();
    process.exit(ok ? 0 : 1);
  }
})();
