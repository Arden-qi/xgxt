/**
 * Swagger 注解 —— 健康检查
 *
 * ⚠️ 本文件只放 @openapi 注解，不含任何业务代码。
 *    改接口时同步改这里，swagger-jsdoc 启动时扫描生成文档。
 */

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - 健康检查
 *     summary: 健康检查（不鉴权）
 *     description: 返回服务标识、端口与服务器时间，用于快速确认服务活着。本接口不挂鉴权中间件。
 *     security: []
 *     responses:
 *       200:
 *         description: 服务正常
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
 *                   example: ok
 *                 data:
 *                   type: object
 *                   properties:
 *                     service:
 *                       type: string
 *                       example: server-perm
 *                     port:
 *                       type: integer
 *                       example: 8006
 *                     time:
 *                       type: string
 *                       example: '2026-09-30T10:00:00.000Z'
 */

export {};
