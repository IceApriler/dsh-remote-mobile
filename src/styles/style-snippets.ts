/**
 * 移动端样式片段注册表 (Mobile Style Snippets Store)
 *
 * 【设计职责】
 * 本模块是插件内部的「样式小插件」体系：把 DSH Web 界面的样式适配拆分成
 * 一个个可独立启停的 CSS 片段（Snippet）。
 *
 * - 内置预设片段（Builtin Presets）：随插件分发，按界面区域划分为三份——
 *   侧边栏（preset-sidebar）、设置面板（preset-settings）、正文（preset-main）；
 * - 用户自定义片段（Custom Snippets）：通过设置面板或 API 动态增删改，持久化于
 *   ~/.dsh/remote-mobile/style-snippets.json，无需修改插件代码、无需重启；
 * - 每个片段（含内置预设）支持【PC 端 / 移动端】分别启停，且按【视口宽度】判定而非设备 UA：
 *   mobileEnabled → 包装 @media (max-width: 900px)，窄视口生效（PC 拉小窗口同样生效）；
 *   pcEnabled     → 包装 @media (min-width: 901px)，宽视口生效；两端都开 → 全宽度原样生效。
 *
 * 注入发生在网关层响应拦截（见 bridge/compat.ts 的 patchHttpServerWithVirtualizer），
 * 对主工作区 index.html 与 /auth 登录页统一生效。
 */

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'

/** 用户自定义样式片段持久化文件 */
export const DEFAULT_STYLE_FILE = join(homedir(), '.dsh', 'remote-mobile', 'style-snippets.json')

/** 移动端 User-Agent 识别正则 */
export const MOBILE_UA_REGEX = /Android|iPhone|iPod|iPad|Mobile Safari|Opera Mini|IEMobile|Windows Phone|BlackBerry|webOS|Mobi/i

/** 单片段 CSS 长度上限（防配置膨胀） */
export const MAX_CSS_LENGTH = 200_000
/** 片段名称长度上限 */
export const MAX_NAME_LENGTH = 80
/** 内置预设 id 保留前缀（自定义片段不得占用） */
export const BUILTIN_ID_PREFIX = 'preset-'

export interface StyleSnippet {
  /** 稳定唯一 id（内置片段为 preset-xxx，自定义片段为 custom-xxx） */
  id: string
  /** 片段名称（list(lang) 按语言本地化；自定义片段为用户填写原文） */
  name: string
  /** 可选说明文案 */
  description?: string
  /** CSS 代码片段本体 */
  css: string
  /** 桌面端（PC 浏览器）是否注入 */
  pcEnabled: boolean
  /** 移动端（手机/平板浏览器）是否注入 */
  mobileEnabled: boolean
  /** 是否为内置预设（内置不可删除，仅可启停） */
  builtin?: boolean
  createdAt?: number
  updatedAt?: number
}

export interface BuiltinStylePreset {
  id: string
  name: { zh: string; en: string }
  description: { zh: string; en: string }
  css: string
  /** 桌面端默认启停（默认 false：预设主要面向移动端） */
  defaultPcEnabled?: boolean
  /** 移动端默认启停（默认 true） */
  defaultMobileEnabled?: boolean
}

export interface UpsertStyleInput {
  id?: string
  name: string
  description?: string
  css: string
  pcEnabled?: boolean
  mobileEnabled?: boolean
}

