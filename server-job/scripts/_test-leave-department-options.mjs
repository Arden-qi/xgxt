/**
 * 回归自检：发起申请的「部门」下拉（取代原「学段」）
 * ============================================================
 *
 * 【背景 / 需求】
 *   用户口径：「把学段改为部门，下拉四个选项：初高中 / 大学 / 实训 / 就业」。
 *   技术上只有 3 个学段（jh / class / job，各一个库），且「实训」与「就业」
 *   共用同一个库（`sms_job` = 就业管理）。按业务确认：
 *   **四个选项都要展示**，但「就业」暂不办理学籍异动 → 选中时提示 + 置灰，
 *   它是 `stage = null`（不是给个假学段、让用户填完再报错）。
 *
 * 【这条链上最容易坏的地方】
 *   ① 部门列表被抄成两份（后端一份、前端一份）→ 改一处漏一处，两边不一致
 *      → 本自检钉住「后端 /meta 是权威来源，且四项目的中文名/顺序稳定」；
 *   ② 「就业」被误当成一个真学段传下去 → 后端 mustStage 会 40000，
 *      但如果哪天有人给它补了个假学段，就会静默写进错误的库
 *      → 本自检钉住「employ 不是合法 stage 参数」；
 *   ③ 三个可用部门的学段映射被改错（比如 初高中 指到 class）→ 学生搜不到 /
 *      单子落到别的库 → 本自检用真实数据清点各学段的候选学生数来钉住。
 *      ⚠️ 交叉核对必须用**同一口径**：候选数 = 该库「非终态」在册人数
 *      （退学 7 / 流失 11 / 已就业 10 自 2026-10-16 起不下发，详见 service.ts）。
 *
 * 【跑法】在 server-job 目录下（前后端已在 8004/5173 运行）：
 *     node scripts/_test-leave-department-options.mjs
 */
import { BASE, conn, login, makeChecker, req } from './_e2e-lib.mjs';

const API = `${BASE}/api/teaching/leave`;
const { check, summary } = makeChecker();

/** 部门码 → 期望学段（学段是中转层的技术值，部门是用户看到的业务值） */
const EXPECT = [
  { code: 'jh', name: '初高中', stage: 'jh' },
  { code: 'class', name: '大学', stage: 'class' },
  { code: 'job', name: '实训', stage: 'job' },
  { code: 'employ', name: '就业', stage: null },
];

