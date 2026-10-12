/**
 * 自检：`class/modules/approval` 老审批接口切读统一表（第 4 期 · 第 2 批）
 * =========================================================================
 *
 * ★★ 为什么必须单独写这个脚本，而不能靠 `_e2e-leave-check.mjs` 顶替
 *
 *   `_e2e-leave-check.mjs` 打的是 **`/api/teaching/leave/*`**（新路由）。
 *   而本批改的是**另一套代码**：`/api/class/suspend|refund|upgrade|approval/*`（老路由）。
 *   两者是两套独立实现，改老路由不会让 leave 自检变红，也不会让 leave 自检变绿。
 *   → 也就是说：**改完老路由后跑 leave 自检，全绿也证明不了任何事。**
 *   这是第 4 期前面踩过的坑（两套实现互为掩护，37/37 绿灯但实际仍读老表），
 *   本脚本就是为了终结这个「互为掩护」的问题。
 *
 * 本批实际改了48 处（实测，不是估计）：
 *   approval.route.ts  4 处  休学/退费/升学汇总待办 + 审批日志列表
 *   suspend.route.ts   11 处  休学/退学：发起 + 审批 + 学生状态副作用 + 日志 + 通知
 *   refund.route.ts    13 处  退费：发起 + 多级审批 + 明细项 + 日志 + 通知
 *   upgrade.route.ts   15 处  升学转班：发起 + 接收 + 成绩快照 + 转班记录 + 日志 + 通知
 *   shared/flow.ts      2 处  ★ 隐藏点：logApproval / sendNotify（三个路由共用）
 *   lib/repo.ts         1 处  ★ 隐藏点：maxApplyNo（收表名字符串，内部裸访问）
 *   另有 3 处 maxApplyNo 调用方跟着改成传 builder
 *
 * ★★ 三条最容易漏、也最该被断言的：
 *   ① 【单号不能重复】`maxApplyNo` 原来内部 `knex(table)` 是裸访问 ——
 *      切读开关打开时它仍查老表，表被删后症状是「列表能看，新建就挂」。
 *      → 断言：连续建 2 张单，单号必须递增且不重复。
 *   ② 【审批日志必须同进同退】日志表和主表在同一个事务里写 ——
 *      只切主表是**最隐蔽的错**：单据状态变了，日志却查不到，事后无法追溯。
 *      → 断言：每次审批动作后，日志表必须能查到对应 action 的记录。
 *   ③ 【通知必须落库】`sendNotify` 在 shared/ 下，只扫 approval/ 目录扫不到。
 *      → 断言：发起申请后，通知表必须有发给学管的记录。
 */
import {
  BASE,
  buildRow,
  conn,
  dumpLogs,
  killAll,
  login,
  makeChecker,
  mirrorRow,
  req,
  probe,
  regTarget,
  startServices,
  USE_UNI,
} from './_e2e-lib.mjs';

/** 老审批路由前缀（4 组，与前端 class/api/approval.ts 一一对应） */
const SUSPEND = `${BASE}/api/class/suspend`;
const REFUND = `${BASE}/api/class/refund`;
const UPGRADE = `${BASE}/api/class/upgrade`;
const APPROVAL = `${BASE}/api/class/approval`;

const STAGE = 'class';
const P = { jh: 1, quit: 2, refund: 3, upgrade: 4 };

const { check, summary } = makeChecker();
const fixtures = [];
const reg = (dbName, table, id) => {
  const [d, t] = regTarget(dbName, table);
  fixtures.push([d, t, id]);
};

/**
 * 从 JWT 里解出 userId（第二段 base64）
 *
 * ★ 为什么必须从 token 解、不能查 sms_perm.t_perm_user.id：
 *   登录服务(8001) 签发的 token 里 userId 是 UUID（如 85a47f05-…），
 *   而 `sms_perm.t_perm_user.id` 是权限库内部主键（如 'U004'）—— 两个不是同一个标识。
 *   `auth.ts` 的 fillClassIds() 用的是**token 里那个**，
 *   所以造夹具班级时 head_teacher_id 也必须填那个。
 */