/** 侧边栏预设：抽屉式导航 + 整体布局（overscroll / 三栏 0 占位 / 悬浮把手） */
const PRESET_SIDEBAR_CSS = `
/* ===== dsh-remote-mobile · 侧边栏抽屉导航与整体布局 ===== */
/* 注：窄屏媒体查询由注入层按端包裹（移动端包 @media (max-width:900px)，PC 端原样生效） */
/* 0. 禁用浏览器原生橡皮筋下拉刷新与链式溢出滚动，彻底杜绝上下滑动误刷新页面 */
  html,
  body,
  [class*="_frame"],
  [role="dialog"],
  [class*="_dialog"],
  [class*="_modalContent"],
  [class*="_overlay"],
  [class*="_conversationArea"],
  [class*="_centerCol"] {
    overscroll-behavior-y: contain !important;
    overscroll-behavior-x: none !important;
  }

  /* 1. 最外层三栏布局：在移动端主工作区占满 100% 全宽，消除侧边栏强制占位。
     选择器全部基于官方 CSS Modules 稳定后缀（_frame/_sidebarCol/_centerCol，
     前缀 hash 随机、后缀稳定），不依赖 @linxin666/dsh-web-ui-all 注入的
     data-pane / data-dsh-frame 属性，安装与否均生效。 */
  [class*="_frame"] {
    grid-template-columns: 0px minmax(0px, 1fr) 0px !important;
    width: 100vw !important;
    max-width: 100vw !important;
    overflow-x: hidden !important;
    position: relative !important;
  }

  [class*="_centerCol"] {
    width: 100vw !important;
    max-width: 100vw !important;
  }

  /* 2. 侧边栏最外层容器：作为整体抽屉浮层（阴影仅加在最外层，严禁污染内部列表） */
  [class*="_sidebarCol"] {
    position: fixed !important;
    top: 0 !important;
    bottom: 0 !important;
    left: 0 !important;
    height: 100vh !important;
    height: 100dvh !important;
    /* 层级守卫：抽屉必须低于官方弹层体系（模态弹窗 z=1000、下拉/弹出菜单 z=1100），
       否则设置面板的操作菜单（portal 到 body）会被抽屉盖住无法交互。
       官方内容区元素均在 100 层级以下，900 足以保证抽屉覆盖正文。
       展开态宽度：装了 web-ui 时由它接管（min(88vw,320px)）；未装时沿用官方
       内联 width（280px 左右），宽度差由下方内层铺满规则消除。 */
    min-width: 0 !important;
    z-index: 900 !important;
    background: var(--dsw-alias-bg-layer-1, #ffffff) !important;
    box-shadow: 6px 0 30px rgba(0, 0, 0, 0.25) !important;
    border-right: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.15)) !important;
    /* 关键守卫：官方会在侧边栏列上留下恒等 transform（matrix(1,0,0,1,0,0)），
       任何 transform/filter 等都会把 position:fixed 后代的包含块「困」在本列内，
       叠加官方 overflow:hidden 后，设置弹窗（内联渲染于侧边栏 DOM）会被裁剪成
       抽屉宽度、表现为「弹窗出现在侧边栏里面」。显式清除全部包含块触发属性。 */
    transform: none !important;
    filter: none !important;
    backdrop-filter: none !important;
    perspective: none !important;
    will-change: auto !important;
  }

  /* 遮罩：抽屉外全屏黑纱必须压在抽屉(900)之下，否则抽屉内容会被黑纱罩住并
     拦截全部点击。压到 899：低于抽屉、仍高于正文(≤100)，「点抽屉外暗处
     自动收回」的能力保留。
     - 装了 web-ui 时：它生成 [data-dsh-frame]:not([data-sidebar-collapsed])::after
       （z-index:1050），由下方 [class*="_frame"]::after 的 !important 统一压到 899。
     - 未装 web-ui 时：官方无遮罩，由下方 :not([data-sidebar-collapsed]) 规则补齐。 */
  [class*="_frame"]::after {
    z-index: 899 !important;
  }

  [class*="_frame"]:not([data-sidebar-collapsed])::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 899;
    background: rgb(0 0 0 / 24%);
  }

  /* 内层根节点铺满抽屉：覆盖官方响应式脚本写入的内联 width，
     消除「外层 ~320 / 内层内联 280」的宽度差与右缘空白条 */
  [class*="_sidebarCol"] > [data-slot="sidebar"] > div {
    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;
    height: 100% !important;
  }

  /* 3. 折叠状态：侧边栏收起为 0px 并隐藏整体阴影和多余按钮。
     data-sidebar-collapsed 属性与 _collapsed class 均由官方 sidebar 插件写入，
     两种环境（装/不装 web-ui）行为一致，这里用无值匹配 [data-sidebar-collapsed]
     保证属性不带值也能命中。 */
  [class*="_sidebarCol"]:has([class*="_collapsed"]),
  [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] {
    width: 0px !important;
    min-width: 0px !important;
    border: none !important;
    box-shadow: none !important;
    background: transparent !important;
    pointer-events: none !important;
  }

  [class*="_sidebarCol"] [class*="_collapsed"] > :not([class*="_logoRow"]),
  [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] > div > div > :not([class*="_logoRow"]) {
    display: none !important;
  }

  /* 折叠状态下，Logo 按钮悬浮在屏幕左上角作为展开把手（与 dsh-draggable-nav 拖拽脚本联动） */
  [class*="_sidebarCol"] [class*="_collapsed"] [class*="_logoRow"],
  [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] [class*="_logoRow"] {
    position: fixed !important;
    top: 10px !important;
    left: 10px !important;
    width: 40px !important;
    height: 40px !important;
    border-radius: 10px !important;
    background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.95)) !important;
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(12px) !important;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2)) !important;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    pointer-events: auto !important;
    /* 与抽屉(900)同层体系：高于正文内容，低于官方弹窗(1000)/菜单(1100) */
    z-index: 901 !important;
  }

  /* 4. 触屏设备没有 hover：官方 Tooltip 气泡（黑底，如折叠把手的「收起侧边栏」）
     显示依赖 mouseenter/focus，而消失只认 mouseleave/blur —— 触摸点击后这两个
     事件永远不会到来，气泡会永久滞留在屏幕上。移动端 UA 下整体隐藏官方气泡
     （按钮均保留 aria-label，可访问性不受影响）；PC 窄窗口仍保留悬停提示。 */
  html[data-dsh-mobile="1"] [role="tooltip"] {
    display: none !important;
  }

  /* 5. 窄屏隐藏官方详情（details）列：官方会把未折叠的详情面板做成全屏浮层
     盖在 conversation 顶部（web-ui 窄屏折叠态也是 display:none），这里直接隐藏，
     彻底杜绝缩小窗口时详情面板与顶部 header 重叠。 */
  [class*="_detailsCol"] {
    display: none !important;
  }

  /* 6. 已装 web-ui 时，其移动端 conversation-header 为折叠 rail 预留 60px 左内边距；
     本插件折叠为 0px + 悬浮把手，header 无需让位，覆盖为 8px。
     用更高特异性（(0,2,1) > web-ui 的 (0,2,0)）保证无论加载顺序都压过 web-ui；
     仅在与 web-ui 相同的 ≤768px 断点生效，避免干扰 769-900px 的官方 header。 */
  @media (max-width: 768px) {
    [class*="_frame"] header[data-dsh-responsive-part="conversation-header"] {
      padding-left: 8px !important;
    }

    /* 7. 覆盖 web-ui 给 session-utilities 按钮强制的 min-height: 44px（min-width 保留）。
       该规则特异性与 web-ui 同为 (0,3,0)，故补一个重复属性选择器抬到 (0,4,0)
       确保无论加载顺序都压过 web-ui；仅在同断点 ≤768px 生效。 */
    [class*="_frame"] [data-dsh-responsive-part="session-utilities"][data-dsh-responsive-part] :is(button, [role="button"]) {
      min-height: 0 !important;
    }
  }
`

