/**
 * Swagger 注解 —— 页面管理（4 个接口）
 *
 * GET  /api/perm/page/list            板块 + 页面清单 + 启用态
 * GET  /api/perm/page/enabled-paths   仅已启用的页面 path（前端菜单过滤用）
 * PUT  /api/perm/page/save            按板块保存（全量覆盖）
 * POST /api/perm/page/reset           全部恢复启用
 */

/**
 * @openapi
 * /api/perm/page/list:
 *   get:
 *     tags:
 *       - 页面管理
 *     summary: 板块 → 页面 台账清单
 *     description: |
 *       返回全部板块及各自的页面清单，每页带 `enabled`（打勾 = 该板块有此页面）。
 *
 *       ⚠️ 只读接口，不挂 `checkPermission`（与本模块 role-list / assign tree 口径一致）。
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: 操作成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       example: 56
 *                     enabledTotal:
 *                       type: integer
 *                       example: 56
 *                     boards:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           moduleKey:
 *                             type: string
 *                             example: perm
 *                           moduleName:
 *                             type: string
 *                             example: 权限管理
 *                           moduleIcon:
 *                             type: string
 *                             example: 🔐
 *                           legacy:
 *                             type: boolean
 *                             example: false
 *                           total:
 *                             type: integer
 *                             example: 7
 *                           enabledCount:
 *                             type: integer
 *                             example: 7
 *                           pages:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 pageKey:
 *                                   type: string
 *                                   example: page
 *                                 pageTitle:
 *                                   type: string
 *                                   example: 页面管理
 *                                 pagePath:
 *                                   type: string
 *                                   example: /perm/page
 *                                 enabled:
 *                                   type: boolean
 *                                   example: true
 *                                 locked:
 *                                   type: boolean
 *                                   description: 为 true 时不允许取消勾选（防止把自己锁在门外）
 *                                   example: true
 */

/**
 * @openapi
 * /api/perm/page/enabled-paths:
 *   get:
 *     tags:
 *       - 页面管理
 *     summary: 仅返回已启用的页面 path
 *     description: 前端启动时拉一次，用于左侧菜单过滤 + 路由守卫拦截（轻量接口）。
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: 操作成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     paths:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ['/perm/overview', '/perm/page', '/class']
 */

/**
 * @openapi
 * /api/perm/page/save:
 *   put:
 *     tags:
 *       - 页面管理
 *     summary: 保存某板块的页面启停（全量覆盖）
 *     description: |
 *       提交该板块**当前打勾**的页面 path 数组；后端先把该板块全部置为未启用，
 *       再把这一批置为启用 —— 不会留下「取消勾选后菜单还在」的幽灵页面。
 *
 *       ⚠️ 权限标识 `perm:权限配置:editPerm`。`locked` 页面（页面管理自身）会被强制保留。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [moduleKey, enabledPaths]
 *             properties:
 *               moduleKey:
 *                 type: string
 *                 example: job
 *               enabledPaths:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ['/class', '/attendance', '/exam-score']
 *     responses:
 *       200:
 *         description: 成功
 *       403:
 *         description: 无 `perm:权限配置:editPerm` 权限 → **403**
 */

/**
 * @openapi
 * /api/perm/page/reset:
 *   post:
 *     tags:
 *       - 页面管理
 *     summary: 全部恢复启用
 *     description: 把所有板块的页面一次性恢复为启用（一键还原）。权限标识 `perm:权限配置:editPerm`。
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 200
 *                 data:
 *                   type: object
 *                   properties:
 *                     affected:
 *                       type: integer
 *                       example: 56
 */
