import { Router } from 'express';
import {
  ApplyStatusName,
  ApplyTypeName,
  ClassStatusName,
  ConsultStatusName,
  DeptName,
  DormTypeName,
  ExamContentTypeName,
  ExamResultName,
  ExamTypeName,
  FeeTypeName,
  GenderName,
  NotifyTypeName,
  OuterSyncStatusName,
  PayStatusName,
  RefundStatusHandlerRole,
  RefundStatusName,
  STAGES_BY_DEPT,
  StageName,
  StudentStatusName,
  SuspendStatusHandlerRole,
  SuspendStatusName,
  UpgradeStatusName,
} from '../../lib/dict';
import { ok } from '../../http/response';

export const dictRouter = Router();

/**
 * @openapi
 * /api/class/meta/dict:
 *   get:
 *     tags: [元数据]
 *     summary: 获取全部枚举字典（数字值与中文名）
 *     description: |
 *       前端用它渲染下拉框与状态标签，**不需要各自维护一份 1→"学费" 的映射表**。
 *       对应《01-公共数据字典》第四节。
 *     security: []
 *     responses:
 *       200:
 *         description: 成功
 */
dictRouter.get('/dict', (_req, res) => {
  return ok(
    res,
    {
      gender: GenderName,
      deptCode: DeptName,
      studentStatus: StudentStatusName,
      classStatus: ClassStatusName,
      feeType: FeeTypeName,
      payStatus: PayStatusName,
      refundStatus: RefundStatusName,
      refundStatusHandlerRole: RefundStatusHandlerRole,
      suspendStatus: SuspendStatusName,
      suspendStatusHandlerRole: SuspendStatusHandlerRole,
      applyType: ApplyTypeName,
      upgradeStatus: UpgradeStatusName,
      consultStatus: ConsultStatusName,
      outerSyncStatus: OuterSyncStatusName,
      examType: ExamTypeName,
      examResult: ExamResultName,
      examContentType: ExamContentTypeName,
      applyStatus: ApplyStatusName,
      dormType: DormTypeName,
      notifyType: NotifyTypeName,
      stage: StageName,
      stageByDept: STAGES_BY_DEPT,
    },
    '查询成功',
  );
});
