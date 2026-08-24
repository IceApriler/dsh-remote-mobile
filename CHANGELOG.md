# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] - 2026-08-24

### Security Hardening (安全加固)
- **回环 CSRF / drive-by 防御**：变更类插件 API（非 GET 的 `/api/remote-mobile/*`）在门禁层校验浏览器同源信号——`Origin` 与 Host 不一致、`Origin: null` 或 `Sec-Fetch-Site: cross-site` 的写请求直接返回 403。恶意网页无法再驱使已登录用户的浏览器（现代浏览器对跨站请求必携带 `Origin` / `Sec-Fetch-Site` 信号）向 `127.0.0.1` 发起免认证的跨站写操作（如开启局域网免密、清除密码、注销设备）。curl / 本机脚本等不带浏览器信号的客户端保持完全兼容；本机面板与手机端均为同源请求，行为不变。
- **回环上下文不再洗白**：Host / Origin / Sec-Fetch-Site 虚拟化改写仅作用于外部来源流量；本机回环 socket（127.0.0.1 / ::1）保留原始头，仅将 `localhost` / `[::1]` 变体归一化为 `127.0.0.1`；`socket.remoteAddress` 的统一虚拟化仍保留（仅对外部来源流量产生实际效果——真实回环请求本就是 `127.0.0.1`，该改写为 no-op）。此前对全部请求统一改写会顺带拆掉底层 WebServer 自带的 DNS-Rebinding 防护，恶意域名解析到 127.0.0.1 时可借道读写本机接口，现已恢复该防护对外部域名的效力（外部合法流量的虚拟化放行不受影响）。
- **SSE 事件流收紧**：移除 `/api/remote-mobile/events` 响应中的 `Access-Control-Allow-Origin: *`。前端 Bundle 与接口同源，无需 CORS 头；该头曾允许任意网页通过 EventSource 持续读取设备接入与安全告警事件流。
- **devices.json 权限收紧为 0o600**：会话持久化文件内含 365 天长效访问 Token（即完整凭证），落盘权限与 `rsa-keys.json` 对齐，仅当前用户可读写（已有旧文件会在下次写盘时自动修正）。

---

## [1.3.0] - 2026-08-23

### Mobile Style Snippets (移动端样式片段 / 样式小插件)
- **全新模块 `src/styles/style-snippets.ts`**：插件内部独立的「样式小插件」注册表，将 DSH 界面样式拆分为可独立启停的 CSS 片段。
- **按界面区域划分的三段内置预设**：`preset-sidebar` 侧边栏抽屉导航（折叠 0 宽度 + 可拖拽悬浮把手）、`preset-settings` 设置面板适配（弹窗居中微缩 + 遮罩锁滚动）、`preset-main` 对话正文**高密度排版**（小字号 12.5px + 紧凑行距 + 收紧边距，每行展示更多内容；字号规则基于稳定 HTML 元素与 CSS Modules localName 后缀，不做布局缩放——zoom 会挤压 1fr 网格轨道产生右侧空白甚至破版，已弃用），默认移动端启用、PC 关闭。
- **PC / 移动端分别启停**：每个片段（内置与自定义）均支持 `pcEnabled` / `mobileEnabled` 双开关，注入层按视口宽度档选择对应端生效（窄屏 ≤900px / 宽屏 >900px，详见下条）；存储升级为 v2（`presetStates` + 双端字段）并自动迁移 v1 旧数据。
- **内置预设状态分组齐全落盘**：`presetStates` 恒含 `preset-sidebar` / `preset-settings` / `preset-main` 三个分组，每组 `pc/mobile` 写当前有效值（用户覆盖 ?? 代码默认值），文件自包含、三组一目了然。
- **设置面板页签分组导航**：远程与移动端设置按「接入 / 设备与安全 / 样式覆写 / 本地数据」四个页签分组，消除长页面；全组保持挂载、仅 display 切换，切页不重置配对码/表单状态，页签选择 localStorage 记忆。
- **PC / 移动端开关改为按视口宽度生效（不再按设备 UA 过滤）**：`mobileEnabled` 的片段包 `@media (max-width: 900px)`（窄视口生效，**PC 浏览器拉小窗口同样生效**），`pcEnabled` 包 `@media (min-width: 901px)`（宽视口生效），两端都开则全宽度；内置预设 CSS 不再写死媒体查询外壳，由注入层按开关包装；修复了此前「只勾移动端时 PC 拉小屏幕不生效」的问题。
- **用户自定义片段**：支持在设置面板（设置 ⚙️ → 远程与移动端 → 🎨 移动端样式片段）或 API（`GET/POST /api/remote-mobile/styles` 等）中动态新增/编辑/删除/启停，持久化于 `~/.dsh/remote-mobile/style-snippets.json`，无需修改插件代码、无需重启。
- **按 UA 注入 + `data-dsh-mobile` 标记**：网关响应层按 User-Agent 判定移动端，向主工作区 index.html 与 /auth 登录页注入 `<style id="dsh-remote-mobile-style-snippets">`，并给 `<html>` 打上 `data-dsh-mobile` 属性作为稳定作用域选择器钩子；桌面端启用片段时同样按需注入（建议片段不依赖 `data-dsh-mobile` 作用域）。
- **悬浮把手拖拽脚本（全端注入 + 折叠状态自守卫）**：`dsh-draggable-nav` 支持拖动侧边栏展开把手并记忆位置，配合 `preset-sidebar` 使用；脚本对所有请求注入，运行时仅在侧边栏处于折叠状态时生效（桌面端未折叠时不工作，PC 窄窗口拉出折叠侧边栏时同样可拖动）。
- **存储卡片展示真实跨平台绝对路径**：设置面板「本地数据与密钥持久化存储说明」中的三个文件路径（devices.json / rsa-keys.json / style-snippets.json）改由 `/api/remote-mobile/status` 动态下发（服务端用 `join(homedir(), ...)` 跨平台拼接），不再硬编码 `~/.dsh/...` 形式。
- **构建脚本健壮性**：`scripts/build-client.js` 自动同步到 DSH 运行目录失败时仅告警不再中断构建。
- **修复：`beforeExit` 兜底落盘真正生效**：`StyleSnippetStore` 构造函数补充 `activeStores.add(this)`（与 `SessionStore` 保持一致），此前文件末尾的遍历集合恒为空（死代码）。
- **修复：样式路由双注册冲突**：`/api/remote-mobile/styles` 收敛为「单 path 内按 method 分发」，规避 webserver 精确路由同 path 重复注册冲突。
- **修复：自定义片段 id 冲突**：拒绝使用内置预设 id / `preset-` 保留前缀作为自定义片段 id，避免列表、启停与删除语义歧义。
- **修复：内置预设名称本地化**：`GET /api/remote-mobile/styles` 按请求语言返回预设名称/描述，英文界面不再显示中文。
- **加固：`Content-Length` 防截断守卫**：注入 `<style>`/Polyfill 改写响应体后、且响应头尚未发出时移除显式 `Content-Length`，交由 Node 按最终 body 重新计算，规避 `ERR_CONTENT_LENGTH_MISMATCH` 截断风险（`writeHead` 已发出头部属不可挽救场景）。
- **加固：`</style` 转义**：`buildMobileStyleTag` 将片段中的 `</style` 转义为 `</style` 的反斜杠形式（`<\/style`），防止用户 CSS 意外/恶意提前闭合 `<style>` 标签（与 dsh-host-webserver 对 `IndexInjection` `'style'` 行「text 不得包含 `</style`」的约束一致）。