/** 设置面板预设：官方设置弹窗整体微缩 + 遮罩锁滚动 + 内容横向滑动 */
const PRESET_SETTINGS_CSS = `
/* ===== dsh-remote-mobile · 设置面板适配 ===== */
/* 注：窄屏媒体查询由注入层按端包裹 */
/* 遮罩彻底锁死防漏底，弹窗整体居中 */
  [data-slot*="overlay"]:has([role="dialog"]),
  [class*="_overlay"]:has([role="dialog"]),
  [class*="_modalWrapper"]:has([role="dialog"]) {
    position: fixed !important;
    inset: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: hidden !important;
    z-index: 100005 !important;
    background: rgba(0, 0, 0, 0.5) !important;
    overscroll-behavior: contain !important;
  }

  /* 移动端设置弹窗顶部固定提示：内容较宽（530px 等比微缩）需左右滑动浏览。
     挂在 overlay 容器 ::before 上（absolute 定位相对 fixed overlay），
     不随弹窗内容滚动，也不参与 flex 居中布局。内测声明等通用 Modal
     （_root 容器，不在本选择器集合内）不会出现此提示。 */
  [data-slot*="overlay"]:has([role="dialog"])::before,
  [class*="_overlay"]:has([role="dialog"])::before,
  [class*="_modalWrapper"]:has([role="dialog"])::before {
    content: "↔ 左右滑动浏览设置";
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100006 !important;
    box-sizing: border-box;
    white-space: nowrap;
    max-width: calc(100vw - 32px);
    overflow: hidden;
    text-overflow: ellipsis;
    background: rgba(0, 0, 0, 0.62);
    color: #ffffff;
    font-size: 12px;
    line-height: 18px;
    border-radius: 999px;
    padding: 4px 14px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    pointer-events: none;
    text-align: center;
  }

  /* 弹窗卡片：仅命中设置弹窗——外层 overlay 容器内含 role=dialog（设置弹窗由
     data-slot overlay / overlay 类包裹）。内测声明等通用 Modal 直接挂在 body、
     无 data-slot overlay，天然排除，不会被 94vw / 530px 覆写。 */
  [data-slot*="overlay"]:has([role="dialog"]) [role="dialog"],
  [data-slot*="overlay"]:has([role="dialog"]) [class*="_dialog"],
  [data-slot*="overlay"]:has([role="dialog"]) [class*="_modalContent"],
  [class*="_overlay"]:has([role="dialog"]) [role="dialog"],
  [class*="_overlay"]:has([role="dialog"]) [class*="_dialog"],
  [class*="_overlay"]:has([role="dialog"]) [class*="_modalContent"],
  [class*="_modalWrapper"]:has([role="dialog"]) [role="dialog"],
  [class*="_modalWrapper"]:has([role="dialog"]) [class*="_dialog"],
  [class*="_modalWrapper"]:has([role="dialog"]) [class*="_modalContent"],
  [class*="_settingsModal"] {
    position: relative !important;
    width: 94vw !important;
    max-width: 94vw !important;
    height: 86vh !important;
    height: 86dvh !important;
    max-height: 88vh !important;
    max-height: 88dvh !important;
    margin: auto !important;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4) !important;
    border-radius: 16px !important;
    background: var(--dsw-alias-bg-layer-1, #ffffff) !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    -webkit-overflow-scrolling: touch !important;
    overscroll-behavior: contain !important;
    font-size: 13.5px !important;
  }

  /* 弹窗内部等比微缩：dialog 的全部直接子元素（如设置弹窗的 nav 左侧按钮列表 +
     content 右侧内容）统一 zoom 0.88，保证整窗一致缩放。 */
  [data-slot*="overlay"]:has([role="dialog"]) [role="dialog"] > *,
  [data-slot*="overlay"]:has([role="dialog"]) [class*="_dialog"] > *,
  [data-slot*="overlay"]:has([role="dialog"]) [class*="_modalContent"] > *,
  [class*="_overlay"]:has([role="dialog"]) [role="dialog"] > *,
  [class*="_overlay"]:has([role="dialog"]) [class*="_dialog"] > *,
  [class*="_overlay"]:has([role="dialog"]) [class*="_modalContent"] > *,
  [class*="_modalWrapper"]:has([role="dialog"]) [role="dialog"] > *,
  [class*="_modalWrapper"]:has([role="dialog"]) [class*="_dialog"] > *,
  [class*="_modalWrapper"]:has([role="dialog"]) [class*="_modalContent"] > *,
  [class*="_settingsModal"] > * {
    zoom: 0.88 !important;
  }

  /* 弹窗右侧内容主体（直接 div 子元素）：固定最小宽度并铺满高度，单屏显示更多
     内容且字号更精致。左侧导航列表不强制宽度，保持官方窄宽。
     同样限定在设置弹窗上下文内，避免波及通用 Modal。 */
  [data-slot*="overlay"]:has([role="dialog"]) [role="dialog"] > div,
  [data-slot*="overlay"]:has([role="dialog"]) [class*="_dialog"] > div,
  [data-slot*="overlay"]:has([role="dialog"]) [class*="_modalContent"] > div,
  [class*="_overlay"]:has([role="dialog"]) [role="dialog"] > div,
  [class*="_overlay"]:has([role="dialog"]) [class*="_dialog"] > div,
  [class*="_overlay"]:has([role="dialog"]) [class*="_modalContent"] > div,
  [class*="_modalWrapper"]:has([role="dialog"]) [role="dialog"] > div,
  [class*="_modalWrapper"]:has([role="dialog"]) [class*="_dialog"] > div,
  [class*="_modalWrapper"]:has([role="dialog"]) [class*="_modalContent"] > div,
  [class*="_settingsModal"] > div {
    min-width: 530px !important;
    width: 530px !important;
    height: 100% !important;
  }

  /* 重置插件市场等弹窗在窄屏隐藏左侧 nav 的行为：保持导航列表可见。
     该插件规则（@media max-width:560px 隐藏）无 !important，
     我们同选择器加 !important 即可稳压。 */
  @media (max-width: 560px) {
    [role="dialog"]:has([data-dsh-market-root]) > nav {
      display: block !important;
    }
  }
`

