/**
 * 跨模块 HTTP 客户端（axios 统一封装）—— 【已迁移到公共封装，本文件只做转发】
 * ════════════════════════════════════════════════════════════
 *
 * ★ 2026-10-14：《技术选型表》约定「跨服务调用 = axios」。
 *   此前项目里两套写法并存：
 *     · 本文件（axios 封装，308 行）—— 只有**权限模块**在用（2 个文件引用）
 *     · 另外 8 个文件 / 17 处调用 —— 各写各的原生 fetch 样板（自己拼 AbortController
 *       超时、自己判 code、自己解包）
 *
 *   现把本文件的能力**原样提升**为公共封装 `src/shared/http.ts`，
 *   并把 baseURL 来源从「perm 私有的 config.services」换成
 *   「全局 src/config.ts 的 config.services」——
 *   后者各地址的默认值已适配「合并成单进程」后的端口，比 perm 私有那份更正确。
 *
 * 【本文件为什么还留着】
 *   只为**不破坏权限模块已有的 import**：
 *     · src/perm/routes/remote.route.ts
 *     · src/perm/services/remote.service.ts
 *   新代码请直接从 `src/shared/http.ts` 引入，不要再从这里引。
 *
 * 【能力清单（都在公共封装里）】
 *   · 统一 baseURL 来源（config.services，从 .env 读，不硬编码）
 *   · `proxy: false` —— 内网直连，绝不走 HTTP 代理（踩过坑，见公共封装注释）
 *   · 请求拦截：注入链路 ID（X-Trace-Id）+ 透传 token
 *   · 响应拦截：解包 {code,message,data}，非 200 抛 RemoteError
 *   · 超时 / 指数退避重试 / 错误翻译成中文
 *   · `raw: true` 模式：不解包、不判业务码，交调用方自己处理
 * ════════════════════════════════════════════════════════════
 */

export * from '../../shared/http';
