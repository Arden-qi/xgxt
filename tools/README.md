# tools/ —— 验证脚本（统一门户版）

这两个脚本是合并交付时写的**验证工具**，不参与业务运行，删掉也不影响系统。
保留它们是为了以后改动代码后能**一键回归**。

> ⚠️ 两个脚本都**在任意目录执行都行**（内部按脚本自身位置定位 `server-job/` 与输出目录），
> 不会往项目根目录丢文件。

---

## 1. `smoke-backend.mjs` —— 后端冒烟（登录 + 鉴权链路 + 权限解析）

**前提**：后端已在 8004 监听（`一键启动.bat`，或 `cd server-job && npm run dev`）。

```bat
node tools\smoke-backend.mjs
```

覆盖 12 项，全部应有预期结果：

| # | 场景 | 期望 |
|---|---|---|
| 1 | 未带 token 访问门户 profile | 401（`DEV_MODE` 已关，不再是假管理员） |
| 2 | 真实登录 admin | 200，可见 consult/finance/perm |
| 3 | 真实登录 zhangls | 200，可见 consult |
| 4 | 真实登录 linx | 200，可见 perm |
| 5 | 错误密码 | 失败（code 50001） |
| 6 | 伪造 secret 的 token | 401 |
| 7~9 | admin/zhangls token → 门户 profile / 咨询业务接口 | 200 |
| 10 | admin → 就业页面权限 `/api/job/auth/my-pages` | 200，29 个页面 |
| 11 | linx → 权限模块总览 `/api/perm/overview/get` | 200 |
| 12 | 无 token 访问就业接口 | 401 |

> 它要从 `server-job/.env` 读 `JWT_SECRET`、并用 `server-job` 里的 `jsonwebtoken` 伪造 token，
> 所以放在 `tools/` 也能跑通（脚本内部已显式指向 `server-job/`）。

---

## 2. `e2e-merged.mjs` —— 前端 E2E（真实浏览器，零依赖）

**前提**：前后端都起来了（5173 + 8004）。
用本机已安装的 **Edge / Chrome**，走 CDP 协议真开页面，不需要装 Playwright/Puppeteer。

```bat
node tools\e2e-merged.mjs
```

覆盖：

- **场景 A · admin**：登录页渲染 → 落地页 → 看到 6 个模块分组 → 顶栏 29 个页面权限 → 21 条路由逐条扫页（每条都要有内容、且不落「无权限页」）。
- **场景 B · zhangls**：只看到「市场咨询」1 个分组 → 顶栏 0 个页面权限 → 越权访问 `/finance/overview` 被拦回 `/consult/student`。
- **控制台**：错误 0、未捕获异常 0。

产物落在 `tools/_out/`：`e2e-report.txt`（逐项 PASS/FAIL 与汇总）+ `*.png`（关键页面截图）。

> 浏览器路径是写死的几个常见安装位置，找不到会自动退出并提示。
> 若你机器上浏览器装在别处，改脚本顶部的 `CAND` 数组即可。

---

## 3. `_verify-student-dept.mjs` / `_verify-teaching-dept.mjs` —— 「学段 → 部门」改名回归

**前提**：前后端都在跑（5173 + 8004）。用校长账号 `qiansy` 真实登录（登录页有演示账号列表）。

```bat
node tools\_verify-student-dept.mjs      rem 学生档案（截图批注那一页）
node tools\_verify-teaching-dept.mjs     rem 教学管理 9 个合并入口逐页扫
```

| 脚本 | 断言 |
|---|---|
| `_verify-student-dept` | 页面无「学段」字样；筛选标签是「部门」；列表显示「大学部」；部门下拉 = 初高部 / 大学部；选大学部查 1 条、选初高部查 0 条 |
| `_verify-teaching-dept` | 9 个入口页（学生档案/班级/出勤/考试/成绩/宿舍/催费/退费/休学审批）都有内容、无「学段」、无未捕获异常 |

> 与 `e2e-merged.mjs` 同一套路（CDP 直连本机 Edge/Chrome，零依赖）。
> 改完教学管理页面的文案/筛选后，先跑这两个脚本再提交。

---

## 4. `_verify-form-fields.mjs` —— 两个弹窗的表单字段回归

```bat
node tools\_verify-form-fields.mjs
```

| 弹窗 | 断言 |
|---|---|
| 学生档案 · 新增学生 | 没有「上网账号 / 初始密码」；状态下拉没有「预在读」但有「正式在读 / 休学」；不填姓名点保存 → 提示「姓名必填」且弹窗不关（必填被拦住） |
| 班级管理 · 新增班级（部门选大学部） | 没有「项目经理 / 项目经理姓名 / 就业老师 / 就业老师姓名 / 大学学号」；仍有「班主任姓名 / 教员姓名 / 助教姓名 / 教室 / 开班日期」 |

> ⚠️ **踩坑（写这类脚本必看）**：Element Plus 的下拉**打不开**如果只用
> `dispatchEvent(new MouseEvent('click'))` —— 必须用 CDP 的
> `Input.dispatchMouseEvent` 派发原生 mousePressed/mouseReleased。
> 另外下拉挂在 body 上的 fixed popper 里，`offsetParent` 恒为 `null`，
> 判断可见性要用 `getComputedStyle(popper).display` + `getBoundingClientRect()`。