/** 正文预设：对话区紧凑高密度排版（小字号/紧凑行距/等宽代码/防溢出） */
const PRESET_MAIN_CSS = `
/* ===== dsh-remote-mobile · 对话正文高密度排版 ===== */
/* 注：窄屏媒体查询由注入层按端包裹 */
/* 目标：小字号 + 紧凑行距 + 收紧边距，让每行展示更多内容。
   不做布局缩放（zoom 会挤压 1fr 网格轨道、产生右侧空白并使页面破版）；
   字号规则主要基于稳定 HTML 元素（p/h1/li/pre/code 不随 hash 变化），
   内容容器用 CSS Modules localName 后缀（只有前缀 hash 随机，后缀稳定）。 */

/* 1. 消息内容容器：紧凑字号与行距 */
[class*="_centerCol"],
[data-slot^="conversation.chat"],
[class*="_markdown"],
[class*="_message"],
[class*="_bubble"],
[class*="_text"] {
  font-size: 12.5px !important;
  line-height: 1.45 !important;
  letter-spacing: -0.01em !important;
}

/* 2. HTML 元素级（稳定）：段落与标题层级 */
[class*="_centerCol"] p,
[data-slot^="conversation.chat"] p,
[class*="_markdown"] p,
[class*="_message"] p,
[class*="_bubble"] p {
  font-size: 12.5px !important;
  line-height: 1.45 !important;
  margin: 0 0 0.4em 0 !important;
}

[class*="_centerCol"] h1,
[class*="_centerCol"] h2,
[class*="_centerCol"] h3,
[class*="_centerCol"] h4,
[data-slot^="conversation.chat"] h1,
[data-slot^="conversation.chat"] h2,
[data-slot^="conversation.chat"] h3,
[class*="_markdown"] h1,
[class*="_markdown"] h2,
[class*="_markdown"] h3 {
  font-size: 13.5px !important;
  font-weight: 700 !important;
  margin: 0.5em 0 0.25em 0 !important;
  line-height: 1.3 !important;
}

[class*="_centerCol"] ul,
[class*="_centerCol"] ol,
[class*="_markdown"] ul,
[class*="_markdown"] ol {
  margin: 0.2em 0 0.4em 0 !important;
  padding-left: 1.2em !important;
}
[class*="_centerCol"] li,
[class*="_markdown"] li {
  font-size: 12.5px !important;
  line-height: 1.45 !important;
  margin-bottom: 0.15em !important;
}

/* 3. 行内代码与代码块：小等宽 + 防横向溢出 */
[class*="_centerCol"] code,
[data-slot^="conversation.chat"] code,
[class*="_markdown"] code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
  font-size: 11.5px !important;
}
[class*="_centerCol"] pre,
[data-slot^="conversation.chat"] pre,
[class*="_markdown"] pre {
  font-size: 11.5px !important;
  line-height: 1.4 !important;
  max-width: 100% !important;
  overflow-x: auto !important;
  -webkit-overflow-scrolling: touch !important;
}

/* 表格：紧凑字号/内边距 + 窄屏横向滚动防撑破（display:block 让表格宽度受容器约束） */
[class*="_centerCol"] table,
[data-slot^="conversation.chat"] table,
[class*="_markdown"] table {
  font-size: 11.5px !important;
  line-height: 1.4 !important;
  display: block !important;
  max-width: 100% !important;
  overflow-x: auto !important;
  -webkit-overflow-scrolling: touch !important;
}
[class*="_centerCol"] table th,
[class*="_centerCol"] table td,
[data-slot^="conversation.chat"] table th,
[data-slot^="conversation.chat"] table td,
[class*="_markdown"] table th,
[class*="_markdown"] table td {
  font-size: 11.5px !important;
  line-height: 1.4 !important;
  padding: 3px 7px !important;
}

/* 3.5 可折叠披露行（data-disclosure-row，如“Code/思考”等行）：标题与摘要跟随紧凑字号 */
[class*="_centerCol"] [data-disclosure-row],
[data-slot^="conversation.chat"] [data-disclosure-row] {
  font-size: 12.5px !important;
  line-height: 1.45 !important;
}
[class*="_centerCol"] [data-disclosure-row] [class*="_title"],
[class*="_centerCol"] [data-disclosure-row] [class*="_summary"],
[data-slot^="conversation.chat"] [data-disclosure-row] [class*="_title"],
[data-slot^="conversation.chat"] [data-disclosure-row] [class*="_summary"] {
  font-size: 12.5px !important;
  line-height: 1.45 !important;
  letter-spacing: -0.01em !important;
}

/* 3.7 消息列表双层滚动容器（wSkVaW_scrollBody + Md3f7G_scroll）padding 叠加：
   官方各带 12~16px（合计每侧最多 28px），统一每层压到 8px（每侧合计 16px）。
   均排除输入区滚动容器，避免误伤 composer。 */
[class*="_centerCol"] [class*="_scrollBody"],
[class*="_centerCol"] [class*="_scroll"]:not([data-composer-card] [class*="_scroll"]) {
  padding: 8px 8px !important;
}

/* 4. 消息操作条（时间戳/复制等）与内行图标：显式收敛（SVG 不随字号缩放，需显式尺寸） */
[class*="_centerCol"] [class*="_actions"],
[data-slot^="conversation.chat"] [class*="_actions"] {
  font-size: 11px !important;
  line-height: 1.2 !important;
}
[class*="_centerCol"] [class*="_actions"] [class*="_timeStart"],
[class*="_centerCol"] [class*="_actions"] [class*="_timeEnd"],
[class*="_centerCol"] [class*="_actions"] [class*="_time"],
[data-slot^="conversation.chat"] [class*="_actions"] [class*="_timeStart"],
[data-slot^="conversation.chat"] [class*="_actions"] [class*="_timeEnd"],
[data-slot^="conversation.chat"] [class*="_actions"] [class*="_time"] {
  font-size: 11px !important;
}
/* 用时统计内各指标/分隔点间距收紧（margin: 0） */
[class*="_centerCol"] [class*="_actions"] [class*="_timeEnd"] span,
[data-slot^="conversation.chat"] [class*="_actions"] [class*="_timeEnd"] span {
  margin: 0 !important;
}
/* 统计行：单行优先，空间不足才折行（不再强制独占整行）；折行后与消息左缘对齐（margin-left 清零） */
[class*="_centerCol"] [class*="_actions"] [class*="_timeEnd"],
[data-slot^="conversation.chat"] [class*="_actions"] [class*="_timeEnd"] {
  flex: 0 1 auto !important;
  min-width: 0 !important;
  height: auto !important;
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
  padding-left: 6px !important; /* 折行时也保留 6px 缩进，与上方内容区分 */
}
[class*="_centerCol"] [class*="_actions"],
[data-slot^="conversation.chat"] [class*="_actions"] {
  flex-wrap: wrap !important;
  height: auto !important;
  overflow: visible !important;
}
[class*="_centerCol"] [class*="_actions"] svg,
[data-slot^="conversation.chat"] [class*="_actions"] svg,
[class*="_centerCol"] [class*="_leading"] svg,
[data-slot^="conversation.chat"] [class*="_leading"] svg {
  width: 13px !important;
  height: 13px !important;
  max-width: 13px !important;
  max-height: 13px !important;
  vertical-align: middle !important;
  flex: none !important;
}

/* 5. 聊天输入区（composer）紧凑：ghost-textarea 三元件（backdrop 文字层 / input 输入层 / mirror 撑高层）
   官方共用同一排版：card 16px/24px，三层皆 inherit，且官方 JS 读 mirror 的 lineHeight 做光标滚动定位。
   因此必须整体改 card 一个基准让三层同步，绝不能只改其中一两层，否则光标随行数错位、高度不撑开。
   注：插件已设 user-scalable=no，iOS 聚焦不会放大，14px 安全。 */
[data-composer-card="true"] {
  font-size: 14px !important;
  line-height: 20px !important;
}
/* ghost-textarea 三件套（backdrop 文字层 / input 输入层 / mirror 撑高层）全参数锁定：
   与官方共享样式基准一致（仅字号行高改小），根除继承链差异 → 光标/高度/滚动定位同步 */
[data-composer-card="true"] textarea,
[data-composer-card="true"] [data-dsh-part="composer-input"],
[data-composer-card="true"] [data-input-mirror="true"],
[data-composer-card="true"] [data-input-backdrop="true"] {
  font-family: var(--dsw-font-family, inherit) !important;
  font-size: 14px !important;
  line-height: 20px !important;
  letter-spacing: 0 !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
  overflow-wrap: anywhere !important;
  padding: 4px 12px 0 16px !important;
}
[data-composer-card="true"] button,
[data-composer-card="true"] [role="button"],
[data-composer-card="true"] [class*="_triggerLabel"] {
  font-size: 13px !important;
}
/* 输入框整体加宽：composer 外层容器左右留白 16px → 8px（:has 精准定位 card 的直接父，避免误伤其它 _root） */
[class*="_root"]:has(> [data-composer-card="true"]) {
  padding: 0 8px 8px !important;
}
[data-composer-card="true"] svg {
  width: 13px !important;
  height: 13px !important;
  max-width: 13px !important;
  max-height: 13px !important;
  flex: none !important;
}
/* composer 工具栏紧凑：保持两行布局不变，仅缩小控件尺寸。
   以工具栏行（_row，即 uV2eYG_row）为锚点，避免误伤输入文本区内的
   文本引用 / chip 等行内元素。特异性 (0,2,0)~ (0,3,0) 均高于官方单类 (0,1,0)。 */
[data-composer-card="true"] [class*="_row"] {
  gap: 6px !important;
  padding: 2px 6px 4px !important;
}
[data-composer-card="true"] [class*="_row"] [class*="_tools"],
[data-composer-card="true"] [class*="_row"] [class*="_modes"],
[data-composer-card="true"] [class*="_row"] [class*="_trailing"] {
  gap: 6px !important;
}
[data-composer-card="true"] [class*="_row"] [class*="_add"],
[data-composer-card="true"] [class*="_row"] [class*="_trigger"] {
  padding: 0 4px !important;
  gap: 2px !important;
}
[data-composer-card="true"] [class*="_row"] [class*="_add"] {
  width: 26px !important;
  min-width: 26px !important;
  height: 26px !important;
  min-height: 26px !important;
}
[data-composer-card="true"] [class*="_row"] [class*="_triggerLabel"],
[data-composer-card="true"] [class*="_row"] [class*="_triggerEffort"] {
  font-size: 12px !important;
  line-height: 16px !important;
}
[data-composer-card="true"] [class*="_row"] [class*="_primary"] {
  width: 30px !important;
  height: 30px !important;
  min-width: 30px !important;
  min-height: 30px !important;
}
[data-composer-card="true"] [class*="_row"] svg {
  width: 12px !important;
  height: 12px !important;
  max-width: 12px !important;
  max-height: 12px !important;
  flex: none !important;
}
`