---

## [1.2.1] - 2026-08-23

### Documentation & UI Polish (文档与界面微调)
- **名称规范化**：全项目与 npm 包元数据统一将 DSH 全称规范为 **DeepSeek Harness**。
- **配置说明优化**：完善 README 中关于禁用内置远程插件的注释说明（防止功能冲突）。
- **设置界面精简**：控制台设置页 GitHub 仓库徽标文字精简为 `dsh-remote-mobile`。

---

## [1.2.0] - 2026-08-22

### Security & Cryptography (安全与加密)
- **Web Crypto 原生 OAEP 与 CSPRNG 增强**：手机登录页在现代浏览器/安全上下文中优先使用原生 `window.crypto.subtle.encrypt({ name: 'RSA-OAEP' })` 进行 2048 位 RSA 加密；回退纯 JS 垫片中使用 `crypto.getRandomValues()` 进行密码学安全随机填充。
- **URL Token 验证行为安全收敛**：移除从 URL `?token=xxx` 自动发起 `verify` 的逻辑，改为仅回填输入框，杜绝社工链接消耗受害者失败配额的间接 DoS 风险。
- **智能静态扩展名放行机制**：收敛 `/plugins/` 门禁放行规则为合法前端静态扩展名白名单（`.js`, `.css`, `.png`, `.svg`, `.woff2`, `.map` 等 20+ 种），彻底堵死未授权调用第三方插件后台动态 API 的漏洞，对用户零负担、免手动维护。

### Robustness & Performance (健壮性与性能)
- **写盘分级与 Debounce 防抖**：拆分写盘策略，高频访问记录（`recordAuthVisit`、活跃时间戳更新）引入 500ms 防抖合并；关键路径（配对成功、密码认证、撤销、改密）保持同步即时写盘；配套 `beforeExit` 广播与 `flushPersistedData` 保证进程退出不丢数据。
- **配置一致性与反向覆盖防御**：`loadPersistedData` 完全移除对历史 `devices.json` 中 `data.config` 的读取，确保 `~/.dsh/settings.yaml` 为唯一配置权威来源，杜绝重启时的配置回滚。
- **YAML 原子性持久化**：`writeBackToSettingsYaml` 引入临时文件原子替换（`renameSync`），防止异常中断导致 `settings.yaml` 文件半写损坏。
- **RSA 密钥按需懒加载**：移除模块顶层同步生成密钥逻辑，改为在首次调用时懒加载单例，消除启动阻塞。
- **SSE 幂等注销与双向 Close 监听**：优化服务端 SSE 事件通道，同时监听 `req.on('close')` 与 `res.on('close')`，引入 `cleanup()` 幂等保护，杜绝监听器与定时器泄漏。

### Testing & Code Hygiene (测试与代码清理)
- **测试覆盖率提升**：新增 5 项边缘场景测试用例（含设备撤销审计归因回退、URL Token 提取、data.config 忽略防覆盖、高频写盘防抖、SSE 幂等断连清理），全套测试扩展至 66 项并全部通过。
- **冗余代码清理**：移除已废弃未引用的 `src/types/auth.ts`。

---

## [1.1.0] - 2026-08-22
- 初始稳定版发布：Tailscale & LAN 免密直连、RSA 端到端加密、6 位动态配对码、加盐哈希密码存储、IP 5次防暴破锁定与 SSE 实时事件推送。
