# cdp-control

用 Chrome DevTools Protocol（CDP）接管 **正在运行的 Edge**，读取/操作任意标签页。纯 Node 实现，无 puppeteer / playwright 依赖（用 Node 22 内置 `WebSocket`）。

> ## 📢 Announcement
>
> **cdp-control** is released under the **Apache License 2.0**.
>
> Copyright © 2026 Gigabind Technology.
>
> 本项目以 **Apache License 2.0** 协议开源发布，可自由使用、修改与分发（须保留版权声明与许可声明）。
>
> - 商业授权、定制开发、技术支持：**zdw@gigabind.com**
> - 使用时请遵守目标站点的服务条款与当地法律法规；详见文末 [§7 声明](#7-声明)。

---

## 1. 前置条件

### 1.1 打开调试端口（唯一正确方式）

在**正在运行的普通 Edge** 里：

1. 访问 `edge://inspect/#remote-debugging`
2. 左侧点「远程调试」，勾选「**允许对此浏览器实例进行远程调试**」
3. 显示 `Server running at: 127.0.0.1:9222` 即成功

说明：
- 开关按**实例**生效，重启后仍保留；可随时取消勾选（访问网银/支付前建议取消）。
- Chromium 136+ 起，用默认用户目录时 `--remote-debugging-port` 启动会被**拒绝**。这个 UI 开关是「既保留登录态又能被 CDP 接管」的唯一正路。
- ⚠️ 不要用 `mklink /J` 做目录映射来骗过检查——端口能开，但浏览器会被判定为非默认配置，PayPal 等严格风控站点会直接拒登。

### 1.2 首次连接会被确认

外部程序连上时，Edge 会弹「**是否允许远程调试？**」：

- 点「允许」才能操作；点「取消」连接断开。
- **每个新连接都会弹一次**。所以一次性脚本跑 N 次就可能弹 N 次 → 需要连续操作请用常驻服务 `daemon.mjs`（只连一次）。

### 1.3 环境

- Node.js ≥ 22（需要内置 `WebSocket`、`fetch`）
- 端口/配置文件位置：`%LOCALAPPDATA%\Microsoft\Edge\User Data\DevToolsActivePort`

---

## 2. 两种用法

### A. 一次性 CLI（简单直接，但每次新建连接）

```bash
node cdp-cli.mjs pages                          # 列出所有标签页
node cdp-cli.mjs eval -i 0 "document.title"     # 按索引求值
node cdp-cli.mjs eval -u paypal "location.href" # 按 URL/标题关键词求值
node cdp-cli.mjs shot -u siemens -o out.png     # 截图
node cdp-cli.mjs nav  -i 0 https://example.com  # 导航
node cdp-cli.mjs css  -i 0 "body{background:#111}"  # 注入 CSS
node cdp-cli.mjs html -i 0                      # 导出 outerHTML
node cdp-cli.mjs tab  https://example.com       # 新开标签页
node cdp-cli.mjs close -i 0                     # 关闭标签页
node cdp-cli.mjs endpoint                       # 打印 WS 端点
```

参数：`-i/-idx` 索引，`-u/-url` 关键词（大小写不敏感），`-f` 从文件读 JS，`-o` 输出文件名。

### B. 常驻服务（推荐，只连一次）

```bash
node daemon.mjs          # 启动后监听 http://127.0.0.1:9223
```

另一个终端用轻量客户端转发命令（**不新建 CDP 连接，不触发 Edge 确认**）：

```bash
node c.mjs ping
node c.mjs pages
node c.mjs eval -u sieportal "document.body.innerText.slice(0,200)"
node c.mjs shot -u sieportal -o out.png
node c.mjs nav -i 0 https://example.com
```

daemon 直接 HTTP 端点：

| 端点 | 说明 |
|---|---|
| `GET /ping` | 健康检查，返回端点与已附加 session |
| `GET /pages` | 标签页列表 |
| `POST /eval {sel,expr}` | 求值（返回 `{value}`） |
| `POST /shot {sel,out}` | 截图 |
| `POST /nav {sel,url}` | 导航 |
| `POST /net/clear` | 清空抓包缓冲 |
| `GET /net/log?since=ts` | 读取抓到的接口请求（含 body / resp） |
| `POST /type {sel,index,value,settleMs}` | **真实键盘输入**（`Input.insertText`）并读回 DOM 状态 |

---

## 3. 文件清单

### 核心（建议保留）

| 文件 | 作用 |
|---|---|
| `cdp.mjs` | 库：`connect` / `listPages` / `pickPage` / `attachPage` / `send` / `evaluate` / `readEndpoint` |
| `cdp-cli.mjs` | 一次性命令集（pages/eval/css/shot/nav/html/tab/close） |
| `daemon.mjs` | 常驻连接 + Network 抓包 + 真实键入服务 |
| `c.mjs` | daemon 的轻量客户端 |
| `t.mjs` | **单值闭环验证**：输入 → 请求 body → 响应 → DOM 四点对齐 |
| `bench.mjs` | **批量闭环验证** + 事件驱动等待 + 耗时统计 |

### 探测脚本（历史用途，按需保留）

| 文件 | 作用 |
|---|---|
| `watch.mjs` | 全量网络监听：实时打印每个请求，`Target.setAutoAttach` 自动附加 iframe/worker，命中目标 POST 时打印完整 headers/body |
| `capture-one.mjs` | 抓单个发往 paypal.com 的表单 POST（等不到会超时报错，已被 `watch.mjs` 取代） |
| `post-capture.mjs` | 固定时间窗内所有 POST 汇总，落盘 `net/post-capture.ndjson` |
| `net-probe.mjs` | 刷新页面并抓 country/geo/config 类接口，检查响应里是否含 `CN` / `+86` |
| `net-all.mjs` | 抓所有 XHR/Fetch/Document 响应体落盘到 `net/all/`，按关键词检索 |
| `bundle-probe.mjs` | 下载页面全部 JS bundle，扫描配置表与接口路径（`getavailablecountry`、`dialCode`、`+86` 等） |
| `state-probe.mjs` | 遍历 React fiber 提取组件状态（**仅对 React 页面有效**，PayPal 是自研框架，抓不到） |
| `patch-test.mjs` | 注入钩子在页面初始化前改写配置（如国家列表 201→204），观察效果 |
| `patch-test2.mjs` | 同上 + 改写 `phoneMetadata.phoneCode`，检查显示与表单序列化 |
| `cookie-probe.mjs` | 列出 paypal 域全部 cookie（含 HttpOnly），标记区域相关项 |
| `lang-test.mjs` | 改写 `LANG` cookie 测试区域判定是否随之变化 |
| `type-nick.mjs` | 西门子昵称单次测试（**方法有缺陷，见 §5，已被 `t.mjs` 取代**） |
| `type-nick-loop.mjs` | 西门子昵称批量测试（同上，固定等待导致误判） |

### 数据目录

| 路径 | 内容 |
|---|---|
| `net/` | 抓包落盘：`*.txt` 响应体、`js/` 下载的 JS bundle、`all/` 全量响应、`post-capture.ndjson`、`cn-clean.html` |

---

## 4. 实现要点（为什么这么写）

1. **必须走浏览器级 WebSocket**
   UI 开关模式下，HTTP 的 `/json/version`、`/json/list` 返回 **404**（新版防 cookie 窃取加固）。做法：
   - 从 `DevToolsActivePort` 读端口和路径 → `ws://127.0.0.1:<port><path>`
   - `Target.getTargets` 枚举 → `Target.attachToTarget {flatten:true}` 拿 sessionId
   - 后续 `Runtime.evaluate` / `Page.captureScreenshot` 都带 sessionId

2. **`evaluate` 兼容两种写法**
   先按表达式跑 `return (expr)`，语法错误再退回函数体模式。所以 `document.title` 和 `return document.title` 都能用。

3. **多标签页歧义**
   DevTools 窗口的标题里会带页面标题，按关键词匹配会撞车。`pickPage` 已优先排除 `devtools://`。

4. **子目标请求要单独开 Network**
   iframe / Service Worker 的请求挂在独立 session 上，必须 `Target.setAutoAttach` 才能收到。

---

## 5. 踩过的坑

| 坑 | 现象 | 结论 |
|---|---|---|
| 固定时间等待 | 2.2s 后读数，把可用昵称判成"已占用" | 西门子校验接口实测 **2.5–6.2 秒**返回，间隔过短会**响应乱序**，错误信息串到下一个候选。必须等响应落地（事件驱动轮询） |
| 只读 DOM 判定 | 与接口结论矛盾 | DOM 状态可能滞后/残留；要读**响应 JSON**（`isUnique` / `errorCode`）才能定论 |
| `input.value = x` + `dispatchEvent` | Angular 内部模型可能不更新 | 用 CDP `Input.insertText` 真实键入 |
| 一次性脚本连续跑 | 每次弹 Edge 确认框 | 改用 `daemon.mjs` 常驻连接 |
| `rm -rf` 带盘符路径 | 被安全策略拦截 | 改用 `node fs.rmSync` |
| `Page.captureScreenshot` 超时 | 报错 | 先 `Page.enable` + `Page.bringToFront` |
| `Page.navigate` ack 丢失 | 命令挂住 | fire-and-forget + 轮询 `document.readyState` |

---

## 6. 安全提醒

远程调试端口开启期间，**本机任何进程**连上 `127.0.0.1:9222` 就能控制该浏览器、读取所有站点 Cookie。

- 用完立刻到 `edge://inspect/#remote-debugging` 取消勾选
- 不要在这期间登录网银、支付类账户
- `daemon.mjs` 只监听 `127.0.0.1`，不要改成 `0.0.0.0`

---

## 7. 声明

### 许可

本项目采用 **Apache License, Version 2.0** 授权，许可证全文见 [`LICENSE`](./LICENSE)，归属与联系信息见 [`NOTICE`](./NOTICE)。

```
Copyright 2026 Gigabind Technology (cdp-control)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### 联系方式

商业授权、定制开发、技术支持、问题反馈：

> **zdw@gigabind.com**

### 使用须知

本项目是**浏览器调试工具**，仅应用于：

- 你拥有或已获得明确授权调试的网站与系统；
- 你自己的账号、你自己设备上的会话；
- 自动化测试、数据采集（在目标站点条款允许范围内）、页面排障。

**禁止**用于未经授权的访问、绕过他人系统的身份或区域限制、窃取凭据、规避支付机构风控等用途。

启用远程调试期间，本机任意进程均可控制该浏览器并读取全部站点 Cookie；由此产生的账号、数据与合规风险由使用者自行承担。

### 免责

本软件按"现状"提供，不附带任何明示或暗示的担保。作者与版权持有人不对因使用本软件产生的任何直接或间接损失承担责任。