/**
 * 内置官方预设：按界面区域划分的三段预设。
 * 默认【移动端启用（≤900px 窄视口）、PC 关闭（>900px 宽视口）】——预设面向窄屏优化，宽屏按需开启。
 */
export const BUILTIN_PRESETS: BuiltinStylePreset[] = [
  {
    id: 'preset-sidebar',
    name: { zh: '侧边栏抽屉导航', en: 'Sidebar Drawer' },
    description: {
      zh: '折叠时侧边栏 0 宽度占用，官方展开按钮浮动在屏幕左上角并可拖动记忆位置；点击直接触发官方原生展开。',
      en: 'Zero-width sidebar when collapsed with a draggable floating toggle; expands to the native official layout.',
    },
    defaultPcEnabled: false,
    defaultMobileEnabled: true,
    css: PRESET_SIDEBAR_CSS,
  },
  {
    id: 'preset-settings',
    name: { zh: '设置面板适配', en: 'Settings Panel' },
    description: {
      zh: '官方设置弹窗居中微缩显示更多内容，遮罩锁死滚动，内部支持左右横滑。',
      en: 'Centers and scales down the settings dialog, locks overlay scroll, and enables horizontal panning.',
    },
    defaultPcEnabled: false,
    defaultMobileEnabled: true,
    css: PRESET_SETTINGS_CSS,
  },
  {
    id: 'preset-main',
    name: { zh: '正文紧凑排版', en: 'Conversation Layout' },
    description: {
      zh: '对话正文高密度排版：小字号（12.5px）+ 紧凑行距 + 收紧边距，每行展示更多内容；不做布局缩放以免产生轨道空白。',
      en: 'High-density conversation typography: compact 12.5px text, tight line-height and margins → more content per line; no layout scaling so no gaps appear.',
    },
    defaultPcEnabled: false,
    defaultMobileEnabled: true,
    css: PRESET_MAIN_CSS,
  },
]

