/**
 * 就业模块 · 通知适配器
 *
 * 【为什么有这个文件】
 *   就业部分原来自己有一套通知（表 `t_notification` + `notification.route.ts`），
 *   实训部分有一套（表 `t_job_notice` + `utils/notice.ts`）。
 *   2026-10-02 斌哥拍板：**通知合一** —— 全模块只用一套，避免用户看两个"消息中心"。
 *
 *   所以保留原来的函数名 `pushNotification`（她的复盘代码在调），
 *   但内部改成走本模块统一的通知服务 `sendNotice`。
 *
 * ⚠️ 原来她的 `receiver` 存的是"角色名文字"（如 "就业老师"），
 *    这里映射成本模块的 receiverId/receiverRole 口径。
 */

import { sendNotice, NOTICE_TYPE } from './notice';
import { RoleCode } from 'shared-types';

/** 她原来的通知类型（NotificationType） → 本模块的通知类型 */
const TYPE_MAP: Record<number, number> = {
  1: NOTICE_TYPE.SYSTEM,      // 系统通知
  2: NOTICE_TYPE.OTHER,       // 面试提醒
  3: NOTICE_TYPE.OTHER,       // 复盘提醒
  4: NOTICE_TYPE.OTHER,       // 就业通知
};

export interface PushNotificationParams {
  title: string;
  content: string;
  type: number;
  /** 接收人（原设计是角色名文字，如 "就业老师"） */
  receiver?: string;
  createBy?: string;
}

/**
 * 发一条就业模块的通知（对外保持原函数名与签名）
 */
export async function pushNotification(data: PushNotificationParams): Promise<void> {
  const receiverName = data.receiver || '就业老师';

  await sendNotice({
    noticeType: TYPE_MAP[data.type] ?? NOTICE_TYPE.OTHER,
    title: data.title,
    content: data.content,
    // 原设计只记了"角色名"，这里按就业老师落库（本模块通知按角色分发）
    receiverId: RoleCode.JOB_STAFF,
    receiverName,
    receiverRole: RoleCode.JOB_STAFF,
    senderId: data.createBy || null,
    senderName: null,
  });
}
