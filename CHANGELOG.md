# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-09-06

### Mobile UX (解决 Issue #5 · 移动端体验全面重构与极窄屏排版加固)
- **解决 Issue #5：设置面板移动端改上下堆叠（preset-settings）**：针对窄屏下设置弹窗左右并排导致右侧文字被挤压成单字一列的痛点，彻底重构布局。通过 `[role="dialog"]:has(nav)` 精准定位带导航弹窗，取消 `530px` 定宽与 `zoom: 0.88` 微缩；导航栏置顶横排并支持横向滑动手势，内容区 100% 铺满并恢复纵向自然滚动，移除横滑提示；常规通用 Modal 不受任何影响。
- **解决 Issue #5：侧边栏抽屉自适应宽度与触控区友好化（preset-sidebar）**：
  - 展开态抽屉宽度改为自适应 `width: min(85vw, 320px)`，告别 360px 窄屏或大屏手机沿用官方 280px 定宽的死板体验；
  - 条目行高增大到 `min-height: 44px`、次级操作按钮增大到 `min-width/height: 36px`，符合移动端人机交互规范，大幅降低误触；
  - **工作区与会话右侧操作按钮（更多操作 ⋯、新建会话 + 等）移动端常显**：彻底解决 PC 鼠标 hover 依赖在触屏上无法唤出操作按钮的痛点，结合标题容器自适应省略号截断防挤压；
  - **精准区分会话选中与操作点击（闭环 Issue #5 抽屉收起取舍）**：点击会话条目（`_sessionRow`）主体直接程序化收起抽屉丝滑回到主聊天区；而点击条目操作按钮（`_rowActions` / `⋯` / `+`）或点击工作区行（`_projectRow` 展开/折叠）继续被防误收起守卫保护，抽屉保持展开；
  - 折叠展开悬浮把手放大至 `44px`（圆角 12px），并通过 `top: max(12px, env(safe-area-inset-top))` 智能避让 iPhone 刘海屏、灵动岛与系统状态栏。
- **极窄屏弹窗与内边距紧凑化（解决 Issue #5 窄屏挤压）**：
  - 设置弹窗宽度由 `94vw` 提升至 `96vw`，圆角微调至 `14px`，消除手机屏幕两侧过宽的无用灰边；收紧官方 `[role="dialog"] [class*="_content"]` 默认过厚（24px~32px）的内边距为 `10px 4px`，为内部卡片释放出 35px 以上的宝贵横向宽度；
  - 将所有设置卡片（`DeviceListCard`、`NetworkCard`、`SecurityCard`、`SecretCard`、`ConfigCard`、`StylesCard`、`QrPairingCard`、`StorageCard`）的基础内边距由原本过宽的 `18px 20px` 统一调整为紧凑舒适的 `14px 14px`。
- **Tab 导航栏防文字折断与横滑支持（MainSection）**：给顶部页签按钮增加 `whiteSpace: nowrap` 与 `flexShrink: 0`，配合隐藏滚动条的弹性横向滑动（`overflow-x: auto`），彻底消除窄屏下“设备与安全”、“样式覆写”、“本地数据”等页签文字被挤压拆成两截的现象。
- **操作按钮防竖排挤压变形（SecurityCard 等）**：
  - 修复安全审计卡片中「🗑️ 清空审计日志」等按钮因左侧标题不可压缩而缺少换行保护，导致文字被挤压成每行两字竖排的狭长细框的问题；全面为操作按钮配置 `whiteSpace: nowrap`、`flexShrink: 0` 与 `marginLeft: auto`；
  - 容器统一重构为自适应 `flexWrap: wrap` 流式排版，宽屏下自然并排，窄屏下平滑换行靠右展示，按钮文字永远保持单行水平胶囊样式；
  - 优化设备卡片（`DeviceListCard`）头部布局，说明文字通栏独立展示，不再与「一键注销」按钮争抢水平宽度。