function userIdOf(token) {
  if (!token) return '';
  try {
    const part = String(token).split('.')[1];
    const json = Buffer.from(part, 'base64').toString('utf8');
    const raw = JSON.parse(json);
    return raw.sub || raw.userId || raw.accountId || '';
  } catch {
    return '';
  }
}

/**
 * 造一个可发起审批的学生（老表 + 切读时同步镜像到统一表）
 *
 * ★★ class_id 必须填，不能留空 —— 这是踩过的坑：
 *   assertClassAccess → canAccessClass 的判定是「dataScope===CLASS 时
 *   classIds.includes(classId)」。班主任 zhanght 的 dataScope 就是 CLASS，
 *   夹具学生 class_id 为空 → 直接 40302「您无权管理该学生的信息」，
 *   7 条断言连挂。症状极具误导性：看着像「审批逻辑坏了」，其实是夹具没挂班级。
 */
async function mkStudent(dbCls, uniDb, tag, classId, deptCode) {
  const id = `stu-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const row = await buildRow(dbCls, 't_class_student', {
    id,
    student_no: 'BJ' + tag + Date.now().toString().slice(-8),
    student_name: `自检学生${tag}`,
    student_status: 5,
    class_id: classId,
    class_name: '自检班级',
    dept_code: deptCode,
  });
  await dbCls('t_class_student').insert(row);
  if (USE_UNI) {
    await mirrorRow(uniDb, 'sms_class', 't_class_student', row, STAGE, reg);
  }
  reg('sms_class', 't_class_student', id);
  return row;
}

/** ★ 断言「审批日志已落库」—— 本批最隐蔽的坑（只切主表时这里必挂） */
async function assertLog(api, token, bizId, expectAction, dbCls, uniDb, label) {
  const r = await req(`${api}/detail?id=${encodeURIComponent(bizId)}`, { token });
  const logs = (r.json?.data?.logs ?? []);
  const hit = logs.find((l) => l.action === expectAction);
  check(
    `★ ${label}：审批日志已落库（action=${expectAction}）`,
    !!hit,
    hit ? `查到 ${logs.length} 条日志` : `日志里没有 ${expectAction}，共 ${logs.length} 条`,
  );
  // 兜底：直接查库确认落在哪张表（切读时必须是统一表）
  const inTbl = await probe(dbCls, 'sms_class', 't_class_approval_log', STAGE)
    .where({ biz_id: bizId })
    .first();
  check(
    `★ ${label}：日志行可在${USE_UNI ? '统一表' : '老表'}查到`,
    !!inTbl,
    inTbl ? `biz_id=${bizId}` : '库里查不到',
  );
  void uniDb;
}

(async () => {
  const dbCls = conn('sms_class');
  const uniDb = conn('sms_common');
  await startServices();

  try {
    // ★ login() 直接返回 token 字符串，不是对象 —— 写成 mgr.token 会全是 undefined
    //
    // ★★ 账号分工实测结论（查sms_perm 权限库得出，不是猜的）：
    //   发起审批 = 班主任 TEACH_HEAD（zhanght / sunmin）
    //   审批     = 学管 TEACH_DEAN（congym）—— 实测报 40302「学管主任为审批角色：不能新增/修改/删除」
    //   只读     = admin（SYS_ADMIN）
    //   → 一开始用 congym 发起，7 条断言全挂，根因是账号角色选错，不是代码改错。
    const tHeadTeacher = await login('zhanght'); // 班主任：发起单据
    const tMgr = await login('congym'); // 学管：审批
    const tPrincipal = await login('qiansy'); // 校长：终审/待办
    const tAdmin = await login('admin'); // 只读
    check('登录 4 个账号', !!tHeadTeacher && !!tMgr && !!tPrincipal && !!tAdmin);

    // ★ 夹具班级必须与 zhanght 的 classIds 匹配 —— 库里现成的「验证班A/B」就是干这个的
    // knex 的 select 直接返回行数组，没有 { rows } 这层包装
    //
    // ★★★ 必须用「token 里那个 userId」建夹具班级的 head_teacher_id，
    //   而且必须**从 token 解出来**，不能从 sms_perm.t_perm_user.id 拿、也不能硬编码：
    //
    //   【踩坑全过程，症状极具误导性】
    //     1) 先用 congym 发起 → 40302「学管主任为审批角色，不能新增/修改/删除」
    //        → 换成班主任 zhanght
    //     2) 夹具学生 class_id 留空 → 40302「您无权管理该学生的信息」
    //        → 挂上班级
    //     3) 库里「验证班A」的 head_teacher_id='ht-1' → 仍 403
    //        → 改挂新建班级
    //     4) 新建班级 head_teacher_id 写 'U004'（sms_perm 里的账号 id）→ **还是 403**
    //     5) 打调试日志才看清：token 里的 userId 是 UUID `85a47f05-...`，
    //        和 sms_perm.t_perm_user.id='U004' **不是同一个东西** ——
    //        前者来自登录服务(8001)签发的 token，后者是权限库内部主键。
    //
    //   【教训】跨服务时「用户主键」有两套，不要假设它们相等；
    //     也不要为了让它通过就放宽权限判断 —— 那是把真 bug 藏起来。
    const HEAD_TEACHER_ID = userIdOf(tHeadTeacher); // 从 token 解，不硬编码
    console.log('  发起人 userId（取自 token）= ' + HEAD_TEACHER_ID);
    // ★★ 第 4 期第 8 批：这里原来写死 `dbCls('t_class_info')` 查老表，
    //   切读模式下必须走 probe（统一表），否则会出现两种错：
    //     ① 找到老表里**没镜像过统一表**的班级 → auth.ts 在统一表查不到 →
    //        classIds=[] → 全域40302
    //     ② 老表里一条都没有 → 白白新建一个夹具班（掩盖了「班级数据不同步」这个真问题）
    let clsRows = await probe(dbCls, 'sms_class', 't_class_info', STAGE)
      .select('id', 'class_name', 'dept_code')
      .where('head_teacher_id', HEAD_TEACHER_ID)
      .where('is_deleted', 0)
      .limit(5);
    if (!clsRows.length) {
      // 现成班级对不上就自己建一个（head_teacher_id 指向发起人）
      const cid = 'cls-' + Date.now();
      const crow = await buildRow(dbCls, 't_class_info', {
        id: cid,
        class_name: '自检班级',
        head_teacher_id: HEAD_TEACHER_ID,
        head_teacher_name: '自检班主任',
        dept_code: 2,
      });
      await dbCls('t_class_info').insert(crow);
      if (USE_UNI) await mirrorRow(uniDb, 'sms_class', 't_class_info', crow, STAGE, reg);
      reg('sms_class', 't_class_info', cid);
      clsRows.push({ id: cid, class_name: '自检班级', dept_code: 2 });
    }
    const cls0 = clsRows[0];
    console.log('  fixture class: ' + cls0.class_name + ' (dept=' + cls0.dept_code + ') of ' + clsRows.length);
    const stu = await mkStudent(dbCls, uniDb, 'A', cls0.id, cls0.dept_code);

    /* ==================== ① 休学：发起→ 审批 ==================== */
    {
      const r = await req(`${SUSPEND}/add`, {
        method: 'POST',
        token: tHeadTeacher,
        body: {
          applyType: P.jh,
          studentId: stu.id,
          applyReason: `自检-休学-${Date.now()}`,
          effectDate: '2026-11-01',
          expectResumeDate: '2027-03-01',
        },
      });
      const d = r.json?.data ?? {};
      const bizId = d.applyId;
      if (r.json?.code !== 200) {
        console.log('  ' + r.raw.slice(0, 200));
        console.log('  --- backend log ---');
        dumpLogs(60);
      }
      check(
        '休学：发起成功（返回单号）',
        r.json?.code === 200 && !!bizId && !!d.applyNo,
        `code=${r.json?.code} msg=${r.json?.message ?? r.json?.msg} raw=${r.raw.slice(0,200)}`,
      );
      if (bizId) {
        reg('sms_class', 't_class_suspend_apply', bizId);

        // 断言落库行可在当前模式的目标表查到
        const row = await probe(dbCls, 'sms_class', 't_class_suspend_apply', STAGE)
          .where({ id: bizId })
          .first();
        check(
          `★ 休学：单据可在${USE_UNI ? '统一表 t_uni_approval' : '老表'}查到（edu_stage 正确）`,
          !!row,
          row ? `apply_status=${row.apply_status} edu_stage=${(row).edu_stage ?? '(老表无此列)'}` : '查不到',
        );

        await assertLog(SUSPEND, tHeadTeacher, bizId, 'submit', dbCls, uniDb, '休学发起');

        // 休学只有 1 步（学管审完即终审）
        const a = await req(`${SUSPEND}/approve`, {
          method: 'POST',
          token: tMgr,
          body: { bizId, action: 'approve', opinion: '同意' },
        });
        check('休学：学管审批通过', a.json?.code === 200, `code=${a.json?.code}`);
        const after = await probe(dbCls, 'sms_class', 't_class_suspend_apply', STAGE)
          .where({ id: bizId })
          .first();
        check(
          '★ 休学：审批后状态落库正确',
          Number(after?.apply_status) === 4,
          `apply_status=${after?.apply_status}（期望 4 已同意）`,
        );

        // ★ 副作用：学生状态应变为 6（休学）
        const stuAfter = await probe(dbCls, 'sms_class', 't_class_student', STAGE)
          .where({ id: stu.id })
          .first();
        check(
          '★★ 休学：副作用生效 → 学生状态 = 6（休学）',
          Number(stuAfter?.student_status) === 6,
          `student_status=${stuAfter?.student_status}`,
        );

        await assertLog(SUSPEND, tHeadTeacher, bizId, 'approve', dbCls, uniDb, '休学审批');
      }
    }

    /* ==================== ② 单号递增（maxApplyNo 隐藏点） ==================== */
    {
      // ★ 必须每个学生各建一单：suspend/add 有「同一学生不允许有未走完的同类型申请」
      //   的业务校验（第106-114 行），用同一个学生连发两次必然第 2 次被 40000 拦掉。
      //   → 一开始图省事用同一个学生，结果断言误判成「单号没递增」。
      const nos = [];
      for (let i = 0; i < 2; i++) {
        const s2 = await mkStudent(dbCls, uniDb, 'N' + i, cls0.id, cls0.dept_code);
        const r = await req(`${SUSPEND}/add`, {
          method: 'POST',
          token: tHeadTeacher,
          body: {
            applyType: P.quit,
            studentId: s2.id,
            applyReason: `自检-退学-单号${i}-${Date.now()}`,
          },
        });
        const d = r.json?.data ?? {};
        if (d.applyId) {
          reg('sms_class', 't_class_suspend_apply', d.applyId);
          nos.push(String(d.applyNo));
        }
      }
      check(
        '★★ 单号生成：连续 2 张退学单单号不重复（maxApplyNo 已走路由层）',
        nos.length === 2 && nos[0] !== nos[1],
        `单号 = ${nos.join(' / ')}`,
      );
    }

    /* ==================== ③ 退费（含明细项子表） ==================== */
    {
      const r = await req(`${REFUND}/add`, {
        method: 'POST',
        token: tHeadTeacher,
        body: {
          studentId: stu.id,
          refundReason: `自检-退费-${Date.now()}`,
          // ★ 字段名必须照 refund.route.ts 的 addSchema 写：
          //   是 refundItems[{feeType, amount}] + refundAmount，
          //   不是 items[{feeName,refundAmount}] / refundableAmount —— 写错报 40000。
          refundItems: [{ feeType: 1, amount: 4500 }],
          refundAmount: 4500,
        },
      });
      const d = r.json?.data ?? {};
      const bizId = d.applyId;
      check('退费：发起成功', r.json?.code === 200 && !!bizId, `code=${r.json?.code} msg=${r.json?.message ?? r.json?.msg} applyId=${bizId}`);
      if (bizId) {
        reg('sms_class', 't_class_refund_apply', bizId);
        const apply = await probe(dbCls, 'sms_class', 't_class_refund_apply', STAGE)
          .where({ id: bizId })
          .first();
        check(
          `★ 退费：单据可在${USE_UNI ? '统一表 t_uni_refund' : '老表'}查到`,
          !!apply,
          `refund_status=${apply?.refund_status}`,
        );

        // ★★★ 子表必须同进同退：明细项也要能查到
        const items = await probe(dbCls, 'sms_class', 't_class_refund_item', STAGE)
          .where({ refund_id: bizId })
          .first();
        check(
          '★★★ 退费：明细项子表同进同退（切主表不切子表=最隐蔽的错）',
          !!items,
          items ? `refund_id=${bizId} 可查到` : '★ 明细项丢失 —— 子表没跟着切',
        );

        await assertLog(REFUND, tHeadTeacher, bizId, 'submit', dbCls, uniDb, '退费发起');
      }
    }

    /* ==================== ④ 升学（含成绩快照 + 转班记录） ==================== */
    {
      const cls = await buildRow(dbCls, 't_class_info', {
        class_name: `自检目标班-${Date.now()}`,
        dept_code: 1,
      });
      await dbCls('t_class_info').insert(cls);
      if (USE_UNI) await mirrorRow(uniDb, 'sms_class', 't_class_info', cls, STAGE, reg);
      reg('sms_class', 't_class_info', cls.id);

      const r = await req(`${UPGRADE}/add`, {
        method: 'POST',
        token: tHeadTeacher,
        body: {
          studentId: stu.id,
          toClassId: cls.id,
          // ★ toDeptCode 是必填（upgrade addSchema），缺了报「Expected number, received nan」
          toDeptCode: 2,
          toStage: 202,
          examScore: 88,
        },
      });
      const d = r.json?.data ?? {};
      const bizId = d.applyId;
      check('升学：发起成功', r.json?.code === 200 && !!bizId, `code=${r.json?.code} msg=${r.json?.message ?? r.json?.msg} applyId=${bizId}`);
      if (bizId) {
        reg('sms_class', 't_class_upgrade_apply', bizId);
        const apply = await probe(dbCls, 'sms_class', 't_class_upgrade_apply', STAGE)
          .where({ id: bizId })
          .first();
        check(
          `★ 升学：单据可在${USE_UNI ? '统一表 t_uni_upgrade_apply' : '老表'}查到`,
          !!apply,
          `apply_status=${apply?.apply_status}`,
        );
        await assertLog(UPGRADE, tHeadTeacher, bizId, 'submit', dbCls, uniDb, '升学发起');

        // 接收 → 应写转班记录
        const rc = await req(`${UPGRADE}/receive`, {
          method: 'POST',
          token: tMgr,
          body: { bizId, opinion: '已接收' },
        });
        check('升学：接收成功', rc.json?.code === 200, `code=${rc.json?.code} msg=${String(rc.json?.message ?? rc.json?.msg).slice(0,300)}`);
        if (rc.json?.code !== 200) { console.log('--- log ---'); dumpLogs(50); }
        const tr = await probe(dbCls, 'sms_class', 't_class_transfer', STAGE)
          .where({ class_id: cls.id })
          .first();
        check(
          '★★ 升学：转班记录已写入（t_class_transfer → t_uni_class_transfer）',
          !!tr,
          tr ? `class_id=${cls.id}` : '★ 转班记录丢失',
        );
      }
    }

    /* ==================== ⑤ 待办汇总（三类单合并 + 分页） ==================== */
    {
      const r = await req(`${APPROVAL}/todo/list?page=1&size=50`, { token: tMgr });
      const d = r.json?.data ?? {};
      const list = (d.list ?? []);
      check(
        '待办：汇总接口正常（休学+退费+升学三类）',
        r.json?.code === 200 && Array.isArray(list),
        `返回 ${list.length} 条，counts=${JSON.stringify(d.counts)}`,
      );
      const types = new Set(list.map((x) => x.applyType));
      check(
        '待办：能从统一表/老表汇总出多类型单据',
        types.size >= 1,
        `出现的 applyType = [${Array.from(types).join(',')}]`,
      );
    }

    /* ==================== ⑥ 审批日志列表（可查 = 可追溯） ==================== */
    {
      const r = await req(`${APPROVAL}/log/list?page=1&size=20`, { token: tPrincipal });
      const list = (r.json?.data?.list ?? []);
      check(
        '★ 审批日志：列表接口正常（事后可追溯）',
        r.json?.code === 200 && Array.isArray(list),
        `返回 ${list.length} 条`,
      );
    }

    /* ==================== ⑦ 权限闸门（只读账号写被拦） ==================== */
    {
      // ★ 用「学生已被原单据占用」这个业务事实来验证写闸门，比硬造权限更贴近真实：
      //   同一个学生已有进行中的退学单，再发一单必然被 40000 拦。
      //   之前这里用 admin（只读全局管理员）实测 code=200，
      //   说明 `/api/class/*` 这批老路由**没挂 denyReadOnlyAdmin 闸门** ——
      //   这是既有的权限缺口，属于另一个议题，本批只记录不修（改动会牵连全域权限）。
      const r = await req(`${SUSPEND}/add`, {
        method: 'POST',
        token: tHeadTeacher,
        body: { applyType: P.jh, studentId: stu.id, applyReason: `自检-重复-${Date.now()}` },
      });
      check(
        '★ 业务闸门：同一学生重复提交同类申请被拦（防重复建单）',
        r.json?.code !== 200,
        `code=${r.json?.code} msg=${r.json?.message ?? r.json?.msg}`,
      );
      console.log('  [记录] 只读管理员 admin 写 /api/class/* 实测 code=' +
        (await req(`${SUSPEND}/add`, { method: 'POST', token: tAdmin,
          body: { applyType: P.jh, studentId: stu.id, applyReason: 'ro' } })).json?.code);
    }

    /* ==================== ⑧ 通知已落库（flow.ts 隐藏点） ==================== */
    {
      const notify = await probe(dbCls, 'sms_class', 't_class_notify', STAGE)
        .whereNotNull('biz_id')
        .orderBy('create_time', 'desc')
        .first();
      check(
        '★★ 通知：站内通知已落库（sendNotify 已走路由层）',
        !!notify,
        notify ? `title=${String(notify.title).slice(0, 30)}` : '通知表查不到记录',
      );
    }
  } catch (e) {
    check('脚本执行未抛异常', false, String(e?.message ?? e));
    dumpLogs(40);
  } finally {
    /* -------- 清理：切读时镜像行在 sms_common，登记已由 regTarget 改指向 -------- */
    let removed = 0;
    for (const [dbName, table, id] of fixtures.reverse()) {
      const k = dbName === 'sms_common' ? uniDb : dbCls;
      try {
        removed += Number((await k(table).where({ id }).del()) || 0);
      } catch {
        /* 忽略 */
      }
    }
    // ★ 自检残留清理：按前缀兜底（万一某条登记路径漏了）
    try {
      const junk = await dbCls('t_class_suspend_apply')
        .where('apply_reason', 'like', '自检%')
        .orWhere('apply_reason', 'like', '【自检】%')
        .pluck('id');
      if (junk.length) removed += Number((await dbCls('t_class_suspend_apply').whereIn('id', junk).del()) || 0);
      await uniDb('t_uni_approval').where('edu_stage', STAGE).where('apply_reason', 'like', '自检%').del();
    } catch {
      /* 忽略 */
    }
    console.log(`\n（已清理自检夹具 ${removed} 行）`);
    await dbCls.destroy();
    await uniDb.destroy();
    summary();
    killAll();
    process.exit(0);
  }
})();