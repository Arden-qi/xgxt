/**
 * 旧版权限树功能点名 → 新版权限树页面名 的兼容映射
 * ============================================================
 *
 * 【为什么需要这个文件】
 *   2026-10-22 权限树重建（`permTree.ts`）把「板块 → 功能点」改成了
 *   「板块 → 页面 → 操作」，页面**换了名字、也换了板块**：
 *
 *     旧：teach/学生基础数据   → 新：teach/学生档案
 *     旧：teach/催费管理       → 新：teach/催费
 *     旧：teach/退费申请       → 新：teach/退费
 *     旧：teach/流程管理       → 新：teach/休学/退学审批
 *     旧：job/就业日志         → 新：teach/就业日志（板块从 job 并进 teach）
 *     旧：train/实训-出勤管理  → 新：teach/出勤管理（去掉了「实训-」前缀）
 *
 *   但**库里的授权记录 `t_perm_role_perm` 还是旧名字**（各角色当初是按旧树勾的，
 *   迁移脚本 `scripts/seed-perm-tree.ts` 没有在每台机器上都跑过）。
 *   二者对不上会连环出事：
 *     ① `pagePermissionSource.removeCodesOfRevokedPages()` 认为「该页一个动作都没勾」
 *        → 把角色的页面码**收回** → my-pages 少一大截 → 左侧菜单整片消失；
 *     ② `rolePageDefaults.deriveDefaultPaths()` 认不出旧名字 → 页面管理里勾选框全是空的；
 *     ③ `roleGrantedOps` 同理，按钮级基线也会漂。
 *
 * 【解决方式】
 *   在**读库的唯一入口**（`utils/roleModuleItems.ts`）把旧名字规范化成新名字，
 *   下游三处（默认值 / 运行时页面码 / 按钮基线）就自动对齐了，
 *   不需要改库、也不需要每个人手动去「职位权限分配」重勾一遍。
 *
 * 【维护约定】
 *   · 以后再改页面名 → 把**旧名**追加到这里，别删历史项（老库还在用旧名）；
 *   · 一个旧名可以对多个新名（如「班级管理」也意味着能看「待接收学员」）；
 *   · 新树里本来就没有的板块（market / fin / approve / acad / train / perm 旧板块）
 *     那些功能点只影响咨询 / 财务的菜单，而它们的页面**没有页面码**
 *     （靠门户 visibleModules 判权），映射与否都不影响可见性 —— 这里只挑
 *     真正会影响「教学管理」页面码的那几条建映射。
 * ============================================================
 */

/**
 * `旧 moduleKey||旧 item_name` → 新树里的若干 `moduleKey||页面名`
 *
 * 值为**新树 key**，必须是 `permTree.ts` 里真实存在的 板块 moduleKey + 页面 name，
 * 否则等于没映射（`PERM_POINT_TO_PAGE_CODES` 查不到就被忽略）。
 */
const LEGACY_ITEM_ALIASES: Record<string, string[]> = {
  /* ---------------- 教学管理（teach）：只是改名 ---------------- */
  'teach||学生基础数据': ['teach||学生档案'],
  'teach||催费管理': ['teach||催费'],
  'teach||退费申请': ['teach||退费'],
  'teach||流程管理': ['teach||休学/退学审批'],

  /* ---------------- 教学管理（teach）：原本没有独立功能点的页面 ----------------
   * 「待接收学员」在旧权限树里没有对应功能点（旧版是按 班级管理 的人天然能看），
   * 所以这里把它挂到「班级管理」上：能管班的人就能看待接收学员，
   * 与合并前 `ROLE_PAGE_PERMISSIONS` 里给班主任 / 学管 / 校长 / 教务的口径一致。 */
  'teach||班级管理': ['teach||班级管理', 'teach||待接收学员'],

  /* ---------------- 就业（job）：板块并进 teach ---------------- */
  'job||就业日志': ['teach||就业日志'],
  'job||复盘填写': ['teach||复盘填写'],
  'job||数据统计': ['teach||数据统计'],
  'job||换班交接': ['teach||班级管理'],
  'job||就业信息档案': ['teach||学生档案'],

  /* ---------------- 实训（train）：去掉「实训-」前缀 ---------------- */
  'train||实训-班级信息': ['teach||班级管理'],
  'train||实训-班级交接': ['teach||班级管理'],
  'train||实训-出勤管理': ['teach||出勤管理'],
  'train||实训-考试管理': ['teach||考试管理'],
  'train||实训-成绩管理': ['teach||成绩管理'],
  'train||实训-成绩汇总': ['teach||成绩管理'],
  'train||实训-休学退学复学审批': ['teach||休学/退学审批'],
  'train||实训-宿舍管理': ['teach||宿舍管理'],
  'train||实训-催费管理': ['teach||催费'],
  'train||实训-退费申请': ['teach||退费'],

  /* ---------------- 教务（acad）：板块并入 teach ---------------- */
  'acad||学生档案': ['teach||学生档案'],
  'acad||缴费总名单': ['teach||催费'],
  'acad||临期名单': ['teach||催费'],
  'acad||餐费住宿费缴费名单': ['teach||催费'],
  'acad||宿舍总名单': ['teach||宿舍管理'],
  'acad||换宿/退宿审批': ['teach||宿舍管理'],
  'acad||退宿名单': ['teach||宿舍管理'],

  /* ---------------- 审批（approve）：审批页并入 teach ---------------- */
  'approve||退费审批': ['teach||退费'],
  'approve||休学/退学审批': ['teach||休学/退学审批'],
};

/**
 * 把一个「(板块, 功能点名)」规范化成新树里的若干 key
 *
 * 没有配映射的返回原 key（保持原行为，绝不误伤）。
 */
export function canonicalItemKeys(moduleKey: string, itemName: string): string[] {
  const key = `${moduleKey}||${itemName}`;
  return LEGACY_ITEM_ALIASES[key] ?? [key];
}

/** 是否是需要翻译的旧名（调试/迁移脚本用） */
export function isLegacyItemName(moduleKey: string, itemName: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_ITEM_ALIASES, `${moduleKey}||${itemName}`);
}
