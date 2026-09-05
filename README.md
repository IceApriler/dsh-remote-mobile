<div align="center">

# dsh-remote-mobile

**DeepSeek Harness (DSH) 远程与移动端安全网关插件**

[![npm version](https://img.shields.io/npm/v/dsh-remote-mobile.svg?style=flat-square&color=3b82f6)](https://www.npmjs.com/package/dsh-remote-mobile)
[![npm downloads](https://img.shields.io/npm/dm/dsh-remote-mobile.svg?style=flat-square&color=22c55e)](https://www.npmjs.com/package/dsh-remote-mobile)
[![node](https://img.shields.io/badge/node-%3E%3D18.0.0-8b5cf6?style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/dsh-remote-mobile.svg?style=flat-square&color=10b981)](https://github.com/IceApriler/dsh-remote-mobile/blob/master/LICENSE)

<p align="center">
  <b>零改动底层代码 · 突破本地限制 · 扫码直连 · 工作区全功能复用 · 传输层加密</b>
</p>

[English Documentation](./README_EN.md) · [简体中文](./README.md)

<p align="center">
  <a href="#about">这是什么</a> •
  <a href="#advantages">核心优势</a> •
  <a href="#quick-start">快速开始</a> •
  <a href="#config">必备配置</a> •
  <a href="#preview">界面预览</a> •
  <a href="#features">功能特性</a> •
  <a href="#install">安装与更新</a> •
  <a href="#faq">常见问题</a>
</p>

---

</div>

<span id="about"></span>
## 📖 这是什么

`dsh-remote-mobile` 是专为 **DeepSeek Harness (DSH)** 深度定制的远程与移动端安全治理插件。

DSH 核心服务出于安全考虑默认仅监听本地回环地址（`127.0.0.1`），手机、平板或其他电脑无法从外部访问 Web 控制台。本项目通过**访问控制中间件**与**请求隔离技术**，安全地开放了 **Tailscale 虚拟私网** 以及 **本地局域网 (Wi-Fi/LAN)** 访问能力，并提供传输加密、扫码配对、长期密码认证与防暴力破解审计体系。

手机端访问时，插件还针对 DSH 界面做了**移动端样式适配**：侧边栏抽屉折叠与可拖拽展开把手、设置弹窗居中微缩、对话正文高密度排版等，让手机上的使用体验更贴近桌面端。

---

<span id="advantages"></span>
## ⚡ 核心优势

* 🚀 **突破网络壁垒，工作区全功能复用**：解决局域网和 Tailscale 无法访问 DSH Web 的问题。在移动端或外部设备访问时，**支持新建工作区、切换工作区、执行终端命令等桌面端核心功能**。
* 📱 **手机端专属适配与同源复用**：直接复用 DSH Web 官方同源底座与生态插件（如 `dsh-pet` 宠物、任务看板等），无需单独维护手机端后台。插件已针对移动端做好了基础响应式适配（如侧边栏抽屉折叠、设置弹窗居中、对话正文字号与行距精细调小以提升一屏信息量），并内置**样式片段覆写功能**，支持开箱即用或按需注入自定义 CSS 样式小插件。
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
> **生态插件安装建议**：**不建议安装 `@linxin666/dsh-web-all` 全家桶**，更推荐**按需安装单体功能插件**。全家桶将多个前端模块合并打包，可能引发移动端悬浮入口重复与手势交互冲突。如需任务看板、宠物等生态功能，建议直接安装对应的单体包（详见下方说明）。

---

<span id="config"></span>
### 2. 前置配置（开放外部监听）

由于 DSH 默认仅监听 `127.0.0.1`，为了使 Tailscale 私网或局域网设备能够正常连通，请确保在 `~/.dsh/profiles/web/cordis.patch.yml`（Windows 对应 `C:\Users\<用户名>\.dsh\profiles\web\cordis.patch.yml` 或在资源管理器直接输入 `%USERPROFILE%\.dsh`）中包含以下配置：

```yaml
# 1. 允许 webserver 监听外部网络连接（必选）
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: '0.0.0.0'
    port: 3080

# 2. （推荐）只保留一款远程/Web 接入类插件，避免功能重复与入口混乱
#    本插件与其他远程接入类插件共存时也能正常启动：检测到配对共享服务被占用
#    会自动让出，并在设置页顶部展示警示横幅说明详情。
#    示例：禁用 @linxin666/dsh-web-ui-all 内置的远程插件
- id: web-ui-remote-web-ui
  disabled: true
```

> **💡 说明**：插件自身注册已由 DSH Bundle 体系全自动处理，**无需**在 `cordis.patch.yml` 中额外添加 `id: remote-mobile`。Windows 用户可按 `Win + R` 键输入 `%USERPROFILE%\.dsh\profiles\web` 快速直达配置目录。

> [!WARNING]
> **⚠️ 插件兼容与共存说明：不建议安装聚合全家桶（`@linxin666/dsh-web-all`），更推荐「按需单独安装所需插件」**
> 
> * **为什么不建议安装 `@linxin666/dsh-web-all` 全家桶？**
>   1. **避免功能冲突与重复入口**：该全家桶将多个子插件的前端逻辑编译打包在同一个 `client.js` 中，其移动端自适应逻辑在模块加载时会自执行。即使在 `cordis.patch.yml` 中配置了 `web-ui-remote-web-ui: disabled: true`，浏览器加载脚本后依然会渲染出小鲸鱼悬浮按钮（`#dshRemoteWhale`），导致两个插件的移动端入口与手势交互出现重复和冲突。
>   2. **体积更轻量、升级更解耦**：全家桶将多个功能捆绑在一起，按需安装单体插件可以保持环境精简，也便于未来各插件独立升级与维护。
> 
> * **推荐的最佳实践（按需单独安装单体插件）**：
>   建议按需安装各自独立的功能单体包，例如：
>   ```bash
>   # 推荐方式：需要哪个装哪个，职责清晰、互不干扰
>   dsh plugin --profile web add @linxin666/dsh-client-ui-task-board
>   dsh plugin --profile web add @linxin666/dsh-client-ui-web-ui-settings
>   dsh plugin --profile web add @linxin666/dsh-pet
>   dsh plugin --profile web add @linxin666/dsh-ssh
>   ```
>   *(注：自 v1.6.0 起，`dsh-remote-mobile` 已内置冲突防护机制，会自动前置注入 `dsh-remote-force-desktop` 并协同 CSS 避免小鲸鱼悬浮按钮 `#dshRemoteWhale` 重复挂载，保障已安装全家桶环境下的共存体验；若追求更清爽的环境，按需安装单体包依然是最佳实践)*。

---

### 3. 启动并使用

```bash
dsh web --no-open
```

启动后，在电脑浏览器打开 DSH Web 控制台，进入 **设置 ⚙️ -> 远程与移动端**，使用手机微信或系统相机扫描二维码即可立即开启移动端接入！

> 设置面板按 **「接入 / 设备与安全 / 样式覆写 / 本地数据」** 四个页签分组显示，避免长页面；页签选择会被记住，切换不重置配对码等状态。

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

### 手机端实机演示（同源免登与工作区全功能）

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
- **传输层 RSA 非对称加密**：登录认证接口支持客户端 RSA 加密。在 HTTPS 等安全上下文下优先使用 Web Crypto 原生 `RSA-OAEP-SHA256`；在 DSH 默认的 HTTP 局域网/Tailscale 访问（非安全上下文）下回退至纯 JS 垫片，并使用 `crypto.getRandomValues()` 进行密码学安全随机数填充。敏感密码与配对码在客户端加密后再通过网络传输。
- **scrypt 慢哈希存储**：服务端采用 `scrypt` 加盐慢哈希算法（`scrypt:${salt}:${hash}`）对密码进行落盘存储，比对过程采用 `crypto.timingSafeEqual` 恒定时间比较以防范时序侧信道攻击。
- **防暴力破解与限频保护**：
  - 连续输错凭证达到阈值（默认 5 次）自动锁定该 IP 15 分钟，拦截后续验证请求并返回 HTTP 429；
  - 滑动窗口限频（默认 60 次/分钟），防范高频恶意刷量探测；
  - 访问审计与锁定状态持久化落盘，服务重启后自动恢复；
  - 支持管理员在管理面板中一键解锁指定 IP。
- **智能静态资源放行机制**：安全门禁内置智能前端静态扩展名识别（放行 `.js`、`.css`、`.png`、`.svg`、`.woff2` 等 20+ 种合法资源），彻底拦截无扩展名或动态管理 API 请求（如 `/plugins/xxx/admin`），确保第三方生态插件前端正常展示的同时严密保护后台动态接口，无需用户在设置界面手动维护白名单。
- **高可靠原子持久化与防抖**：采用毫秒级写盘防抖节流保护磁盘 I/O（会话数据 500ms、样式片段 300ms），配合 `beforeExit` 进程退出 Flush 保证数据不丢失；`settings.yaml` 与 `style-snippets.json` 采用临时文件原子替换（`renameSync`），防止异常中断损坏数据。
- **真实 IP 安全提取**：仅信任底层 Socket 真实连接地址，防范伪造的 `X-Forwarded-For` 欺骗攻击。
- **本机回环 CSRF 防御**：插件的变更类 API 会校验浏览器同源信号（`Origin` / `Sec-Fetch-Site`），恶意网页驱使浏览器向 `127.0.0.1` 发起的跨站写请求将被直接拒绝；curl / 本机脚本等无浏览器信号的客户端不受影响。
- **回环上下文不洗白**：上下文虚拟化仅作用于外部来源流量；本机回环请求保留原始 Host / Origin，使 DSH 底层自带的 DNS-Rebinding 与同源校验对外部域名继续生效。SSE 事件流仅限同源连接，不开放跨域读取。

### 4. 实时状态同步与国际化
- **SSE 实时事件推送**：基于 Server-Sent Events 实现新设备接入、设备重连、会话撤销及安全告警的实时通知，内置连接双向关闭监听与幂等清理。
- **全界面中英文双语自适应**：根据 DSH 全局语言偏好与浏览器环境，动态自适应中英文面板、提示及手机端界面。
- **非 HTTPS 兼容补丁**：自动注入 `crypto.randomUUID` 与 `navigator.clipboard` Polyfill，解决移动端浏览器在 HTTP 非安全上下文下缺少原生 API 的报错（`clipboard` polyfill 保证非安全上下文下复制/样式复制功能正常）。

### 5. 移动端样式片段（样式小插件）

DSH Web 界面在手机上仍有不少沿袭桌面端的样式问题，插件内置「移动端样式片段」模块，把移动端适配拆分为可独立启停的 CSS 片段：

- **按界面区域划分的三段内置预设**：`preset-sidebar` 侧边栏抽屉导航（折叠 0 宽度、可拖拽悬浮把手、自适应抽屉宽度与 44px 触控友好区）、`preset-settings` 设置面板适配（上下堆叠自适应、顶部导航横滑、内容纵向自然滚览）、`preset-main` 对话正文**高密度排版**（小字号 12.5px + 紧凑行距 + 收紧边距 → 每行展示更多内容；基于稳定 HTML 元素与 localName 后缀，不做布局缩放，无右侧留白），默认移动端启用、PC 关闭；
- **PC / 移动端分别启停（按视口宽度判定，与设备无关）**：每段预设和每个自定义片段都有独立的「🖥️ PC」「📱 移动端」两个开关；「移动端」= 窄视口（≤900px）生效——**PC 浏览器拉小窗口也会生效**，「PC」= 宽视口（>900px）生效，两端都开 = 全宽度生效；
- **用户自定义（样式小插件）**：在 **设置 ⚙️ → 远程与移动端 → 🎨 移动端样式片段** 中粘贴自己的 CSS 即可新增片段，支持编辑/启停/删除/**一键复制**（每个片段「查看 CSS」旁都有「📋 复制样式」按钮），持久化于 `~/.dsh/remote-mobile/style-snippets.json`，保存后下一次页面加载即生效，无需重启；
- **按 UA 打标记 + 按宽度生效**：样式按视口宽度档生效（见上），与设备 UA 无关；移动端 UA 请求额外给 `<html>` 打上 `data-dsh-mobile="1"` 标记作为作用域钩子，并注入可拖拽的展开把手脚本（全端注入，运行时仅在侧边栏折叠时生效）。

### 6. 插件通用共存保护

- **启动零冲突**：`remoteWebUiPairing` 配对共享服务被其他远程/Web 接入类插件占用时，本插件自动让出（延迟裁决：等待激活窗口结束后检测服务名归属），彻底避免服务重名导致的整树回滚致命崩溃——从插件市场安装后可直接启动，无需任何手动配置；
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

## ⚙️ 高级配置

插件已完全接入 DSH 官方 Settings 体系，配置项支持在 Web 界面中直观调整，也可在 `~/.dsh/settings.yaml` 的 `dsh-remote-mobile` 命名空间下手动修改：

```yaml
dsh-remote-mobile:
  allowTailscale: false       # boolean，默认 false：是否允许 Tailscale 虚拟私网免密访问
  allowLan: false             # boolean，默认 false：是否允许局域网免密访问（高危警示）
  secretHash: ""              # string，默认空：长期访问密码的 scrypt 加盐哈希值
  maxVisitsPerMinute: 60      # number，默认 60：单 IP 每分钟最大访问登录页次数
  maxFailedAttempts: 5        # number，默认 5：触发封禁的连续认证失败最大次数
  lockDurationMs: 900000      # number，默认 900000 (15分钟)：IP 锁定持续时间（毫秒）
```

### 🎨 移动端样式片段（可选）

自定义样式片段（样式小插件）与启停状态持久化于 `~/.dsh/remote-mobile/style-snippets.json`，可在设置面板图形化管理，也可直接编辑该文件：

```json
{
  "version": 2,
  "presetStates": {
    "preset-sidebar": { "pc": false, "mobile": true },
    "preset-settings": { "pc": false, "mobile": true },
    "preset-main": { "pc": true, "mobile": true }
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

## 📂 本地文件存储位置

> **💡 路径提示**：在 macOS / Linux 下根目录为 `~/.dsh/`；在 Windows 下对应为 `C:\Users\<你的用户名>\.dsh\`（可在文件资源管理器地址栏直接输入 `%USERPROFILE%\.dsh` 直达）。

| 文件路径 | 说明 | 安全级别 |
|---|---|---|
| `~/.dsh/settings.yaml` | 全局安全策略与免密开关配置 | 用户级读写 |
| `~/.dsh/remote-mobile/devices.json` | 已授权设备会话、IP 访问计数与安全审计数据（内含长效 Token，权限 `0o600`） | 本地落盘，仅当前用户可读写 |
| `~/.dsh/remote-mobile/rsa-keys.json` | 服务端 RSA 密钥对文件（含公钥与私钥） | 本地落盘，权限 `0o600`（仅当前用户可读写） |
| `~/.dsh/remote-mobile/style-snippets.json` | 移动端样式片段（内置预设启停状态 + 用户自定义 CSS 小插件） | 本地落盘持久化 |

---

<span id="faq"></span>
## ❓ 常见问题 (FAQ)

<details>
<summary><b>Q0: 启动报错 <code>listen EADDRINUSE: address already in use 0.0.0.0:3080</code>？</b></summary>

**答**：这是 **3080 端口被其他进程占用**（绝大多数是上一个 `dsh web` 实例尚未完全退出，例如桌面快捷方式拉起的隐藏实例、或重启时新旧进程交叠），**与安装了哪个插件无关**。排查步骤：

1. **查找占用端口的进程**：
   * **macOS / Linux**：`lsof -nP -iTCP:3080`
   * **Windows**：`netstat -ano | findstr 3080`（最后一列为 PID）
2. **结束旧实例**：
   * **macOS / Linux**：`kill <PID>`
   * **Windows**：`taskkill /F /PID <PID>`（或在任务管理器中结束对应 Node 进程）
3. 重新启动 `dsh web` 即可。
4. **注意**：桌面快捷方式（dsh-desktop-launcher 生成的后台实例）与终端手动启动的实例不能同时运行。

另：若日志显示的是 `service "remoteWebUiPairing" has been registered` 类错误，请升级本插件至最新版本——新版已内置通用共存保护，与其他远程接入类插件并存时可正常启动并自动让出服务，并在设置面板顶部提示冲突详情。
</details>

<details>
<summary><b>Q1: 手机扫码后提示「连接被拒绝」或无法打开页面？</b></summary>

**答**：请按以下步骤逐一排查：
1. **配置检查**：确保电脑上的 `cordis.patch.yml` 中已配置 `host: '0.0.0.0'`，且 DSH 已经重启；
2. **同一局域网**：局域网访问时，确保手机与电脑连接在同一个 Wi-Fi / 路由器下，且未开启手机端的独立代理/VPN（避免流量绕过局域网）；
3. **Windows 防火墙排查（Windows 用户常见原因）**：
   * 启动 DSH 时如弹出「Windows Defender 防火墙」警报，请务必勾选 **「专用网络」** 和 **「公用网络」** 并允许访问；
   * 若错过弹窗或依然无法连通，可使用**管理员权限打开 PowerShell** 执行以下命令一键放行端口：
     ```powershell
     New-NetFirewallRule -DisplayName "DSH Web 3080" -Direction Inbound -LocalPort 3080 -Protocol TCP -Action Allow
     ```
   * **检查 Wi-Fi 网络类型**：在 Windows「设置 -> 网络和 Internet -> Wi-Fi」中，确保当前 Wi-Fi 网络配置文件类型已设为 **「专用网络」**（若为「公用网络」，Windows 防火墙会默认拦截局域网入站请求）；
4. **多网卡环境（WSL / 虚拟机）**：Windows 如安装了 WSL2 或 Hyper-V，可能会生成虚拟网卡 IP（如 `172.x.x.x`）。请在插件设置面板中确认使用的是物理无线网卡（WLAN / Wi-Fi）对应的局域网 IP 或 Tailscale 二维码。
</details>

<details>
<summary><b>Q2: Tailscale 免密直连和局域网免密有什么区别？</b></summary>

**答**：
* **Tailscale 免密**：高度安全。因为 Tailscale 是基于 WireGuard 的传输加密虚拟私网，只有你自己登录了同一账号的设备才能连通。
* **局域网免密**：存在安全隐患。任何连入你家 Wi-Fi 的设备（包括访客或蹭网设备）均可直接控制你的工作区，因此非完全可信环境**切勿开启**。
</details>

<details>
<summary><b>Q3: 手机端切换或新建工作区能正常使用吗？</b></summary>

**答**：**支持**。本插件通过请求隔离技术，使手机端与 PC 桌面端拥有一致的工作区管理与执行能力。
</details>

<details>
<summary><b>Q4: 手机端样式还是不满意，想完全自己定制？</b></summary>

**答**：打开 **设置 ⚙️ → 远程与移动端 → 🎨 移动端样式片段**，先尝试启停三段内置预设（侧边栏 / 设置面板 / 正文，每段都有独立的 PC 与移动端开关）；还不够就在「自定义片段」里粘贴自己的 CSS（例如 `html[data-dsh-mobile] .xxx { ... }`）。保存后手机端刷新页面立即可见，改动全部落在 `~/.dsh/remote-mobile/style-snippets.json`，升级插件不会丢失。
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
2. **轻量可控与独立升级**：按需单独安装所需插件（例如只需任务看板和宠物时，仅安装 `@linxin666/dsh-client-ui-task-board` 与 `@linxin666/dsh-pet`），既能保证环境轻盈，也便于各个插件独立升级、回滚与维护，避免依赖绑定。
*(注：自 v1.6.0 起，`dsh-remote-mobile` 已内置无缝兼容处理，通过前置参数与 CSS 协同规避 `#dshRemoteWhale` 重复挂载，保障已安装全家桶环境下的正常使用；若追求更简洁稳定的开发与运行环境，按需安装单体包仍是最佳实践)*。
</details>

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 协议开源。
