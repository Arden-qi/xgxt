/**
 * 各职位的「默认可见页面」兜底表（单一事实来源的备份）
 *
 * ============================================================
 * 【为什么需要它 —— 2026-10-22 实测出来的坑】
 *   `deriveDefaultPaths()` 是拿「权限库里该职位勾过的**功能点名**」
 *   去匹配新权限树的**页面名**。这在两种情况下会失效：
 *
 *   ① **老库升级**：别人的库里还是旧树（`market||学生档案` 之类），
 *      而新树页面叫 `consult||学生管理` → 交集为 0 → 推导出 0 页。
 *      实测：用旧 SQL 建的库跑 seed，财务只拿到 3 页、班主任 5 页，
 *      而正确值应是 9 页、11 页。
 *   ② **新建职位**：还没勾过任何东西，推导结果为空。
 *
 * 【它怎么用】
 *   seed-perm-tree.ts 里：
 *      初始授权 = 旧推导结果 ∪ 本表
 *   所以老库跑一次 seed 就能补齐到与新环境一致（只会补，不会砍）。
 *
 * 【以后权限调整了怎么办】
 *   这张表跟着 `permTree.ts` 一起改；或直接跑
 *   `npx tsx scripts/export-role-defaults.ts` 从当前库重新导出。
 * ============================================================
 */

