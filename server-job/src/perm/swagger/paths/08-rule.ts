/**
 * Swagger 注解 —— 规则配置（3 个接口）
 */

/**
 * @openapi
 * /api/perm/rule/get:
 *   get:
 *     tags:
 *       - 规则配置
 *     summary: 读取全部规则
 *     description: 返回 `{ pwd, login, approval }`（已按类型还原 number / boolean）。
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
 *                     pwd:
 *                       type: object
 *                       properties:
 *                         min:
 *                           type: integer
 *                           enum: [6, 8, 10, 12]
 *                           example: 8
 *                           description: 密码最小长度
 *                         complexity:
 *                           type: boolean
 *                           example: true
 *                           description: 是否要求大小写 + 数字 + 符号
 *                         retry:
 *                           type: integer
 *                           enum: [3, 5, 8, 10]
 *                           example: 5
 *                           description: 连续错误几次后锁定
 *                         expireDays:
 *                           type: integer
 *                           example: 90
 *                           description: 密码有效期（天），0 = 永久
 *                         lockMin:
 *                           type: integer
 *                           example: 30
 *                           description: 锁定分钟数，0 = 永久锁定
 *                     login:
 *                       type: object
 *                       properties:
 *                         time:
 *                           type: string
 *                           pattern: '^\d{2}:\d{2}-\d{2}:\d{2}$'
 *                           example: 07:00-23:00
 *                           description: 允许登录时段
 *                         sameAcct:
 *                           type: integer
 *                           minimum: 1
 *                           maximum: 9
 *                           example: 1
 *                           description: 同账号允许同时在线的设备数
 *                         ipLimit:
 *                           type: boolean
 *                           example: false
 *                     approval:
 *                       type: object
 *                       description: 审批流节点名，用 → 分隔
 *                       example:
 *                         roleChange: 部门负责人→系统管理员
 *                         userAdd: 部门负责人→系统管理员
 */

/**
 * @openapi
 * /api/perm/rule/save:
 *   put:
 *     tags:
 *       - 规则配置
 *     summary: 保存某组规则
 *     description: |
 *       权限标识 `perm:规则配置:edit`。取值不合规返回 **40024**。
 *
 *       **值域**：`pwd.min` 6/8/10/12；`pwd.retry` 3/5/8/10；`pwd.expireDays` ≥ 0（0 = 永久）；
 *       `pwd.lockMin` ≥ 0（0 = 永久锁定）；`login.time` 形如 `07:00-23:00`；`login.sameAcct` 1–9；
 *       `approval.*` 非空字符串。
 *
 *       > ⚠️ 布尔入参用显式解析（只认 `true/1/on/yes`），**没有用 `z.coerce.boolean()`** ——
 *       > 后者按 JS 真值判断，字符串 `"false"` 会被转成 `true`，用户关了开关后端却存成开。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - group
 *               - value
 *             properties:
 *               group:
 *                 type: string
 *                 enum: [pwd, login, approval]
 *                 example: pwd
 *               value:
 *                 type: object
 *                 example:
 *                   min: 10
 *                   complexity: true
 *                   retry: 5
 *                   expireDays: 90
 *                   lockMin: 30
 *     responses:
 *       200:
 *         description: 成功，返回保存后的全部规则
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OkNull'
 */

/**
 * @openapi
 * /api/perm/rule/reset:
 *   put:
 *     tags:
 *       - 规则配置
 *     summary: 恢复默认规则
 *     description: '权限标识 `perm:规则配置:edit`。传 `group` 只恢复该组；不传则三组全恢复默认。'
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               group:
 *                 type: string
 *                 enum: [pwd, login, approval]
 *                 description: 不传 = 全恢复
 *                 example: pwd
 *     responses:
 *       200:
 *         description: 成功，返回恢复后的全部规则
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OkNull'
 */

export {};