(async () => {
  const dbJh = conn('sms_class_jh');
  try {
    /* ---------- A. 服务就绪 ---------- */
    const health = await req('http://127.0.0.1:8004/health', { timeout: 4000 });
    check('后端在跑（/health 200）', health.json?.code === 200, `code=${health.json?.code}`);
    if (health.json?.code !== 200) {
      console.log('  ⚠️ 后端没起，请先启动服务（一键启动.bat），再跑本脚本。');
      return;
    }

    const token = await login('qiansy'); // 三学段都可见
    check('登录成功', !!token);

    /* ---------- B. /meta 下发四个部门 ---------- */
    const meta = await req(`${API}/meta`, { token });
    const depts = meta.json?.data?.departments || [];
    check(
      '★ /meta 下发 departments（前端不另抄一份，改后端即可）',
      meta.json?.code === 200 && Array.isArray(depts) && depts.length === 4,
      `共 ${depts.length} 项：${depts.map((d) => d.name).join('/')}`,
    );
    check(
      '★ 四个部门的中文名与顺序 = 初高中 / 大学 / 实训 / 就业',
      depts.map((d) => d.name).join(',') === '初高中,大学,实训,就业',
      depts.map((d) => d.name).join(','),
    );
    check(
      '★ 部门 → 学段映射正确（初高中→jh、大学→class、实训→job、就业→null）',
      EXPECT.every((e) => depts.find((d) => d.code === e.code)?.stage === e.stage),
      depts.map((d) => `${d.name}→${d.stage ?? 'null'}`).join(' '),
    );
    check(
      '★ 「就业」是 stage=null（占位、暂不可用），不是假学段',
      depts.find((d) => d.code === 'employ')?.stage === null,
      `employ.stage=${JSON.stringify(depts.find((d) => d.code === 'employ')?.stage)}`,
    );

    /* ---------- C. 三个可用部门各自能搜到「该部门库里的学生」（映射没被改错） ---------- */
    /** 学段 → 该学段的学生表（用于与接口返回人数交叉核对） */
    const STU_TABLE = {
      jh: ['sms_class_jh', 't_class_student'],
      class: ['sms_class', 't_class_student'],
      job: ['sms_job', 't_student_base'],
    };
    /**
     * ★ 终态学生（退学 7 / 流失 11 / 已就业 10）不下发到候选名单里
     *   （2026-10-16 起，见 service.ts 的 TERMINAL_STUDENT_STATUSES）。
     *   所以交叉核对时**必须用同一口径**，否则等式永远不成立：
     *   库里全量 32 人 vs 接口 28 人 —— 看起来像「映射指错库」，其实是口径不同。
     *   ⚠️ 老数据里 student_status 可能为 NULL，单写 NOT IN 会连 NULL 行一起滤掉，
     *      和仓储一样要补 `OR IS NULL`。
     */
    const TERMINAL = [7, 10, 11];
    const LIMIT = 200;
    for (const e of EXPECT.filter((x) => x.stage)) {
      const stage = e.stage;
      const [dbName, table] = STU_TABLE[stage];
      const db = dbName === 'sms_class_jh' ? dbJh : conn(dbName);
      const dbCount = Number(
        (await db(table)
          .where('is_deleted', 0)
          .andWhere((b) => b.whereNotIn('student_status', TERMINAL).orWhereNull('student_status'))
          .count({ c: '*' })
          .first())?.c || 0,
      );
      if (dbName !== 'sms_class_jh') await db.destroy();

      const r = await req(`${API}/student-options?stage=${stage}&limit=${LIMIT}`, { token });
      const n = (r.json?.data || []).length;
      // ★ 不写死「必须有人」，但要求「接口返回人数 = 该库**非终态**在册人数（受 limit 截断）」——
      //   映射指错库时这个等式立刻不成立（比如指到空的库 → 0 vs 28）。
      check(
        `★ 部门「${e.name}」（stage=${stage}）候选人数 = 该部门库**非终态**在册人数`,
        r.json?.code === 200 && n === Math.min(dbCount, LIMIT),
        `接口 ${n} 人 / ${dbName}.${table} 非终态在册 ${dbCount} 人`,
      );
    }
    const jhTotal = Number(
      (await dbJh('t_class_student').where('is_deleted', 0).count({ c: '*' }).first())?.c || 0,
    );
    check(
      '★ 初高部门确实有在册学生（保证上面那条等式不是 0=0 的空转）',
      jhTotal > 0,
      `库内初高在册 ${jhTotal} 人`,
    );

    /* ---------- D. 「就业」不能当学段传下去 ---------- */
    const asStage = await req(`${API}/student-options?stage=employ&limit=5`, { token });
    check(
      '★ employ 不是合法 stage 参数 → 后端明确拒绝（40000），不会被当成真学段',
      asStage.json?.code === 40000,
      `code=${asStage.json?.code} msg=${asStage.json?.message}`,
    );

    const asCreate = await req(`${API}/create`, {
      method: 'POST',
      token,
      body: {
        stage: 'employ',
        studentId: 'not-a-real-student',
        bizType: 1,
        leaveReason: '自检-就业部门不该能建单',
      },
    });
    check(
      '★ 用 employ 建单 → 被拒（不会静默写进某个库）',
      asCreate.json?.code === 40000,
      `code=${asCreate.json?.code} msg=${asCreate.json?.message}`,
    );
  } catch (e) {
    check('脚本执行未抛异常', false, e?.message || String(e));
  } finally {
    await dbJh.destroy();
    const ok = summary();
    process.exit(ok ? 0 : 1);
  }
})();