/** 持久化文件的结构版本（v2：双端开关 presetStates + custom.pcEnabled/mobileEnabled） */
export const STORE_VERSION = 2

/** 判断请求是否来自移动端浏览器 */
export function isMobileUserAgent(ua = ''): boolean {
  return MOBILE_UA_REGEX.test(ua)
}

/** 给 <html> 打上 data-dsh-mobile 标记（幂等） */
export function applyDataMobileAttr(html: string): string {
  if (html.includes('data-dsh-mobile')) return html
  return html.replace(/<html([^>]*)>/i, '<html$1 data-dsh-mobile="1">')
}

/** 把收集到的 CSS 包装成 <style> 注入标签（空内容返回空串） */
export function buildMobileStyleTag(css: string): string {
  if (!css) return ''
  // HTML raw-text 元素防护：转义 `</style`，防止片段意外/恶意提前闭合 <style> 标签结构
  // （与 dsh-host-webserver 对 IndexInjection 'style' 行的约束一致：text 不得包含 </style）
  const safeCss = css.replace(/<\/style/gi, '<\\/style')
  return `<style id="dsh-remote-mobile-style-snippets">\n${safeCss.trim()}\n</style>`
}

/** 简单的 UTF-8 校验，防止坏 JSON 拖垮存储 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 内置预设某 id 的启停状态。
 * 落盘时按「三个预设分组齐全」写出：每组两条字段齐全（用户覆盖 ?? 代码默认值），
 * 不再只写被操作过的端；内存与读取端允许字段缺省（回落预设默认值）。 */
