/**
 * 可选项字典路由
 *
 * 提供方：权限管理（林晓）
 * 前缀：  /api/perm/option
 *
 *  GET /get   前端所有下拉框的取值集中在这里
 *
 * ⚠️ 为什么要有这个接口？
 *    如果每个页面各写一份「职位类型 → 中文」，改一次字典要改 7 个地方，
 *    迟早出现「A 页面叫管理职位、B 页面叫管理层」的脏数据。
 *    统一在这里给出，前端只负责渲染。
 */

import { Router } from 'express';
import {
  DataScope,
  DATA_SCOPE_NAME,
  DeptLevel,
  DEPT_LEVEL_NAME,
  PermBaseAction,
  PERM_BASE_ACTION_NAME,
  RoleStatus,
  UserStatus,
  ExportScope,
} from 'shared-types/perm';
import { ok } from '../utils/response';
import { wrap } from '../utils/wrap';
/* ★ 2026-10-19：密码策略统一从 pwdPolicy 取（与校验逻辑同一份，避免文案与判定漂移） */
import { loadPwdRule } from '../services/pwdPolicy';

export const optionRouter = Router();

/* ============================================================
 * 拼接「当前生效的密码策略」提示文案
 * 例：不少于 8 位，含大写字母、数字、特殊符号，90 天有效
 * ============================================================ */

async function buildPwdTip(): Promise<string> {
  const pwd = await loadPwdRule();
  const parts: string[] = [];
  parts.push(`不少于 ${pwd.min} 位`);
  const need: string[] = [];
  if (pwd.upper) need.push('大写字母');
  if (pwd.digit) need.push('数字');
  if (pwd.symbol) need.push('特殊符号');
  if (need.length) parts.push(`含${need.join('、')}`);
  parts.push(pwd.expireDays > 0 ? `${pwd.expireDays} 天需更换` : '长期有效');
  if (pwd.forceFirst) parts.push('首次登录须修改');
  return parts.join('，');
}

optionRouter.get(
  '/get',
  wrap(async (_req, res) => {
    res.json(
      ok({
        roleTypes: ['业务职位', '管理职位', '职能职位', '系统职位'].map((v) => ({ value: v, label: v })),

        roleStatuses: [RoleStatus.ENABLED, RoleStatus.DISABLED].map((v) => ({ value: v, label: v })),

        /* ★ 2026-10-25 用户口径：账号状态只有「正常 / 停用」两档，「锁定」已全系统移除
         *   （编辑弹窗下拉、列表标签、导出文案、/unlock 接口、UserStatus.LOCKED 枚举值
         *   同步删除）。
         *   ⚠️ label 仍统一为「停用」（不写「已停用」）；value 保持 UserStatus 枚举原值
         *   （'已停用'）——它是存库与前后端比较用的真实值，改值会导致存量数据对不上。 */
        userStatuses: [UserStatus.NORMAL, UserStatus.DISABLED].map((v) => ({
          value: v,
          label: v === UserStatus.DISABLED ? '停用' : v,
        })),

        deptLevels: [DeptLevel.SCHOOL, DeptLevel.DEPT, DeptLevel.STAGE].map((v) => ({
          value: v,
          label: DEPT_LEVEL_NAME[v],
        })),

        dataScopes: [DataScope.SELF, DataScope.CLASS, DataScope.DEPT, DataScope.ALL].map((v) => ({
          value: v,
          label: DATA_SCOPE_NAME[v],
        })),

        baseActions: [
          PermBaseAction.VIEW,
          PermBaseAction.ADD,
          PermBaseAction.EDIT,
          PermBaseAction.DELETE,
          PermBaseAction.APPROVE,
          PermBaseAction.EXPORT,
        ].map((v) => ({ value: v, label: PERM_BASE_ACTION_NAME[v] })),

        exportScopes: [
          ExportScope.CURRENT_PAGE,
          ExportScope.FILTERED,
          ExportScope.ALL,
        ].map((v) => ({ value: v, label: v })),

        /**
         * 操作日志 — 操作类型（与 t_perm_log.action_type 取值一致）
         *
         * ★ 2026-10-22 全系统留痕后补了 登出 / 导入 / 查询 三类：
         *   以前只有权限板块在写日志，动作只有增删改审批那几种；
         *   现在市场咨询、财务、班级、教务的接口也进来了，
         *   「导出名单」「导入学生」「查看完整手机号」都得有地方归类。
         */
        logActionTypes: [
          '登录',
          '登出',
          '新增',
          '修改',
          '删除',
          '审批',
          '导出',
          '导入',
          '查询',
          '权限变更',
        ].map((v) => ({ value: v, label: v })),

        /**
         * 操作日志 — 所属模块（与 t_perm_log.module_name 取值一致）
         *
         * ⚠️ 必须与 middleware/auditLog.ts 的 MODULE_BY_PREFIX 保持一致，
         *    否则下拉里选不到、日志却按另一个名字存着，筛选永远查不到。
         */
        logModules: [
          '系统门户',
          '市场咨询',
          '审批中心',
          '财务管理',
          '权限管理',
          '班级管理',
          '教学管理',
          '教学管理·初高',
          '就业管理',
          '教务管理',
        ].map((v) => ({ value: v, label: v })),

        logResults: ['成功', '失败'].map((v) => ({ value: v, label: v })),

        pwdTipText: await buildPwdTip(),
      }),
    );
  }),
);

export default optionRouter;
