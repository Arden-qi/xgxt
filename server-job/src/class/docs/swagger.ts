import swaggerJsdoc from 'swagger-jsdoc';
import { config } from '../config';

/**
 * Swagger 接口文档
 * 访问：http://127.0.0.1:8003/api/class/docs
 *
 * 说明：各路由文件里用 JSDoc 注释写 @openapi，这里自动汇总生成。
 */
export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: '学管系统 · 班级管理模块 API',
      version: '1.0.0',
      description: [
        '端口 8003，前缀 /api/class/**',
        '',
        '统一响应格式：`{ code, message, data }`，data 永远存在（无数据为 null）。',
        '分页：入参 `page` / `size`，出参 `{ total, page, size, list }`。',
        '认证：`Authorization: Bearer {token}`。',
        '错误码：400xx 参数错误 / 401xx 未登录 / 403xx 无权限 / 404xx 不存在 / 500xx 系统错误。',
      ].join('\n'),
    },
    servers: [{ url: `http://127.0.0.1:${config.port}`, description: '本地开发' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: '元数据', description: '枚举字典等公共数据' },
      { name: '学生信息', description: '需求一：同步 / 补充 / 新建 / 升学' },
      { name: '催费管理', description: '需求二：同步教务管理的催费信息' },
      { name: '缴费信息', description: '需求三：同步财务管理的缴费信息' },
      { name: '宿舍信息', description: '需求四：同步教务管理的宿舍信息' },
      { name: '审批流程', description: '休学 / 退学 / 退费' },
      { name: '站内通知', description: '审批结果通知与未读角标' },
      { name: '班级管理', description: '班级档案 / 交接 / 末班' },
      { name: '教务运行', description: '出勤 / 成绩 / 考试' },
    ],
  },
  apis: ['src/modules/**/*.ts'],
});