export interface PresetState {
  pc?: boolean
  mobile?: boolean
}

/**
 * 样式片段存储：内置预设 + 用户自定义的启停状态与内容管理。
 * 采用防抖 + 原子写盘，与 SessionStore 的持久化策略保持一致。
 */
export class StyleSnippetStore {
  private filePath: string
  private presetStates = new Map<string, PresetState>()
  private custom = new Map<string, StyleSnippet>()
  private customOrder: string[] = []
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(filePath: string = DEFAULT_STYLE_FILE) {
    this.filePath = filePath
    this.load()
    // 注册到进程退出兜底落盘集合（与 SessionStore 保持一致）：
    // 保证剩余改动在事件循环清空时也能 flush 到磁盘
    activeStores.add(this)
  }

  /** 文件路径（用于界面展示） */
  get persistPath(): string {
    return this.filePath
  }

  /** 读取持久化文件（自动迁移 v1 → v2 双端开关格式） */
  load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const raw = readFileSync(this.filePath, 'utf8')
      const data = JSON.parse(raw)
      if (!isPlainObject(data)) return

      const version = typeof data.version === 'number' ? data.version : 1

      if (version >= 2 && isPlainObject(data.presetStates)) {
        for (const [id, st] of Object.entries(data.presetStates)) {
          if (!isPlainObject(st)) continue
          const rec: PresetState = {}
          if (typeof st.pc === 'boolean') rec.pc = st.pc
          if (typeof st.mobile === 'boolean') rec.mobile = st.mobile
          this.presetStates.set(id, rec)
        }
      } else if (isPlainObject(data.builtinEnabled)) {
        // v1 迁移：旧语义为「enabled + mobileOnly」，内置预设全部面向移动端
        for (const [id, enabled] of Object.entries(data.builtinEnabled)) {
          this.presetStates.set(id, { pc: false, mobile: Boolean(enabled) })
        }
      }

      const customs = Array.isArray(data.custom) ? data.custom : []
      for (const item of customs) {
        if (!isPlainObject(item) || typeof item.id !== 'string' || typeof item.css !== 'string') continue
        let pcEnabled: boolean
        let mobileEnabled: boolean
        if (typeof item.pcEnabled === 'boolean' || typeof item.mobileEnabled === 'boolean') {
          pcEnabled = item.pcEnabled !== false
          mobileEnabled = item.mobileEnabled !== false
        } else {
          // v1 自定义片段迁移：mobileOnly=true → 仅移动端；false → 双端
          const enabled = item.enabled !== false
          const mobileOnly = item.mobileOnly !== false
          pcEnabled = enabled && !mobileOnly
          mobileEnabled = enabled
        }
        this.custom.set(item.id as string, {
          id: item.id as string,
          name: typeof item.name === 'string' ? item.name : item.id,
          description: typeof item.description === 'string' ? item.description : undefined,
          css: item.css as string,
          pcEnabled,
          mobileEnabled,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : undefined,
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined,
        })
      }

