import { BaseEntity } from './common';
import { ApplyType, NotifyType } from './enums';

/**
 * 站内通知（本模块自建，用户确认：站内消息 + 未读角标）
 *
 * 触发时机：
 *  - 休学审批通过 / 驳回 → 通知班主任
 *  - 退学审批通过 / 驳回 → 通知班主任 + 学管
 *  - 退费审批各节点 → 通知上一节点申请人 / 下一节点审批人
 *  - 有单子进入待办 → 通知对应审批人（NotifyType.TODO）
 */
export interface Notify extends BaseEntity {
  /** 通知类型 */
  notifyType: NotifyType;
  notifyTypeName?: string;
  /** 关联业务类型 */
  applyType?: ApplyType;
  applyTypeName?: string;
  /** 关联业务主键 / 单号（点击跳转用） */
  bizId?: string;
  applyNo?: string;
  /** 标题 */
  title: string;
  /** 正文（中文，可直接展示） */
  content: string;
  /** 接收人 ID */
  receiverId: string;
  receiverName?: string;
  /** 是否已读 */
  isRead: boolean;
  readTime?: string;
  /** 前端跳转路径，如 /approval/detail?id=xxx */
  linkPath?: string;
}

export interface NotifyQuery {
  page: number;
  size: number;
  notifyType?: NotifyType;
  /** 只看未读 */
  onlyUnread?: boolean;
  startDate?: string;
  endDate?: string;
}

/** 未读数（顶栏红点用） */
export interface NotifyUnreadCount {
  total: number;
  byType?: Array<{ notifyType: NotifyType; notifyTypeName: string; count: number }>;
}
