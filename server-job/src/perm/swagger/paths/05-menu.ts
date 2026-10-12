/**
 * Swagger 注解 —— 权限树（2 个接口）
 */

/**
 * @openapi
 * /api/perm/menu/tree:
 *   get:
 *     tags:
 *       - 权限树
 *     summary: 完整权限树
 *     description: |
 *       8 模块 / 53 个顶级功能点 / 185 动作。
 *
 *       带 **60 秒内存缓存**；传 `refresh=1` 强制刷新（改了 `t_perm_menu` 表后用它）。
 *     parameters:
 *       - name: refresh
 *         in: query
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *         description: 传 1 强制绕过缓存重新查库
 *         example: 1
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PermModule'
 */

/**
 * @openapi
 * /api/perm/menu/stats:
 *   get:
 *     tags:
 *       - 权限树
 *     summary: 权限树统计
 *     description: 顶栏右上角展示，让人一眼知道当前系统有多少权限点。
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
 *                     modCount:
 *                       type: integer
 *                       example: 8
 *                     itemCount:
 *                       type: integer
 *                       example: 53
 *                     actionCount:
 *                       type: integer
 *                       example: 185
 */

export {};
