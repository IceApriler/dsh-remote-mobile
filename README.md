<div align="center">

# dsh-remote-mobile

**DeepSeek Harness (DSH) 远程与移动端安全接入代理插件**

[![npm version](https://img.shields.io/npm/v/dsh-remote-mobile.svg?style=flat-square&color=3b82f6)](https://www.npmjs.com/package/dsh-remote-mobile)
[![npm downloads](https://img.shields.io/npm/dm/dsh-remote-mobile.svg?style=flat-square&color=22c55e)](https://www.npmjs.com/package/dsh-remote-mobile)
[![node](https://img.shields.io/badge/node-%3E%3D18.0.0-8b5cf6?style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/dsh-remote-mobile.svg?style=flat-square&color=10b981)](https://github.com/IceApriler/dsh-remote-mobile/blob/master/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-Web%20Profile-0ea5e9?style=flat-square)](https://github.com/IceApriler/dsh-remote-mobile)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/IceApriler/dsh-remote-mobile/pulls)

<p align="center">
  <b>零改动底层代码 · 局域网 / Tailscale 安全接入 · 扫码配对 · 移动端样式适配 · 工作区能力复用 · 实时状态推送</b>
</p>

<p align="center">
  📱 <b>桌面级移动工作台</b>：手机上也能新建 / 切换工作区、执行终端命令<br>
  🛡️ <b>多重安全认证</b>：扫码配对 · 长期密码 · 免密直连 + RSA 加密 + 防爆破封禁<br>
  🎨 <b>移动端样式片段</b>：内置三段预设，不满意可自定义 CSS
</p>

[English Documentation](./README_EN.md) · [简体中文](./README.md)

<p align="center">
  <a href="#about">这是什么</a> •
  <a href="#advantages">核心优势</a> •
  <a href="#quick-start">快速开始</a> •
  <a href="#modes">接入模式</a> •
  <a href="#config">网络配置</a> •
  <a href="#preview">界面预览</a> •
  <a href="#features">功能特性</a> •
  <a href="#install">安装与更新</a> •
  <a href="#advanced">高级配置</a> •
  <a href="#storage">本地文件存储</a> •
  <a href="#faq">常见问题</a>
</p>

---

</div>

<span id="about"></span>
## 📖 这是什么

`dsh-remote-mobile` 是专为 **DeepSeek Harness (DSH)** 深度定制的远程与移动端安全治理插件。

DSH 核心服务出于安全考虑默认仅监听本地回环地址（`127.0.0.1`），手机、平板或其他电脑无法从外部访问 Web 控制台。本项目通过**访问控制中间件**与**请求隔离技术**，安全地开放了 **Tailscale 虚拟私网** 以及 **本地局域网 (Wi-Fi/LAN)** 访问能力，并提供传输加密、扫码配对、长期密码认证与防暴力破解审计体系。

手机端访问时，插件还针对 DSH 界面做了**移动端样式适配**：侧边栏抽屉折叠与可拖拽展开把手、新版官方三栏 Grid 布局与右侧边栏兼容、设置弹窗居中微缩、对话正文高密度排版等，让手机上的使用体验更贴近桌面端。

---

<span id="advantages"></span>
## ⚡ 核心优势

* 🚀 **突破网络壁垒，复用桌面端能力**：用于在局域网 / Tailscale 下访问 DSH Web。在移动端或外部设备访问时，**支持新建工作区、切换工作区、执行终端命令等常用桌面端操作**。
* 📱 **手机端专属适配与同源复用**：直接复用 DSH 官方 Web 前端（手机与桌面是同一套界面）与各类生态插件（如侧边栏、任务看板、终端面板等），无需单独维护手机端后台。插件已针对移动端做好了基础响应式适配（如侧边栏抽屉折叠、设置弹窗居中、对话正文字号与行距精细调小以提升一屏信息量），并内置**样式片段覆写功能**，支持开箱即用或按需注入自定义 CSS 样式小插件。
* 🛡️ **安全门禁与传输加密**：内置 RSA 非对称公钥加密、`scrypt` 加盐慢哈希密码落盘、连续输错自动熔断锁定 IP，拦截公网/局域网未经授权的访问。
* 📲 **扫码快速配对**：自动识别并生成 Tailscale CGNAT 与局域网专属访问链接与二维码，手机扫码即可完成长效授权。
* 🔄 **SSE 实时状态推送**：设备上线、下线、注销、IP 锁定等安全事件即时推送，无需前端轮询。
* 🤝 **插件通用共存保护**：与其他远程/Web 接入类插件并存时自动让出共享服务、保证正常启动，设置页提供冲突警示横幅与一键复制的「诊断与修复报告」。

---

<span id="quick-start"></span>
## 🚀 快速开始

### 1. 一键安装插件

在终端执行 DSH 官方插件安装指令（推荐）：

```bash
dsh plugin --profile web add dsh-remote-mobile
```

> [!IMPORTANT]
> **生态插件安装建议**：**不建议安装 `@linxin666/dsh-web-all` 全家桶**，更推荐**按需安装单体功能插件**。全家桶将多个前端模块合并打包，可能引发移动端悬浮入口重复与手势交互冲突；如需任务看板、宠物等生态功能，建议直接安装对应的单体包（原因、推荐命令与共存说明见 [常见问题 Q6](#faq)）。

---

<span id="config"></span>
### 2. 前置配置（新装零配置；老用户先迁移）

> [!TIP]
> **🚀 DSH 0.2.1+ 架构升级说明（零配置开箱即用）**：
> 官方在 DSH 0.2.1+ 中出于安全考虑禁止将底座 `webserver` 直接监听在通配地址 `0.0.0.0` 上。
> 本插件内置了**智能自适应安全接入代理**：
> - **DSH 0.2.1+（新版，且已删除旧的 `0.0.0.0` 配置）**：**无需再配置 `webserver`**！DSH 保持官方安全的 `127.0.0.1:3080`，插件默认在 `0.0.0.0:3081` 开启独立安全接入代理。手机扫码默认连接 `3081`（端口被占用时会自动递增，以设置页二维码为准），电脑本机依然使用 `3080`，避免因通配地址校验导致的启动失败。
> - **DSH 0.1.7 ~ 0.2.0（旧版）**：若 `cordis.patch.yml` 中保留了 `host: '0.0.0.0'`，插件会自动回退 `direct` 模式，保持旧版直连行为；若通过自定义域名/公网 IP 访问，请按下方 `trustedHosts` 配置。

> [!IMPORTANT]
> **⚠️ 老用户升级到 DSH 0.2.1+ 必看**：
> 如果您之前为了远程访问，曾在 `cordis.patch.yml` 中手动添加了 `webserver.host: '0.0.0.0'`，升级到 DSH 0.2.1+ 后底座会因为官方禁止通配监听而直接抛错崩溃。
> **请务必先将该行配置删除**，恢复官方默认状态：
>
> ```yaml
> # ❌ 升级 0.2.1+ 后请删除此配置（否则底座会报错并拒绝启动）：
> # - id: webserver
> #   host: '0.0.0.0'
>
> # ✅ 正确姿势：完全无需配置 webserver，底座自然监听 127.0.0.1:3080。
> # 本插件会自动启动 0.0.0.0:3081 安全接入代理转发，手机访问 3081 即可。
> ```
>
> **安全权衡说明**：安全接入代理默认监听 `0.0.0.0:3081`（暂不含 TLS）。若在公共 Wi-Fi 或未经保护的网络下使用，强烈建议配合 Tailscale（WireGuard 隧道天然加密）或通过自定义高强度长期密码与 IP 锁定机制保障安全。

如果您安装了其他可能产生冲突的插件，推荐在 `~/.dsh/profiles/web/cordis.patch.yml`（Windows 对应 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`）中禁用冲突项：

```yaml
# （推荐）只保留一款远程/Web 接入类插件，避免功能重复与入口混乱
# 本插件与其他远程接入类插件共存时也能正常启动：检测到配对共享服务被占用
# 会自动让出，并在设置页顶部展示警示横幅说明详情。
# 示例：禁用 @linxin666/dsh-web-ui-all 内置的远程插件
- id: web-ui-remote-web-ui
  disabled: true
```

> **💡 说明**：插件自身注册已由 DSH Bundle 体系全自动处理，**无需**在 `cordis.patch.yml` 中额外添加 `id: remote-mobile`。Windows 用户可按 `Win + R` 键输入 `%USERPROFILE%\.dsh\profiles\web` 快速直达配置目录。

> [!WARNING]
> **不建议安装聚合全家桶（`@linxin666/dsh-web-all`）**：它会把多个子插件的前端逻辑合并打包到同一个 `client.js` 中，加载时自执行，可能与本插件产生移动端入口重复与手势冲突。推荐**按需安装所需单体插件**（如任务看板、宠物等）。完整原因、推荐命令与共存说明见 [常见问题 Q6](#faq)。

---

### 3. 启动并使用

```bash
dsh web --no-open
```

启动后，在电脑浏览器打开 DSH Web 控制台，进入 **设置 ⚙️ -> 远程与移动端**，使用手机微信或系统相机扫描二维码即可立即开启移动端接入！

> 设置面板按 **「接入 / 设备与安全 / 样式覆写 / 本地数据」** 四个页签分组显示，避免长页面；页签选择会被记住，切换不重置配对码等状态。

---

<span id="modes"></span>
## 🧭 版本与接入模式

默认使用 `proxy`，新装用户不需要配置 `webserver`：

| 场景 | DSH 核心监听 | 生效模式 | 手机访问 |
|---|---|---|---|
| DSH 0.2.1+ 新装 | `127.0.0.1:3080` | `proxy` | `3081` |
| DSH 0.1.7 ~ 0.2.0 旧配置 | `0.0.0.0:3080` | `direct`（自动回退） | `3080` |
| 0.2.1+ 绑定具体网卡 IP | `10.x.x.x:3080` | `direct` | `3080` |
| 同机反向代理 | `127.0.0.1:3080` + 显式 `direct` | `direct` | 反代入口 |

- **`proxy`**：推荐；核心保持回环，插件在 `3081` 提供认证与转发。
- **`direct`**：不启动代理；要求核心本身对外可达，主要用于旧版配置或高级部署。
- **`direct` + 回环核心**：外部手机无法直连，仅适合同机反向代理。

---

<span id="preview"></span>
## 🖼️ 界面预览

### PC 端 DSH 插件控制面板

| 网络接入与扫码配对 | 设备与安全 |
| :---: | :---: |
| ![PC 设置面板 - 网络接入与扫码配对](images/pc-dsh-setting-1.png) | ![PC 设置面板 - 设备与安全](images/pc-dsh-setting-2.png) |
| **样式片段覆写** | **本地数据存储** |
| ![PC 设置面板 - 样式片段覆写](images/pc-dsh-setting-3.png) | ![PC 设置面板 - 本地数据存储](images/pc-dsh-setting-4.png) |

---

### 手机端实机演示（同源免登与工作区能力）

| 登录 | 对话列表字号缩放 | 侧边栏移动端样式 | 官方轨迹查看 |
| :---: | :---: | :---: | :---: |
| ![登录](images/mobile-auth.jpg) | ![对话列表字号缩放](images/mobile-dsh-1.jpg) | ![侧边栏移动端样式](images/mobile-dsh-2.jpg) | ![官方轨迹查看](images/mobile-dsh-3.jpg) |

---

<span id="features"></span>
## 🌟 功能特性

### 1. 网络接入支持
- **Tailscale 虚拟私网**：自动识别本机 Tailscale IP（`100.64.0.0/10` CGNAT 网段），生成专属访问二维码，支持开启免密直连（底层传输加密由 Tailscale WireGuard 隧道保障）。
- **本地局域网 (LAN / Wi-Fi)**：自动识别 RFC 1918 私有 IP（如 `192.168.x.x`、`10.x.x.x`、`172.16-31.x.x`），提供局域网专属二维码与直达链接预览，附带醒目的高危风险提示。
- **二维码快速配对**：支持手机相机或微信扫码直达授权页面。

### 2. 多重认证机制
- **动态 6 位配对码**：生成 6 位短期配对码（5 分钟有效，一次性使用），手机端扫码输入后换取 365 天有效期的安全认证 Cookie。
- **长期访问密码**：支持设置自定义长期访问密码（长度需至少 6 位且含字母与数字），便于多设备长期固定登录。
- **免密直连模式**：可针对 Tailscale 或局域网环境单独切换免密直连。关闭免密直连后会自动清理临时设备凭证并重置状态。
- **设备会话管理**：实时查看已连接设备的类型、操作系统、浏览器、来源 IP 及最近活跃时间，支持单设备注销与一键注销全部设备。

### 3. 安全防护
- **传输层 RSA 非对称加密**：登录认证接口在客户端即完成 RSA 加密，敏感密码与配对码加密后才经网络传输。
  - **HTTPS 等安全上下文**：优先使用 Web Crypto 原生 `RSA-OAEP-SHA256`；
  - **DSH 默认的 HTTP 局域网 / Tailscale 访问（非安全上下文）**：回退至纯 JS 垫片，并使用 `crypto.getRandomValues()` 做密码学安全随机数填充。
- **scrypt 慢哈希存储**：服务端采用 `scrypt` 加盐慢哈希算法（`scrypt:${salt}:${hash}`）对密码进行落盘存储，比对过程采用 `crypto.timingSafeEqual` 恒定时间比较以防范时序侧信道攻击。
- **防暴力破解与限频保护**：
  - 连续输错凭证达到阈值（默认 5 次）自动锁定该 IP 15 分钟，拦截后续验证请求并返回 HTTP 429；
  - 滑动窗口限频（默认 60 次/分钟），防范高频恶意刷量探测；
  - 访问审计与锁定状态持久化落盘，服务重启后自动恢复；
  - 支持管理员在管理面板中一键解锁指定 IP。
- **智能静态资源放行机制**：安全门禁内置智能前端静态扩展名识别（放行 `.js`、`.css`、`.png`、`.svg`、`.woff2` 等 20 种合法资源），拦截无扩展名或动态管理 API 请求（如 `/plugins/xxx/admin`），确保第三方生态插件前端正常展示的同时严密保护后台动态接口，无需用户在设置界面手动维护白名单。（DSH 核心静态目录 `/assets/` 属官方资源，单独无条件放行。）
- **高可靠原子持久化与防抖**：采用毫秒级写盘防抖节流保护磁盘 I/O（会话数据 500ms、样式片段 300ms），配合 `beforeExit` 进程退出 Flush 保证数据不丢失；`settings.json` 与 `style-snippets.json` 采用临时文件原子替换（`renameSync`），防止异常中断损坏数据。
- **真实 IP 安全提取**：默认仅信任底层 Socket 真实连接地址；当请求被识别为受信反向代理（Host / `X-Forwarded-*`）时，才采用 `X-Forwarded-For` 首个合法 IP，兼顾真实来源与防伪造。
- **跨站写请求防御**：所有非 GET/HEAD 请求都会校验浏览器同源信号（`Origin` / `Sec-Fetch-Site`），恶意网页驱使浏览器向 `127.0.0.1` 发起的跨站写请求会被直接拒绝；curl / 本机脚本等无浏览器信号的客户端不受影响。注意：该策略也会拦截第三方插件的跨域 webhook / OAuth callback，以及发送 `Origin: null` 的旧 WebView；使用此类集成时请先做兼容性验证。
- **上下文化与反代边界**：同源/本地变体 Host、Origin 成对规范化；恶意跨站 Origin 原样保留供下游 CSRF 检查。同机 127 反代通过外部 Host、LAN/Tailscale 反代通过 `X-Forwarded-*` 识别为代理流量，不再被误判为免密客户端，必须通过插件 Token 鉴权；受信代理通过内部 Secret 例外。插件自身为 loopback 请求注入的 127 Forwarded 头会被识别为内部头，不会误伤本机 3080 根路径的 connection 鉴权。SSE 事件流仅限同源连接，不开放跨域读取。

### 4. 实时状态同步与国际化
- **SSE 实时事件推送**：基于 Server-Sent Events 实现新设备接入、设备重连、会话撤销及安全告警的实时通知，内置连接双向关闭监听与幂等清理。
- **全界面中英文双语自适应**：根据 DSH 全局语言偏好与浏览器环境，动态自适应中英文面板、提示及手机端界面。
- **非 HTTPS 兼容补丁**：自动注入 `crypto.randomUUID` 与 `navigator.clipboard` Polyfill，解决移动端浏览器在 HTTP 非安全上下文下缺少原生 API 的报错（`clipboard` polyfill 保证非安全上下文下复制/样式复制功能正常）。

### 5. 移动端样式片段（样式小插件）

DSH Web 界面在手机上仍有不少沿袭桌面端的样式问题，插件内置「移动端样式片段」模块，把移动端适配拆分为可独立启停的 CSS 片段：

- **按界面区域划分的三段内置预设**（默认移动端启用、PC 关闭）：
  - `preset-sidebar` **侧边栏抽屉导航**：折叠时侧边栏 0 宽度占用、可拖拽悬浮把手、自适应抽屉宽度、44px 触控友好区；
  - `preset-settings` **设置面板适配**：上下堆叠自适应、顶部导航横滑、内容纵向自然滚览；
  - `preset-main` **对话正文高密度排版**：小字号 12.5px + 紧凑行距 + 收紧边距，每行展示更多内容；基于稳定 HTML 元素与 localName 后缀，不做布局缩放，无右侧留白；
- **PC / 移动端分别启停（按视口宽度判定，与设备无关）**：每段预设和每个自定义片段都有独立的「🖥️ PC」「📱 移动端」两个开关；「移动端」= 窄视口（≤900px）生效——**PC 浏览器拉小窗口也会生效**，「PC」= 宽视口（>900px）生效，两端都开 = 全宽度生效；
  - **关于 `html[data-dsh-mobile]` 选择器**：该标记仅在**移动端 UA** 请求时写入。若自定义 CSS 以 `html[data-dsh-mobile]` 打头，则只在手机等移动端 UA 下命中；希望「窄屏桌面窗口也生效」时请直接写选择器（无需 `html[data-dsh-mobile]` 前缀），注入层会自动包裹媒体查询。
- **用户自定义（样式小插件）**：在 **设置 ⚙️ → 远程与移动端 → 🎨 移动端样式片段** 中粘贴自己的 CSS 即可新增片段，支持编辑/启停/删除/**一键复制**（每个片段「查看 CSS」旁都有「📋 复制样式」按钮），持久化于 `~/.dsh/remote-mobile/style-snippets.json`，保存后下一次页面加载即生效，无需重启；
- **按 UA 打标记 + 按宽度生效**：样式按视口宽度档生效（见上），与设备 UA 无关；移动端 UA 请求额外给 `<html>` 打上 `data-dsh-mobile="1"` 标记作为作用域钩子（以其作为选择器时仅移动端 UA 命中，详见上条），并注入可拖拽的展开把手脚本（全端注入，运行时仅在侧边栏折叠时生效）。

### 6. 插件通用共存保护

- **启动零冲突**：`remoteWebUiPairing` 配对共享服务被其他远程/Web 接入类插件占用时，本插件自动让出（延迟裁决：等待激活窗口结束后检测服务名归属），避免服务重名导致的整树回滚崩溃——从插件市场安装后可直接启动，无需任何手动配置；
- **冲突状态可见化**：检测到共存时，设置页顶部展示可关闭的警示横幅（中英文），说明让出行为与「只保留其一」的建议；处理完成后刷新页面即不再出现；
- **一键诊断报告**：横幅内 **「📋 复制诊断与修复信息」** 按钮可复制完整诊断报告——运行时自动识别占用方插件包名与 loader entry id，报告含精确到行的修复配置与命令（禁用对方 / 卸载本插件二选一），粘贴给 AI 助手即可按步骤处理。

---

<span id="install"></span>
## 📦 安装与更新

<details>
<summary><b>展开查看全部 4 种安装方式</b></summary>

### 方式 1：通过 DSH 命令行一键安装（最推荐）
```bash
dsh plugin --profile web add dsh-remote-mobile
```

### 方式 2：通过 Web 设置页「插件管理」图形化安装
1. 在浏览器打开 DSH Web 控制台；
2. 点击左下角 **设置 ⚙️ -> 插件**；
3. 切换到顶部的 **「插件管理」** Tab；
4. 在输入框中输入 npm 包名 **`dsh-remote-mobile`**，点击 **「安装」**；
5. 安装完成后重启 DSH 即可生效。

### 方式 3：在 Profile 目录中通过包管理器安装
```bash
# 1. 进入 DSH Web Profile 目录
cd ~/.dsh/profiles/web

# 2. 通过 pnpm 安装
pnpm add dsh-remote-mobile
```

### 方式 4：本地源码开发与调试（软链接即时生效）

```bash
# 1. 克隆代码至本地
git clone https://github.com/IceApriler/dsh-remote-mobile.git
cd dsh-remote-mobile

# 2. 安装依赖并编译打包
npm install
npm run build
```

**建立软链接到 DSH 运行环境（开发修改后 `npm run build` 即时生效）：**

* **macOS / Linux**：
  ```bash
  rm -rf ~/.dsh/profiles/web/node_modules/dsh-remote-mobile
  ln -s $(pwd) ~/.dsh/profiles/web/node_modules/dsh-remote-mobile
  ```

* **Windows (PowerShell)**：
  ```powershell
  Remove-Item -Recurse -Force "$HOME\.dsh\profiles\web\node_modules\dsh-remote-mobile"
  New-Item -ItemType Junction -Path "$HOME\.dsh\profiles\web\node_modules\dsh-remote-mobile" -Target (Get-Location)
  ```

* **Windows (CMD)**：
  ```cmd
  rmdir /s /q %USERPROFILE%\.dsh\profiles\web\node_modules\dsh-remote-mobile
  mklink /J %USERPROFILE%\.dsh\profiles\web\node_modules\dsh-remote-mobile %CD%
  ```

</details>

### 🔄 更新插件

在终端执行更新指令，更新后重启 DSH 即可生效：

```bash
# 方式 1：通过 DSH 命令行一键更新（推荐）
dsh plugin --profile web update dsh-remote-mobile

# 方式 2：通过 Profile 目录包管理器更新
cd ~/.dsh/profiles/web && pnpm update dsh-remote-mobile
```

> **💡 提示**：也可以在 Web 控制台 **设置 ⚙️ -> 插件 -> 插件管理** 中点击对应插件的更新按钮，或重新执行 `dsh plugin --profile web add dsh-remote-mobile@latest`。

### 🗑️ 卸载插件

```bash
dsh plugin --profile web remove dsh-remote-mobile
```

---

<span id="advanced"></span>
## ⚙️ 高级配置

配置持久化于插件自有文件 `~/.dsh/remote-mobile/settings.json`。免密开关、长期密码与限频/锁定参数可在 Web 设置页调整；`proxyPort`、`proxyHost`、`mode`、`trustedHosts` 目前需直接编辑该文件并重启 DSH：

```jsonc
{
  "allowTailscale": false,     // boolean，默认 false：是否允许 Tailscale 虚拟私网免密访问
  "allowLan": false,           // boolean，默认 false：是否允许局域网免密访问（高危警示）
  "secretHash": "",            // string，默认空：长期访问密码的 scrypt 加盐哈希值
  "maxVisitsPerMinute": 60,    // number，默认 60：单 IP 每分钟最大访问登录页次数
  "maxFailedAttempts": 5,      // number，默认 5：触发封禁的连续认证失败最大次数
  "lockDurationMs": 900000,    // number，默认 900000 (15分钟)：IP 锁定持续时间（毫秒）
  "proxyPort": 3081,           // number，默认 3081：安全接入代理端口
  "proxyHost": "0.0.0.0",      // string，默认 0.0.0.0：安全接入代理监听地址
  "mode": "proxy",             // proxy | direct：proxy 默认（推荐）
  "trustedHosts": [            // string[]，默认 []：受信任域名白名单（如 Tailscale MagicDNS 或自定义反代域名）
    "my-device.tailnet.ts.net"
  ]
}
```

> **术语说明**：本文中的“安全接入代理（Proxy）”指插件在 `3081` 提供的反向代理入口，负责认证、Host/Origin 校验与请求转发，**不是**网络默认网关。
>
> **关于 `trustedHosts` 受信任域名**：若您通过 Tailscale MagicDNS 域名（如 `xxx.tailnet.ts.net`）或外部反向代理域名访问 DSH，请在该数组中添加裸域名。安全接入代理与底座会自动将其纳入受信任白名单，防止被代理 Host 检查或第三方插件安全围栏拦截（报 400 或 403）。该白名单同样适用于 **direct 模式**：通过自定义域名、公网 IP 或非本机网卡地址访问时，必须把实际 Host 加入 `trustedHosts`；通过本机网卡 IP / 回环访问会自动识别。
>
> **`proxyPort` / `proxyHost` / `mode` 说明**：通常保持默认即可。`mode: 'proxy'` 是默认值，要求底座监听在回环地址；如果检测到核心已对外监听（旧版 `0.0.0.0` 或具体网卡 IP），会自动回退 `direct` 并输出警告。`mode: 'direct'` 不启动安全接入代理，要求核心本身可被外部访问；若核心是回环地址，`direct` 仅适合同机反向代理，外部手机无法直连。修改这些高级配置后需重启 DSH。
>
> **反向代理 HTTPS 注意**：若通过 Nginx/Caddy/Tailscale Serve 等反代以 HTTPS 访问，请确保：
> 1. **保留外部 Host**（Nginx 使用 `proxy_set_header Host $host`，不要把 Host 改写成 `127.0.0.1`）；
> 2. 透传 `X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto: https`（Caddy/Tailscale 通常自动处理）。
>
> 插件会用这些头做协议/来源同源校验与 302 重定向；当反代携带 Forwarded 头并被识别为代理时，即使位于 LAN/Tailscale 网段也会禁用 `allowLan`/`allowTailscale` 免密，改为正常 Token 鉴权。若反代把 Host 改写为 `127.0.0.1` 且不发送任何 `X-Forwarded-*` 头，插件无法区分“本机浏览器”和“同机反代”；LAN/Tailscale 反代若缺少这些头，也可能被误判为真实局域网客户端，请务必按上述配置修正。

> **关于配置存储**：DSH 自 **0.1.7** 起（最早见于 v0.1.7-alpha.1 的 release notes，0.2.x 延续）官方已弃用 `~/.dsh/settings.yaml` 作为**实时配置源**——该文件会在启动时被一次性迁移进当前 profile 的 `cordis.patch.yml`，并改名为 `settings.yaml.imported`（详见 [Q8](#faq)）。因此本插件不再写入 settings.yaml，而是持久化到上述自有 `settings.json`；首次启动时会自动从旧 `settings.yaml` / `settings.yaml.imported` 迁移一次（把旧长期密码、限频等配置救回）。

### 🎨 移动端样式片段（可选）

自定义样式片段（样式小插件）与启停状态持久化于 `~/.dsh/remote-mobile/style-snippets.json`，可在设置面板图形化管理，也可直接编辑该文件：

```json
{
  "version": 2,
  "presetStates": {
    "preset-sidebar": { "pc": false, "mobile": true },
    "preset-settings": { "pc": false, "mobile": true },
    "preset-main": { "pc": false, "mobile": true }
  },
  "custom": [
    {
      "id": "custom-xxx",
      "name": "我的样式小插件",
      "css": "html[data-dsh-mobile] .我的选择器 { ... }",
      "pcEnabled": false,
      "mobileEnabled": true
    }
  ],
  "customOrder": ["custom-xxx"]
}
```

> 所有启用片段会拼接为单个 `<style>` 注入主页面与 `/auth` 登录页，**生效与否由视口宽度决定**：`mobileEnabled` 的片段包在 `@media (max-width: 900px)`（≤900px 生效，PC 拉小窗口同样生效），`pcEnabled` 的片段包在 `@media (min-width: 901px)`（宽视口生效），两端都开则全宽度生效（v1 旧格式自动迁移，`presetStates` 按三个预设分组齐全落盘）。注意：PC 开启侧边栏抽屉预设会改变桌面布局，如不想用可关闭该预设的 PC 开关。

---

<span id="storage"></span>
## 📂 本地文件存储位置

> **💡 路径提示**：在 macOS / Linux 下根目录为 `~/.dsh/`；在 Windows 下对应为 `C:\Users\<你的用户名>\.dsh\`（可在文件资源管理器地址栏直接输入 `%USERPROFILE%\.dsh` 直达）。

| 文件路径 | 说明 | 安全级别 |
|---|---|---|
| `~/.dsh/remote-mobile/settings.json` | 插件配置：免密开关、长期密码哈希、限频/锁定策略、接入模式与代理监听参数 | 本地落盘，权限 `0o600`（仅当前用户可读写） |
| `~/.dsh/remote-mobile/devices.json` | 已授权设备会话、IP 访问计数与安全审计数据（内含长效 Token，权限 `0o600`） | 本地落盘，仅当前用户可读写 |
| `~/.dsh/remote-mobile/rsa-keys.json` | 服务端 RSA 密钥对文件（含公钥与私钥） | 本地落盘，权限 `0o600`（仅当前用户可读写） |
| `~/.dsh/remote-mobile/style-snippets.json` | 移动端样式片段（内置预设启停状态 + 用户自定义 CSS 小插件） | 本地落盘持久化 |

---

<span id="faq"></span>
## ❓ 常见问题 (FAQ)

<details>
<summary><b>Q0: 启动报错 <code>listen EADDRINUSE: address already in use 0.0.0.0:3080 / :3081</code>？</b></summary>

**答**：这是 **3080（DSH 核心）或 3081（插件安全接入代理）端口被其他进程占用**（绝大多数是上一个 `dsh web` 实例尚未完全退出，例如桌面快捷方式拉起的隐藏实例、或重启时新旧进程交叠），**与安装了哪个插件无关**。排查步骤：

1. **查找占用端口的进程**：
   * **macOS / Linux**：`lsof -nP -iTCP:3080` / `lsof -nP -iTCP:3081`
   * **Windows**：`netstat -ano | findstr 3080` / `netstat -ano | findstr 3081`（最后一列为 PID）
2. **结束旧实例**：
   * **macOS / Linux**：`kill <PID>`
   * **Windows**：`taskkill /F /PID <PID>`（或在任务管理器中结束对应 Node 进程）
3. 重新启动 `dsh web` 即可。
4. **注意**：桌面快捷方式（dsh-desktop-launcher 生成的后台实例）与终端手动启动的实例不能同时运行。若只是 3081 被占用，插件默认会自动递增尝试下一个端口（最多 10 个），以设置页二维码/终端 Banner 显示的实际端口为准；3080 被占用通常需要先结束旧 DSH 实例。

另：若日志显示的是 `service "remoteWebUiPairing" has been registered` 类错误，请升级本插件至最新版本——新版已内置通用共存保护，与其他远程接入类插件并存时可正常启动并自动让出服务，并在设置面板顶部提示冲突详情。
</details>

<details>
<summary><b>Q1: 手机扫码后提示「连接被拒绝」或无法打开页面？</b></summary>

**答**：请按以下步骤逐一排查：
1. **配置检查**：DSH 0.2.1+ **不要**在 `cordis.patch.yml` 中配置 `host: '0.0.0.0'`（会启动失败）；保持 DSH 默认的 `127.0.0.1:3080`，插件会自动启动 `3081` 安全接入代理。若你是旧版 DSH（0.1.7 ~ 0.2.0，可使用 `0.0.0.0`）或显式使用 `direct` 模式（需具体网卡 IP），才需要配置监听地址。修改配置后必须重启 DSH。
2. **同一局域网**：局域网访问时，确保手机与电脑连接在同一个 Wi-Fi / 路由器下，且未开启手机端的独立代理/VPN（避免流量绕过局域网）。
3. **Windows 防火墙排查（Windows 用户常见原因）**：
   * 启动 DSH 时如弹出「Windows Defender 防火墙」警报，请务必勾选 **「专用网络」** 和 **「公用网络」** 并允许访问；
   * 若错过弹窗或依然无法连通，可使用**管理员权限打开 PowerShell** 放行代理端口（默认 `3081`；若使用 `direct` 模式则放行核心端口 `3080`）：
     ```powershell
     New-NetFirewallRule -DisplayName "DSH Remote Proxy 3081" -Direction Inbound -LocalPort 3081 -Protocol TCP -Action Allow
     ```
   * **检查 Wi-Fi 网络类型**：在 Windows「设置 -> 网络和 Internet -> Wi-Fi」中，确保当前 Wi-Fi 网络配置文件类型已设为 **「专用网络」**（若为「公用网络」，Windows 防火墙会默认拦截局域网入站请求）。
4. **多网卡环境（WSL / 虚拟机）**：Windows 如安装了 WSL2 或 Hyper-V，可能会生成虚拟网卡 IP（如 `172.x.x.x`）。请在插件设置面板中确认使用的是物理无线网卡（WLAN / Wi-Fi）对应的局域网 IP 或 Tailscale 二维码；若代理端口曾自动递增，以设置页/终端 Banner 显示的实际端口为准。
</details>

<details>
<summary><b>Q2: Tailscale 免密直连和局域网免密有什么区别？</b></summary>

**答**：
* **Tailscale 免密**：高度安全。因为 Tailscale 是基于 WireGuard 的传输加密虚拟私网，只有你自己登录了同一账号的设备才能连通。
* **局域网免密**：存在安全隐患。任何连入你家 Wi-Fi 的设备（包括访客或蹭网设备）均可直接控制你的工作区，因此非完全可信环境**切勿开启**。
</details>

<details>
<summary><b>Q3: 手机端切换或新建工作区能正常使用吗？</b></summary>

**答**：**支持**。本插件通过请求隔离技术，使手机端与 PC 桌面端拥有一致的工作区管理与执行能力。若点“选择文件夹”时弹窗出现在 PC 而不是手机，这是 DSH 目录选择器的 auto 判定问题，见 [Q12](#q12)。
</details>

<details>
<summary><b>Q4: 手机端样式还是不满意，想完全自己定制？</b></summary>

**答**：打开 **设置 ⚙️ → 远程与移动端 → 🎨 移动端样式片段**，先尝试启停三段内置预设（侧边栏 / 设置面板 / 正文，每段都有独立的 PC 与移动端开关）；还不够就在「自定义片段」里粘贴自己的 CSS（例如 `.我的选择器 { ... }`）。保存后手机端刷新页面立即可见，改动全部落在 `~/.dsh/remote-mobile/style-snippets.json`，升级插件不会丢失。
> 小提示：若选择器写成 `html[data-dsh-mobile] .xxx`，则只在移动端 UA 下生效，窄屏桌面窗口不会命中；希望两端窄屏都生效，请直接写选择器。
</details>

<details>
<summary><b>Q5: 设置页顶部出现黄色横幅「⚠️ 检测到其他远程接入插件」是什么意思？</b></summary>

**答**：说明当前有另一款远程/Web 接入类插件与本插件同时启用，且对方先占用了配对共享服务。为避免启动冲突，本插件已**自动让出**该服务（自身的安全门禁与远程接入不受影响），但两套远程功能并存可能出现重复入口。建议只保留其一：

1. 点击横幅中的 **「📋 复制诊断与修复信息」**，将报告粘贴给 AI 助手按步骤处理（报告已自动识别占用方包名与条目 id，并给出精确的修复配置）；
2. 推荐保留本插件时：按报告指引在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加对应的 `disabled: true` 两行，然后重启 DSH；
3. 横幅可点击 ✕ 临时关闭；冲突解除后刷新页面即不再出现。
</details>

<details>
<summary><b>Q6: 为什么建议按需安装单体功能插件，而不建议安装聚合全家桶（如 @linxin666/dsh-web-all）？</b></summary>

**答**：主要是基于**避免功能冲突**与**环境轻量解耦**的考量：
1. **避免移动端入口重复与手势交互冲突**：全家桶插件会将十几个独立功能插件的前端代码编译打包在同一个 `client.js` 中，其内置的移动端自适应逻辑在模块加载时会自执行。即使在 `cordis.patch.yml` 中配置了 `web-ui-remote-web-ui: disabled: true`，浏览器加载脚本后仍可能渲染出小鲸鱼悬浮按钮（`#dshRemoteWhale`），导致两个插件的移动端悬浮入口重叠以及触控手势冲突。
2. **轻量可控与独立升级**：按需单独安装所需插件，既能保证环境轻盈，也便于各个插件独立升级、回滚与维护，避免依赖绑定。推荐按需安装各自独立的单体包，例如：
   ```bash
   # 需要哪个装哪个，职责清晰、互不干扰
   dsh plugin --profile web add @linxin666/dsh-client-ui-task-board
   dsh plugin --profile web add @linxin666/dsh-client-ui-web-ui-settings
   dsh plugin --profile web add @linxin666/dsh-pet
   dsh plugin --profile web add @linxin666/dsh-ssh
   ```
*(注：自 v1.6.0 起，`dsh-remote-mobile` 已内置兼容防护——注入抑制脚本向 `sessionStorage` 写入 `dsh-remote-force-desktop=1` 并协同 CSS，避免 `#dshRemoteWhale` 被**重复挂载**；但小鲸鱼入口本身仍可能由对方渲染，入口重叠的根源在对方，故仍建议按需安装单体包)*。
</details>

<details>
<summary><b>Q7: 部署在 NAS / 统一网关 / Nginx 反向代理下（如飞牛 fnOS <code>/app/dsh/</code>）有什么注意事项？</b></summary>

**答**：
1. **子路径与前缀自适应**：自 v1.8.0 起，前端已原生适配 `<base href="...">`，服务端重定向已支持 `X-Forwarded-Prefix` 请求头。经网关子路径代理访问时（如 `http://<ip>:5666/app/dsh/`），各项请求都会自动保持在当前子路径下：
   * **设置面板与 SSE 长连接**：基于 `<base>` 动态解析 API 路径，保存配置、生成配对码、事件推送均不会丢失 `/app/dsh` 前缀（旧版本此处会表现为「点击毫无反应」）；
   * **独立手机登录页与 302 重定向**：登录校验、登录成功后的跳转，以及门禁 / `/auth` 的重定向都会保留当前子路径，不再跳回宿主根目录；
   * **注意**：服务端 302 重定向依赖反向代理透传 `X-Forwarded-Prefix`；若代理未透传该头，重定向将回退到安全默认路径 `/auth`。
2. **反向代理来源识别与鉴权**：
   * 插件默认仅信任底层物理 Socket；**同机 `127.0.0.1` 反代携带外部 Host**，或**任意反代携带 `X-Forwarded-*`** 时，会被识别为**代理流量**，不再走 `loopback` / `allowLan` / `allowTailscale` 免密，必须使用插件 Token（动态配对码或长期密码）鉴权。
   * 请确保反向代理**保留外部 Host**（不要改写为 `127.0.0.1`），并透传 `X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto: https`；Caddy / Tailscale Serve 通常会自动处理，Nginx 需显式配置。若 Host 被改写为 `127.0.0.1` 且没有任何 Forwarded 头，插件无法区分“本机浏览器”与“同机反代”。
   * 若希望外部统一域名访问时仍强制要求输入本插件的配对码/密码，请按上述方式配置反代，让插件能够识别真实来源并执行 Token 鉴权；不要依赖 NAS/宿主网关自身的登录来替代插件认证。
   * 若你不需要 proxy 模式，也可以使用 `direct` 模式绑定具体网卡 IP；但 DSH 0.2.1+ 下不能使用 `0.0.0.0` 通配地址。
</details>

<details>
<summary><b>Q8: 升级 DSH 0.1.7+（含 0.2.x）后 <code>~/.dsh/settings.yaml</code> 不见了 / 我的配置丢了？</b></summary>

**答**：这是 **DSH 官方自 0.1.7 起的行为变更**（最早见于 v0.1.7-alpha.1 的 release notes，0.2.x 延续），与本插件无关：

- DSH 自 **0.1.7** 起已**不再把 `~/.dsh/settings.yaml` 当作实时配置源**。启动时它由官方 `dsh-settings` 的 `importLegacyDocument()` **一次性导入**到当前 profile 的 `~/.dsh/profiles/<profile>/cordis.patch.yml`，随后原文件被**改名为 `settings.yaml.imported`**（先改名、再导入；若某个 section 找不到对应 entry，则会跳过，仅保留在该文件中，且不会重试）。官方 release notes 原文：「设置改由当前 Profile 的插件配置保存，支持声明过的实时更新字段；旧 settings.yaml 仅尝试导入一次，自定义设置插件需适配。」
- 因此升级后 `settings.yaml` 消失、只剩 `settings.yaml.imported` 属**正常现象**；模型 provider、locale 等应改为在 profile 的 `cordis.patch.yml` 中查看/编辑。
- **本插件自 v1.9.0 起**已改为把自身配置持久化到 `~/.dsh/remote-mobile/settings.json`，并在首次启动时**自动从旧 `settings.yaml` / `settings.yaml.imported` 迁移一次**（把长期密码哈希、免密开关、限频阈值等救回），不再依赖 DSH 的 settings.yaml。若你曾发现"长期密码失效/限频重置"，升级到 v1.9.0 后会自动恢复。
</details>

<details>
<summary><b>Q9: DSH 0.2.1+ 启动失败：<code>host "0.0.0.0" is an unspecified (wildcard) address</code>？</b></summary>

**答**：这是 DSH 0.2.1+ 的官方安全限制，和插件版本无关。该错误发生在插件加载之前，插件安全接入代理此时还没有机会接管，因此必须手动处理：

1. 打开 `~/.dsh/profiles/web/cordis.patch.yml`（Windows：`%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`）；
2. 删除或注释掉之前为远程访问添加的 `webserver.host: '0.0.0.0'`（如整段 `- id: webserver ... host: '0.0.0.0'` 仅用于该配置，可整段删除）；
3. 重启 `dsh web --no-open`。DSH 会恢复 `127.0.0.1:3080`，本插件自动启动 `0.0.0.0:3081` 安全接入代理，手机按设置页二维码访问即可。
</details>

<details>
<summary><b>Q10: 访问 <code>http://127.0.0.1:3080/</code> 提示 <code>dsh web authentication required; reopen the URL printed by dsh web</code>，但 3081 正常？</b></summary>

**答**：这是 **DSH 官方的 launch-token 鉴权**，不是插件的 `/auth` 登录页。正常情况下，本插件会接管底座 connection 鉴权，让本机回环请求直接放行；如果 3080 根路径出现该提示，而以下两项正常：

- `http://127.0.0.1:3080/api/remote-mobile/status` 返回 200；
- `http://127.0.0.1:3081/` 返回 200；

说明插件已加载、安全接入代理已生效，但当前进程里的 connection 鉴权仍未放行本机根路径。常见原因是 **热重载/热更新没有重新加载插件代码**，或运行的是旧构建。

处理步骤：

1. 确认安装的是 **1.10.0+**，然后**完整停止并重新启动** `dsh web`（仅刷新浏览器页面不够）；
2. 临时可先用 `http://127.0.0.1:3081/`（插件安全接入代理）访问，或打开 `dsh web` 启动时打印的带 `?token=...` 的 URL 一次，让官方写入 cookie；
3. 若使用反向代理，请按 Q7 保留外部 Host 并透传 `X-Forwarded-*`；
4. 如果重启后仍然出现，请附上 DSH 版本、插件版本与启动日志反馈。

> 1.10.0 已修复“插件自身为 loopback 请求注入的 127 Forwarded 头被误判为反向代理、导致 3080 根路径被官方 401 拦截”的回归；重启后本机 3080 应恢复正常。
</details>

<details>
<summary><b>Q11: 设备列表里出现很多 <code>127.0.0.1 / 📱 iPhone (Browser)</code>，但我没有用过 iPhone？</b></summary>

**答**：这些通常不是真实设备，而是 **1.10.0 之前测试套件写入的假 session**：

- `test/gateway.test.js` 曾用 `store.verify(code, 'iPhone', '127.0.0.1')` 做配对测试；
- 当时的 `SessionStore` 在测试环境只隔离了 `settings.json`，没有隔离 `devices.json`；
- 每运行一次 `npm test`，就会向真实的 `~/.dsh/remote-mobile/devices.json` 增加一条 `127.0.0.1 / User-Agent: iPhone / 扫码配对码` 的 session；
- 真实 iPhone Safari 的 User-Agent 会是很长的 `Mozilla/5.0 (iPhone; ...) ... Safari/...`，不会只有 `iPhone`。

1.10.0 已增加测试隔离：测试环境默认使用临时 `/tmp/dsh-rm-test-devices-*.json`，不会再污染真实设备文件。已有的假 session 可以通过“一键撤销所有设备”后重新配对当前设备清理，或停止 DSH 后从 `devices.json` 中删除对应条目；操作前建议先备份该文件。
</details>

<details id="q12">
<summary><b>Q12: 手机通过 Tailscale / 3081 访问，点“选择文件夹”为什么在 PC 上弹窗，手机没有弹窗？</b></summary>

**答**：这不是 Tailscale 或手机浏览器的问题，而是 DSH 官方目录选择器的“本机/远程”判定导致的：

1. **工作区目录在 PC 上**：DSH 的“选择文件夹”选的是运行 DSH 的电脑上的目录，不是手机本地目录。手机浏览器无法直接弹出 PC 的系统文件选择器。
2. **auto 只按启动环境判定**：`dsh-host-directory-picker-auto` 在启动时检查 `webServer.host`。当核心绑定 `127.0.0.1`、非 SSH 启动且系统有桌面时，它判定为 `native`，调用 PC 的 macOS / Windows 原生目录选择器。
3. **安全接入代理让远程请求看起来像本机**：本插件让 DSH 核心保持 `127.0.0.1:3080`，由 `0.0.0.0:3081` 安全接入代理对外服务。手机通过 Tailscale 访问 3081 时，核心收到的仍是回环请求，auto 误判“操作者就坐在 PC 前”，于是把 native 窗口弹在 PC 上；手机端不会渲染这个系统窗口，只会等待。

**修复**：固定使用应用内 `browse` 目录选择器。编辑 `~/.dsh/profiles/web/cordis.patch.yml`（Windows：`%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`），在末尾追加：

```yaml
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

> **注意**：DSH 的 patch 层里 `name` 是校验已有插件名，不是重命名。不能只把 `directory-picker` 的 `name` 改成 browse，否则该 patch 会被跳过。必须先 `disabled: true`，再用无 id 的根层 `insert` 插入 browse 后端和浏览器端 UI。

保存后，启用了 HMR 的 DSH 通常会自动重载；否则完整重启 `dsh web`。手机端强制刷新页面后，点“选择文件夹”会出现应用内目录浏览器（面包屑、目录列表、新建子目录），手机和 PC 都会使用网页选择器。

**取舍**：这样 PC 本地也不再弹原生窗口。如果希望 PC 用 native、手机用 browse，需要单独建一个 remote profile 或自定义混合选择器；DSH 的 auto 不支持按客户端切换。browse 仍受现有 DSH / 插件鉴权保护，不会绕过认证。
</details>

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 协议开源。
