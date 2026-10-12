import { Router } from 'express';
import { studentRouter } from './student/student.route';
import { classRouter } from './class/class.route';
import { attendanceRouter } from './attendance/attendance.route';
import { examRouter } from './exam/exam.route';
import { gradeRouter } from './grade/grade.route';
import { urgeRouter } from './urge/urge.route';
import { feeRouter } from './fee/fee.route';
import { dormRouter } from './dorm/dorm.route';
import { suspendRouter } from './approval/suspend.route';
import { refundRouter } from './approval/refund.route';
import { upgradeRouter } from './approval/upgrade.route';
import { approvalRouter } from './approval/approval.route';
import { notifyRouter } from './notify/notify.route';
import { consultRouter } from './consult/consult.route';

/**
 * 路由注册中心
 *
 * 每个业务模块导出一个 { path, router }，在这里统一挂载。
 * app.ts 会给每条 path 统一加上认证中间件（/sync 结尾的接口走服务间凭证）。
 *
 * 路径与原型 9 个菜单、以及 permGuard 里的资源名一一对应：
 *   学员与班级  → student（班级信息管理）、info（班级管理）
 *   教务运行    → attendance、grade、exam
 *   费用与后勤  → urge（催费）、refund（退费）、suspend + approval（休学/退学审批）、dorm（宿舍）
 *   跨模块对接  → student/sync、urge/sync、fee/sync、dorm/sync、student/upgrade/sync
 */
export interface MountedRouter {
  path: string;
  router: Router;
}

export function buildRouters(): MountedRouter[] {
  return [
    // ---------- 学员与班级 ----------
    { path: '/api/class/student', router: studentRouter },
    { path: '/api/class/info', router: classRouter },
    { path: '/api/class/consult', router: consultRouter },

    // ---------- 教务运行 ----------
    { path: '/api/class/attendance', router: attendanceRouter },
    { path: '/api/class/exam', router: examRouter },
    { path: '/api/class/grade', router: gradeRouter },

    // ---------- 费用与后勤 ----------
    { path: '/api/class/urge', router: urgeRouter },
    { path: '/api/class/fee', router: feeRouter },
    { path: '/api/class/dorm', router: dormRouter },

    // ---------- 审批流程 ----------
    { path: '/api/class/suspend', router: suspendRouter },
    { path: '/api/class/refund', router: refundRouter },
    { path: '/api/class/upgrade', router: upgradeRouter },
    { path: '/api/class/approval', router: approvalRouter },

    // ---------- 站内通知 ----------
    { path: '/api/class/notify', router: notifyRouter },
  ];
}