      const order = Array.isArray(data.customOrder) ? data.customOrder : []
      this.customOrder = order.filter((id: unknown) => typeof id === 'string' && this.custom.has(id as string))
      // 未在 order 中的历史片段按创建时间补齐
      for (const id of [...this.custom.keys()]) {
        if (!this.customOrder.includes(id)) this.customOrder.push(id)
      }
    } catch {
      // 损坏文件不阻塞启动：保留原文件供排查，内存从空开始
    }
  }

  /** 触发防抖持久化 */
  private schedulePersist(): void {
    this.dirty = true
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.flushPersistedData()
    }, 300)
    if (typeof (this.persistTimer as any).unref === 'function') {
      ;(this.persistTimer as any).unref()
    }
  }

  /** 立即落盘（进程退出前也会被调用） */
  flushPersistedData(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (!this.dirty) return
    this.dirty = false

    // 分组落盘：恒写入全部内置预设（preset-sidebar / preset-settings / preset-main 三组齐全），
    // 每组为「用户覆盖 ?? 代码默认」的当前有效状态，pc/mobile 两字段齐全
    const presetStates: Record<string, PresetState> = {}
    for (const preset of BUILTIN_PRESETS) {
      const st = this.presetStates.get(preset.id) ?? {}
      presetStates[preset.id] = {
        pc: st.pc ?? preset.defaultPcEnabled ?? false,
        mobile: st.mobile ?? preset.defaultMobileEnabled ?? true,
      }
    }

    const payload = {
      version: STORE_VERSION,
      presetStates,
      custom: [...this.custom.values()],
      customOrder: this.customOrder,
    }
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
      renameSync(tmpPath, this.filePath)
    } catch {
      try {
        if (existsSync(tmpPath)) unlinkSync(tmpPath)
      } catch {}
    }
  }

  /** 全部片段：内置预设（按注册序）+ 自定义片段（按 customOrder）。lang 决定内置预设名称/描述的本地化。 */
  list(lang: 'zh' | 'en' = 'zh'): StyleSnippet[] {
    const l = lang === 'en' ? 'en' : 'zh'
    const out: StyleSnippet[] = []
    for (const preset of BUILTIN_PRESETS) {
      const st = this.presetStates.get(preset.id) ?? {}
      out.push({
        id: preset.id,
        name: preset.name[l],
        description: preset.description[l],
        css: preset.css,
        pcEnabled: st.pc ?? preset.defaultPcEnabled ?? false,
        mobileEnabled: st.mobile ?? preset.defaultMobileEnabled ?? true,
        builtin: true,
      })
    }
    for (const id of this.customOrder) {
      const s = this.custom.get(id)
      if (s) out.push({ ...s })
    }
    return out
  }

  /** 按 id 获取片段（内置或自定义） */
  get(id: string, lang: 'zh' | 'en' = 'zh'): StyleSnippet | undefined {
    return this.list(lang).find((s) => s.id === id)
  }

  /**
   * 按端启停任意片段（内置与自定义均可）。
   * @param scope - pc：桌面端开关；mobile：移动端开关
   */
  setEnabled(id: string, scope: 'pc' | 'mobile', enabled: boolean): boolean {
    if (this.custom.has(id)) {
      const s = this.custom.get(id)!
      if (scope === 'pc') s.pcEnabled = enabled
      else s.mobileEnabled = enabled
      s.updatedAt = Date.now()
      this.custom.set(id, s)
      this.schedulePersist()
      return true
    }
    const preset = BUILTIN_PRESETS.find((p) => p.id === id)
    if (preset) {
      // 按端精确记录：仅写入被操作的那一端，未操作端保持缺省（运行时回落预设默认值）
      const cur = this.presetStates.get(id) ?? {}
      if (scope === 'pc') cur.pc = enabled
      else cur.mobile = enabled
      this.presetStates.set(id, cur)
      this.schedulePersist()
      return true
    }
    return false
  }

  /** 重置所有片段的启停状态：内置恢复各自默认（移动端开/PC 关），自定义恢复为移动端开/PC 关 */
  resetEnabled(): void {
    this.presetStates.clear()
    for (const s of this.custom.values()) {
      s.pcEnabled = false
      s.mobileEnabled = true
    }
    this.schedulePersist()
  }

  /** 新增或更新一个自定义片段 */
  upsertCustom(input: UpsertStyleInput): StyleSnippet {
    const name = String(input.name || '').trim()
    const css = String(input.css || '')
    if (!name) throw new Error('snippet name is required')
    if (name.length > MAX_NAME_LENGTH) throw new Error('snippet name too long')
    if (!css.trim()) throw new Error('snippet css is required')
    if (css.length > MAX_CSS_LENGTH) throw new Error('snippet css too large')

    // 防冲突：自定义片段不得占用内置预设 id 或 preset- 保留前缀（否则 list/setEnabled/删除均会歧义）
    if (input.id) {
      if (BUILTIN_PRESETS.some((p) => p.id === input.id) || input.id.startsWith(BUILTIN_ID_PREFIX)) {
        throw new Error('snippet id is reserved for builtin presets')
      }
    }

    const now = Date.now()
    const existingId = input.id && this.custom.has(input.id) ? input.id : null

    const snippet: StyleSnippet = {
      id: existingId || `custom-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: input.description ? String(input.description).trim() : undefined,
      css,
      pcEnabled: input.pcEnabled ?? false,
      mobileEnabled: input.mobileEnabled ?? true,
      createdAt: existingId ? this.custom.get(existingId)!.createdAt : now,
      updatedAt: now,
    }

    if (existingId) {
      this.custom.set(existingId, snippet)
    } else {
      this.custom.set(snippet.id, snippet)
      this.customOrder.push(snippet.id)
    }
    this.schedulePersist()
    return { ...snippet }
  }

  /** 删除一个用户自定义片段（内置预设不可删除） */
  removeCustom(id: string): boolean {
    if (!this.custom.has(id)) return false
    this.custom.delete(id)
    this.customOrder = this.customOrder.filter((x) => x !== id)
    this.schedulePersist()
    return true
  }

  /**
   * 收集最终注入的 CSS（与设备 UA 无关，按视口宽度档生效）：
   * - mobileEnabled && !pcEnabled → 包 @media (max-width: 900px)，窄视口（≤900px）生效；
   * - pcEnabled && !mobileEnabled → 包 @media (min-width: 901px)，宽视口（>900px）生效；
   * - 两端都开 → 原样注入，全宽度生效。
   */
  collectCss(): string {
    const parts: string[] = []
    for (const snippet of this.list()) {
      const pc = snippet.pcEnabled
      const mobile = snippet.mobileEnabled
      if (!pc && !mobile) continue
      const rawCss = snippet.css.trim()
      let cssText: string
      if (pc && mobile) {
        cssText = rawCss
      } else if (mobile) {
        cssText = `@media (max-width: 900px) {\n${rawCss}\n}`
      } else {
        cssText = `@media (min-width: 901px) {\n${rawCss}\n}`
      }
      parts.push(`/* ${snippet.name} (${snippet.id}) */\n${cssText}`)
    }
    return parts.join('\n\n')
  }
}

// 进程退出前兜底落盘（与 SessionStore 思路一致）
const activeStores = new Set<StyleSnippetStore>()
if (typeof process !== 'undefined' && typeof process.on === 'function') {
  process.on('beforeExit', () => {
    for (const s of activeStores) {
      try { s.flushPersistedData() } catch {}
    }
  })
}