- **设置页样式片段列表移动端响应式折行**：修复窄屏下操作按钮组与双端开关在同一行溢出卡片右边界的问题，移除强制不收缩限制，支持开关组与按钮组弹性自适应换行。
- **网络接入卡片移动端响应式流式排版（NetworkCard）**：修复窄屏下 Tailscale 与本地局域网（LAN）接入项的「标题/状态」与「免密直连开关」并排挤压导致图标与文字撕裂拆行的问题。重构为结构化自适应流：标题与状态徽标通栏舒展展示，免密开关在窄屏自适应换行靠右；访问链接与复制按钮收纳为底色胶囊输入条，彻底消除移动端排版错乱。


### Stability & Lifecycle (生命周期与启动稳定性加固)
- **修复：底座 Patch 重载时的 inactive context 异常崩溃**。底座加载 `cordis.patch.yml`（如覆盖 `webserver` 监听 `0.0.0.0`）会触发服务重启与旧插件上下文注销（dispose）；原就绪横幅延时函数在已注销的 context 下通过原生定时器触发并访问 `ctx.webServer`，触发 Cordis 容器断言抛出 `cannot get required service "webServer" in inactive context` 导致进程退出。现引入闭包 `disposed` 状态标志、监听 `ctx.on('dispose')` 自动清理定时器，并对服务访问与异步回调执行全流程异常隔离兜底，彻底保证各种极端重载与时序下的平稳运行。
- **修复：消除 Cordis 特权属性访问隔离拦截**。移除直接对未注入特权属性（如 `ctx.scope`、`ctx.setTimeout`）的读取，规避 Cordis 严格隔离模式下的 `cannot get property "timer"/"scope" without inject` 报错。