/** roleCode → ['moduleKey||页面名', ...] */
export const ROLE_DEFAULT_PAGES: Record<string, string[]> = {
  /** 咨询老师（5 页） */
  MKT_CONSULT: [
    'workbench||工作台',
    'consult||学生管理',
    'consult||收款与缴费',
    'consult||流失记录',
    'consult||退费管理',
  ],
  /** 咨询经理（6 页） */
  MKT_MANAGER: [
    'workbench||工作台',
    'consult||学生管理',
    'consult||审批中心',
    'consult||收款与缴费',
    'consult||流失记录',
    'consult||退费管理',
  ],
  /** 班主任（11 页） */
  TEACH_HEAD: [
    'workbench||工作台',
    'teach||休学/退学审批',
    'teach||催费',
    'teach||出勤管理',
    'teach||学生档案',
    'teach||宿舍管理',
    'teach||待接收学员',
    'teach||成绩管理',
    'teach||班级管理',
    'teach||考试管理',
    'teach||退费',
  ],
  /** 教员（9 页） */
  TEACH_TUTOR: [
    'workbench||工作台',
    'teach||催费',
    'teach||出勤管理',
    'teach||学生档案',
    'teach||宿舍管理',
    'teach||待接收学员',
    'teach||成绩管理',
    'teach||班级管理',
    'teach||考试管理',
  ],
  /** 助教（9 页） */
  TEACH_ASSIST: [
    'workbench||工作台',
    'teach||催费',
    'teach||出勤管理',
    'teach||学生档案',
    'teach||宿舍管理',
    'teach||待接收学员',
    'teach||成绩管理',
    'teach||班级管理',
    'teach||考试管理',
  ],
  /** 学管主任（11 页） */
  TEACH_DEAN: [
    'workbench||工作台',
    'teach||休学/退学审批',
    'teach||催费',
    'teach||出勤管理',
    'teach||学生档案',
    'teach||宿舍管理',
    'teach||待接收学员',
    'teach||成绩管理',
    'teach||班级管理',
    'teach||考试管理',
    'teach||退费',
  ],
  /** 教质经理（11 页） */
  TEACH_QTY: [
    'workbench||工作台',
    'teach||休学/退学审批',
    'teach||催费',
    'teach||出勤管理',
    'teach||学生档案',
    'teach||宿舍管理',
    'teach||待接收学员',
    'teach||成绩管理',
    'teach||班级管理',
    'teach||考试管理',
    'teach||退费',
  ],
  /** 学术经理（11 页） */
  ACAD_MANAGER: [
    'workbench||工作台',
    'teach||休学/退学审批',
    'teach||催费',
    'teach||出勤管理',
    'teach||学生档案',
    'teach||宿舍管理',
    'teach||待接收学员',
    'teach||成绩管理',
    'teach||班级管理',
    'teach||考试管理',
    'teach||退费',
  ],
  /** 教务老师（7 页） */
  ACAD_STAFF: [
    'workbench||工作台',
    'consult||学生管理',
    'consult||审批中心',
    'teach||休学/退学审批',
    'teach||催费',
    'teach||学生档案',
    'teach||宿舍管理',
  ],
  /** 财务（9 页） */
  FIN_STAFF: [
    'workbench||工作台',
    'consult||学生管理',
    'consult||审批中心',
    'finance||冻结名单',
    'finance||缴费管理',
    'finance||财务概览',
    'finance||账单明细',
    'finance||费用标准',
    'finance||退费管理',
  ],
  /** 就业老师（6 页） */
  JOB_STAFF: [
    'workbench||工作台',
    'teach||复盘填写',
    'teach||学生档案',
    'teach||就业日志',
    'teach||数据统计',
    /**
     * ★ 2026-10-23：「班级管理」
     *
     * 用户报障：交接给就业老师后，他看不到交接的班级 / 班级详情 / 交接记录。
     * 根因有两层，这是第二层：
     *   ① `pagePermissionSource.ts` 的静态表里 JOB_STAFF 没有 `job:class:view`（已补）；
     *   ② 就算静态表有，`removeCodesOfRevokedPages()` 会按**权限树**把
     *      「一个动作都没勾」的页面码剔掉 —— 就业老师的树里根本没有「班级管理」
     *      这个功能点，补了也还是被收回。
     * 所以两处必须一起加：静态表（第 ③ 层） + 本表（权限树初始授权）。
     *
     * 只给「查看」：交接动作仍由学管/校长操作，就业老师是接手方。
     */
    'teach||班级管理',
  ],
  /** 项目经理（9 页） */
  RM_PROJECT: [
    'workbench||工作台',
    'teach||休学/退学审批',
    'teach||催费',
    'teach||出勤管理',
    'teach||学生档案',
    'teach||宿舍管理',
    'teach||成绩管理',
    'teach||班级管理',
    'teach||退费',
  ],
  /** 校长（32 页） */
  RM_PRINCIPAL: [
    'workbench||工作台',
    'consult||学生管理',
    'consult||审批中心',
    'consult||收款与缴费',
    'consult||流失记录',
    'consult||退费管理',
    'finance||冻结名单',
    'finance||缴费管理',
    'finance||财务概览',
    'finance||账单明细',
    'finance||费用标准',
    'finance||退费管理',
    'perm||操作日志',
    'perm||权限总览',
    'perm||职位权限分配',
    'perm||职位管理',
    'perm||账号管理',
    'perm||部门管理',
    'perm||页面管理',
    'teach||休学/退学审批',
    'teach||催费',
    'teach||出勤管理',
    'teach||复盘填写',
    'teach||学生档案',
    'teach||宿舍管理',
    'teach||就业日志',
    'teach||待接收学员',
    'teach||成绩管理',
    'teach||数据统计',
    'teach||班级管理',
    'teach||考试管理',
    'teach||退费',
  ],
  /** 系统管理员（32 页） */
  SYS_ADMIN: [
    'workbench||工作台',
    'consult||学生管理',
    'consult||审批中心',
    'consult||收款与缴费',
    'consult||流失记录',
    'consult||退费管理',
    'finance||冻结名单',
    'finance||缴费管理',
    'finance||财务概览',
    'finance||账单明细',
    'finance||费用标准',
    'finance||退费管理',
    'perm||操作日志',
    'perm||权限总览',
    'perm||职位权限分配',
    'perm||职位管理',
    'perm||账号管理',
    'perm||部门管理',
    'perm||页面管理',
    'teach||休学/退学审批',
    'teach||催费',
    'teach||出勤管理',
    'teach||复盘填写',
    'teach||学生档案',
    'teach||宿舍管理',
    'teach||就业日志',
    'teach||待接收学员',
    'teach||成绩管理',
    'teach||数据统计',
    'teach||班级管理',
    'teach||考试管理',
    'teach||退费',
  ],
};
