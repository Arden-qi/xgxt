/**
 * Swagger 注解 —— 操作日志（4 个接口）
 */

/**
 * @openapi
 * /api/perm/log/list:
 *   get:
 *     tags:
 *       - 操作日志
 *     summary: 日志分页列表
 *     description: '⚠️ 日志模块**只读**：刻意不提供 add / update / delete 接口。'
 *     parameters:
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/Size'
 *       - name: keyword
 *         in: query
 *         schema:
 *           type: string
 *         description: 操作对象 / 操作人模糊搜索
 *       - name: moduleName
 *         in: query
 *         schema:
 *           type: string
 *         example: 权限管理
 *       - name: actionType
 *         in: query
 *         schema:
 *           type: string
 *         example: 登录
 *       - name: result
 *         in: query
 *         schema:
 *           type: string
 *           enum: [成功, 失败]
 *       - name: operatorName
 *         in: query
 *         schema:
 *           type: string
 *       - name: startDate
 *         in: query
 *         schema:
 *           type: string
 *         description: 起始日期 YYYY-MM-DD
 *         example: '2026-09-01'
 *       - name: endDate
 *         in: query
 *         schema:
 *           type: string
 *         description: 结束日期 YYYY-MM-DD
 *         example: '2026-09-30'
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
 *                   example: 查询成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       example: 18
 *                     page:
 *                       type: integer
 *                       example: 1
 *                     size:
 *                       type: integer
 *                       example: 20
 *                     list:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Log'
 */

/**
 * @openapi
 * /api/perm/log/detail:
 *   get:
 *     tags:
 *       - 操作日志
 *     summary: 日志详情（含操作前 / 操作后值）
 *     description: '日志不存在时 `code = 40413`。'
 *     parameters:
 *       - $ref: '#/components/parameters/IdQuery'
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
 *                   $ref: '#/components/schemas/Log'
 */

/**
 * @openapi
 * /api/perm/log/overview:
 *   get:
 *     tags:
 *       - 操作日志
 *     summary: 日志 KPI
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
 *                     logTotal:
 *                       type: integer
 *                       example: 18
 *                     successTotal:
 *                       type: integer
 *                       example: 17
 *                     failTotal:
 *                       type: integer
 *                       example: 1
 *                     loginTotal:
 *                       type: integer
 *                       example: 5
 *                     approveTotal:
 *                       type: integer
 *                       example: 4
 */

/**
 * @openapi
 * /api/perm/log/export:
 *   get:
 *     tags:
 *       - 操作日志
 *     summary: 日志全量导出数据（不分页，上限 1 万条）
 *     parameters:
 *       - name: keyword
 *         in: query
 *         schema:
 *           type: string
 *       - name: moduleName
 *         in: query
 *         schema:
 *           type: string
 *       - name: actionType
 *         in: query
 *         schema:
 *           type: string
 *       - name: result
 *         in: query
 *         schema:
 *           type: string
 *       - name: startDate
 *         in: query
 *         schema:
 *           type: string
 *       - name: endDate
 *         in: query
 *         schema:
 *           type: string
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
 *                     total:
 *                       type: integer
 *                       example: 18
 *                     list:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Log'
 */

export {};