### Compatibility (生态插件兼容与冲突防护)
- **新增：小鲸鱼悬浮按钮 (#dshRemoteWhale) 冲突防护**。针对第三方生态插件聚合打包时前端自适应逻辑在模块加载时自执行、容易与本插件产生移动端悬浮入口重复与手势交互冲突的问题：
  - 新增 `FORCE_DESKTOP_SUPPRESSION_SNIPPET`，在 HTML `<head>` 最前置注入 `sessionStorage.setItem('dsh-remote-force-desktop', '1')`，触发其内置的桌面模式逻辑，平滑避免其移动端 DOM 重复挂载；
  - 内置预设样式（`preset-sidebar`）补充 `#dshRemoteWhale` 与 `[data-dsh-plugin="remote-web-ui"]` 隐藏（`display: none !important`）规则，提供双重共存保障。
- **完善：文档新增单体插件安装指引**。说明聚合包打包机制对前端配置生效的影响，推荐按需单独安装单体功能插件，保持环境轻量清晰、互不干扰。

---

## [1.5.0] - 2026-09-04

### Compatibility (适配 dsh@0.1.2-rc.1 官方 Token 鉴权)
- **适配：透明接管官方底座临时 Token 鉴权，消除双重鉴权冗余**。DSH 0.1.2-rc.1 官方底座引入了进程级临时启动 Token（`?token=xxxx`）与全链路 RPC/WebSocket 401 阻断；装有本插件的用户在进程重启后，手机已配对的直连书签会遭遇官方 401 报错。现通过对底座 `connection` 服务（`authorizeIndex`、`requestRejection`、`browserAuth.isAuthenticated`）实施切面代理：凡通过本插件门禁（本机回环、Tailscale/LAN 免密直连、已扫码配对/长期密码认证）的请求直接放行，无需手动复制官方临时 Token，手机书签直连与局域网免密恢复丝滑体验；同时兼容保留官方原生合法 token 的换取逻辑。
- **优化：终端就绪输出专属卡片**。服务启动后在控制台打印美观的边框横幅，明确标注「官方临时 Token 鉴权已接管，PC/移动端访问无需携带官方token」，按类型列出本机回环、局域网、Tailscale 私网等可用直连地址，并附带设置页配置指引与项目文档链接。
- **优化：URL Token 提取解耦**。`extractTokenFromRequest` 优化参数提取，支持 `rm_token` 与 `auth_token`，避免官方 `token=` 干扰插件内部会话逻辑。

---

## [1.4.3] - 2026-09-03

### Fixed (缺陷修复)
- **修复：样式覆写启用后提问弹窗被全屏黑纱遮罩盖住且宽度被强制撑满**。`preset-sidebar` 的 `[class*="_frame"]` 选择器用后缀匹配，同时命中三栏布局帧（`pI_x6G_frame`）与提问卡片（`Mbwy4a_frame`，其 class 名同样含 `_frame`）。提问卡片没有 `data-sidebar-collapsed` 属性，被 `:not(...)::after` 规则叠加了 `position:fixed; inset:0; z-index:899; background:rgb(0 0 0/24%)` 的全屏黑纱（表现为弹窗上面多了一层遮罩），同时被 `width:100vw !important` 强制撑满、覆盖了自身 `max-width:var(--dsh-chat-content-width)` 导致不自适应宽度。现用 `:has([class*="_sidebarCol"])` 把 `_frame` 相关规则精确锁定到三栏布局帧，提问卡片不再被误伤。
- **修复：提问弹窗左右边距过宽、选项字号偏大**。`preset-main` 新增提问卡片适配（以官方稳定属性 `data-question-key` 为锚点）：左右内边距收窄到 `8px`（官方为 `calc(composer-side-clearance + 16px)`），选项标题字号 14px→13px、说明 14px→12.5px，行高同步收敛，标题微调 16px→15px，与对话正文紧凑排版保持一致。
- **修复：移动端侧边栏点击项目名称后抽屉被自动收起**。生态插件「点条目自动收回抽屉」增强会把条目内所有点击一律视为选中、下一帧程序化收起抽屉，导致选中高亮刚浮现，展开/收起箭头与新增/更多操作图标来不及操作抽屉就被关掉。现把防误收起守卫的记录范围从「条目内次级控件（按钮/箭头）」扩展到「条目任意部位（含项目名称主体）」，900ms 窗口内的程序化收起调用被吞掉，抽屉保持展开；真实点击收起按钮与点抽屉外暗处收起的官方行为不受影响。

---

## [1.4.2] - 2026-08-26

### Features (新功能)
- **新版本更新提醒**：设置面板打开时从 npm registry 拉取 `dsh-remote-mobile` 最新版本号，与当前安装版本做语义化版本比较；**仅当检测到新版本**时，在标题版本号旁显示一个小巧的红色提醒「🚀 发现新版本 vX.Y.Z」，点击直达 npm 对应发布页。拉取失败（离线 / 网络异常）或已是最新版本时完全不显示，不干扰界面，也无需前端轮询。

### Docs (文档)
- **README「这是什么」章节补充手机端样式适配说明**：说明插件针对 DSH 界面做的移动端样式适配（侧边栏抽屉折叠与可拖拽展开把手、设置弹窗居中微缩、对话正文高密度排版等）。

---

## [1.4.1] - 2026-08-26

### Features (新功能)
- **样式片段一键复制**：样式覆写页每个片段（内置预设与自定义小插件）在「查看 CSS」旁新增 **「📋 复制样式」** 按钮，点击即将该片段 CSS 完整复制到剪贴板并给出 toast 反馈，无需手动框选整段样式。
- **非安全上下文 Clipboard Polyfill**：HTTP + 外部 IP（Tailscale / 局域网）等非安全上下文下 `navigator.clipboard` 为 `undefined`，官方 bundle 直接调用 `writeText` 会抛 `Cannot read properties of undefined` 崩溃；现全端注入 polyfill（位于 `<head>` 最前、先于官方 bundle 生效），提供 `execCommand('copy')` 降级实现，原生可用时不替换，顺带保障上一条复制按钮与非安全环境下的复制功能可用。

### Fixed (缺陷修复)
- **修复：设置弹窗整窗缩放未覆盖导航按钮列**。`preset-settings` 等比微缩由覆盖单个卡片改为覆盖 `dialog` 全部直接子元素（`> *`），左侧 nav 按钮列表不再漏缩放；右侧内容保持 530px 最小宽度。
- **修复：插件市场弹窗窄屏隐藏左侧导航**。重置官方 `@media(max-width:560px)` 下隐藏左侧 nav 的行为（同选择器 + `!important` 稳压），导航保持可见。
- **修复：设置弹窗覆写误伤通用 Modal**。`preset-settings` 卡片/内部容器选择器改为限定在 overlay 上下文内（`:has` 限定），内测声明等直接挂 body、无 `data-slot` overlay 的通用 Modal 不再被 530px/zoom 覆写。
- **修复：composer 工具栏在窄屏过宽**。`preset-main` 工具栏紧凑化：gap/内边距缩小、发送按钮 30px、图标 12px、trigger 文字 12px，保持两行布局；命令按钮保持 26px 正方形、trigger 高度还原官方 28px。
- **修复：移动端侧边栏抽屉依赖生态插件选择器**。`preset-sidebar` 选择器全部改用官方稳定 class（`_frame` / `_sidebarCol` / `_centerCol`），不再依赖 web-ui 的 `data-pane` / `data-dsh-frame`，装不装 web-ui 均生效。
- **修复：窄屏详情列与顶部 header 重叠**。窄屏（≤900px）隐藏详情列，杜绝详情浮层与顶部 header 重叠；覆盖 web-ui 的 `conversation-header` 60px 让位与 `session-utilities` 按钮 `min-height:44px`（更高特异性 + 同断点，保留 min-width 触摸目标）。
- **修复：未装 web-ui 时窄屏点正文不收起抽屉**。新增 `dsh-mobile-dismiss` 守卫：未装 web-ui 时窄屏点正文自动收起抽屉（class 定位 + 让位守卫，不误伤抽屉内按钮）。
- **新增：设置弹窗顶部固定滑动浏览提示**。`overlay ::before`（absolute，不随内容滚动）提示用户可上下滑动浏览弹窗内容。

### Docs (文档)
- **新增 `screenshots.json`**：收录项目各界面截图图片 URL，便于 README 预览图管理与引用。

---

## [1.4.0] - 2026-08-24

### Compatibility (通用插件共存保护)
- **修复：与其他远程/Web 接入类插件共存时启动致命崩溃**。`remoteWebUiPairing` 是远程/Web 接入类插件的通用配对共享服务名，任何其他插件先注册同名服务后，本插件再注册必然抛错；而 loader 以 `Promise.allSettled` 并发激活全部 entry，任一失败即回滚整棵插件树并使进程退出（市场安装后直接启动即崩，此前只能手动禁用对方解决）。现改为**延迟裁决**：等待激活窗口结束后检测服务名归属——已被占用则主动让出（不注册、不抛错），无人注册才接管，保证共存时必定可正常启动。
- **新增：共存状态可见化**。裁决结果通过 `/api/remote-mobile/status` 的 `pairingBridgeMode`（`active`/`yielded`/`pending`）、`pairingBridgeConflict` 与 `pairingBridgeConflictId` 下发（基于 Cordis 公开运行时结构尽力定位占用方包名与 entry id，无法识别时前端回退通用文案）；设置页顶部在共存时展示可关闭的警示横幅（中英文），支持一键复制「诊断与修复报告」（含精确 entry id 与可直接执行的修复步骤，可直接粘贴给 AI 助手处理）；host 日志同步输出 warn。判定逻辑完全通用，不针对任何特定第三方插件。
- **文档：澄清 EADDRINUSE 成因**。启动报错 `listen EADDRINUSE: address already in use 0.0.0.0:3080` 是端口被其他进程占用（典型：上一个 dsh 实例未退出、桌面快捷方式隐藏实例），与安装哪个插件无关，README FAQ 新增排查步骤（Q0）。
- **配置说明调整**：「禁用其他远程接入插件」由必选改为推荐项——共存不再导致启动失败；保留其一仍是最佳实践（避免功能重复与入口混乱）。

### Fixed (缺陷修复)
- **修复：手动切换扫码页签后被强制切回 Tailscale**。设置面板每 3 秒轮询一次状态，只要本机存在 Tailscale IP 就会强制把扫码页签切回 Tailscale，用户手动选中的「局域网扫码」数秒内被覆盖。现记录用户的手动选择：自动预选仅在用户从未手动切换时生效。
- **修复：移动端样式片段启用后设置弹窗被困在侧边栏内**。设置面板内联渲染于侧边栏 DOM 中，其全屏遮罩层为 `position:fixed`；而官方在侧边栏列上遗留的恒等 transform（`matrix(1,0,0,1,0,0)`）会把 fixed 后代的包含块困在该列内，叠加官方 `overflow:hidden` 后弹窗被裁剪成抽屉宽度（表现为「弹窗出现在侧边栏里面」）。`preset-sidebar` 现显式清除侧边栏列上全部包含块触发属性（`transform` / `filter` / `backdrop-filter` / `perspective` / `will-change`），并将 body 直挂的模态 portal 容器统一抬升层级，两类弹窗均恢复正常全屏居中。
- **修复：移动端侧边栏抽屉内外层宽度不一致**。官方响应式脚本会给内层根节点写入固定内联宽度（如 `280px`），与外层抽屉实际宽度（官方 `min(88vw, 320px)`）不一致，在抽屉右缘留下约 40px 无法交互的空白条；现强制内层根节点铺满抽屉（`width:100% !important` 覆盖内联样式），内外对齐无死区。
- **修复：移动端侧边栏抽屉层级过高压住官方弹层**。抽屉原采用 `z-index:99999`，高于官方模态弹窗（1000）与下拉菜单（1100，portal 到 body），导致设置面板的操作菜单弹出后被盖在抽屉之下无法交互。现整体下调：抽屉 `900`、悬浮把手 `901`——仍稳定覆盖正文内容，同时让位官方全部弹层。
- **修复：官方 frame::after 全屏点击遮罩罩住抽屉内容**。抽屉降层级后，官方窄屏抽屉的全屏遮罩（`[data-dsh-frame]::after`，fixed、rgba 黑纱、`z-index:1050`、可拦截点击）反过来压在抽屉之上；现将其压制到 `899`——低于抽屉、高于正文，暗化背景与「点外部收回抽屉」能力保留。
- **修复：移动端抽屉内点击次级操作图标（更多操作 ⋯ / 展开箭头等）后抽屉被误关**。生态插件（如 @linxin666/dsh-web-ui-all）的「点条目自动收回抽屉」增强会把条目内 `role=treeitem` 下的所有点击一律视为选中，下一帧程序化点击收起按钮，导致 ⋯ 菜单未弹出抽屉先被收起。现注入防误收起守卫：记录对条目内按钮/箭头的触摸，900ms 内的程序化收起调用被忽略；真实点击收起按钮、点条目主体回主区的官方行为均保持不变。
- **修复：触屏点击展开把手后官方 Tooltip 气泡永久滞留**（黑底「收起侧边栏」）。官方气泡显示依赖 `mouseenter`/`focus`、消失只认 `mouseleave`/`blur`，触屏点击后这两个事件永远不会到来；现移动端 UA 下整体隐藏官方 Tooltip 气泡（按钮均保留 `aria-label`，可访问性不受影响），PC 窄窗口悬停提示不受影响。

---

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
