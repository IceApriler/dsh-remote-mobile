/**
 * 远程移动端接入底座兼容性与上下文虚拟化桥接层 (Bridge & Compatibility Virtualizer)
 *
 * 【设计职责】
 * 本模块集中封装所有针对 DSH 底座及第三方生态插件（如 @linxin666/dsh-ssh, @linxin666/dsh-pet, @linxin666/dsh-client-ui-task-board 等）
 * 的兼容性支持逻辑与网络上下文虚拟化代理，主要包含三大核心能力：
 *
 * 1. 【前端安全上下文 Polyfill 物理注入 (Crypto Polyfill Injection)】：
 *    - 解决现代浏览器在非安全上下文（HTTP + 外部 IP，如 Tailscale/局域网）下禁用 window.crypto.randomUUID() 的规范限制；
 *    - 在服务端通过 HTML <head> 顶部首行注入 Polyfill 脚本，确保在所有业务与核心 RPC 客户端执行前 100% 就绪。
 *
 * 2. 【底层 HTTP 门禁劫持与回环上下文虚拟化 (Loopback Context Virtualizer)】：
 *    - 挂载全链路 HTTP 门禁中间件，对未授权请求实施 302 重定向到 /auth 或 401 拦截；
 *    - 对通过认证（已扫码配对 / 长期密码 / 免密直连）的外部请求，在进入下游各业务插件前，
 *      统一将 Host、Origin、Socket RemoteAddress 及 Sec-Fetch-Site 规范化虚拟为 127.0.0.1 回环特征，
 *      解除底层 WebServer 的 DNS-Rebinding 阻断以及第三方插件写死的 loopback-only 403 限制；
 *    - 本机回环 socket（127.0.0.1 / ::1）不做上述洗白：保留原始 Host / Origin / Sec-Fetch-Site，
 *      让下游自身的同源与 DNS-Rebinding 校验继续生效，阻断恶意网页借道本机发起的跨站写攻击。
 *
 * 3. 【移动端样式片段注入 (Mobile Style Snippets Injection)】：
 *    - 在网关响应层按 User-Agent 判定移动端，向主工作区 index.html 与 /auth 登录页
 *      注入可拼装去重的 CSS 片段（内置预设 + 用户自定义，见 styles/style-snippets.ts），
 *      并给 <html> 打上 data-dsh-mobile 标记供样式选择器使用。
 *
 * 4. 【Cordis 服务桥接 (remoteWebUiPairing Bridge)】：
 *    - 以标准 Cordis Service 模式向全局暴露 remoteWebUiPairing 服务；
 *    - 该名称是远程/Web 接入类插件的通用共享服务名，可能与其他同类插件冲突，
 *      采用「延迟裁决」策略：等待激活窗口结束后检测服务名归属，
 *      已被占用则主动让出并置冲突标记（设置页展示警示横幅），无人注册才接管；
 *    - 判定基于 Cordis 公开运行时结构（服务占用 + fiber 运行态），不针对特定插件；
 *    - 保证与其他远程接入类插件共存时必定可以正常启动（不再触发整树回滚致命错误）。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionStore } from '../auth/token.js'
import { getClientIp, isTailscaleIp, isLanIp } from '../auth/tailscale.js'
import {
  isMobileUserAgent,
  applyDataMobileAttr,
  buildMobileStyleTag,
  type StyleSnippetStore,
} from '../styles/style-snippets.js'

/**
 * 注入到 index.html <head> 最前列的 Polyfill 脚本代码片段
 * 针对非安全上下文（HTTP + 外部 IP）提供轻量高精度的 UUID v4 生成能力
 */
export const CRYPTO_POLYFILL_SNIPPET = `
(function() {
  if (typeof window !== "undefined") {
    if (!window.crypto) window.crypto = {};
    if (typeof window.crypto.randomUUID !== "function") {
      window.crypto.randomUUID = function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r = Math.random() * 16 | 0;
          var v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      };
    }
  }
})();
`

/**
 * 注入到 index.html 的移动端悬浮入口拖拽与位置记忆脚本
 * 允许用户在移动端上下随心拖动左上角入口把手，避免遮挡聊天内容，并自动保存位置
 */
export const DRAGGABLE_NAV_SNIPPET = `
(function() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  /* ===== 防误收起守卫 =====
   * 第三方生态插件（如 @linxin666/dsh-web-ui-all 的移动端抽屉增强）会在用户点击
   * 侧边栏条目（role=treeitem）后，于下一帧程序化点击「收起侧边栏」按钮自动收回抽屉。
   * 该判定无法区分「选中条目回主区」与「点击条目内的次级操作图标」（更多操作 ⋯ /
   * 展开箭头等），导致后者抽屉被误关。
   * 这里记录最近一次对条目内次级控件（按钮 / 箭头图标）的触摸时间，并包装
   * HTMLButtonElement.prototype.click：短时间窗口内的程序化收起调用直接忽略；
   * 用户真实点击收起按钮（浏览器合成事件不走 prototype.click）与点击条目主体
   * （非按钮/箭头）的官方行为均不受影响。 */
  if (!window.__dshRmAntiCollapseInstalled__) {
    window.__dshRmAntiCollapseInstalled__ = true;
    var lastSecondaryTapAt = 0;
    document.addEventListener('pointerdown', function (e) {
      try {
        var t = e.target;
        if (!t || !t.closest) return;
        if (!t.closest('[data-pane="sidebar"]')) return;
        var entry = t.closest('[role="treeitem"], [data-dsh-part="sidebar-entry"]');
        if (!entry) return;
        var isSecondaryControl =
          !!t.closest('button, [role="button"]') ||
          !!t.closest('[class*="_arrow"]');
        if (isSecondaryControl) lastSecondaryTapAt = Date.now();
      } catch (err) {}
    }, { capture: true, passive: true });

    var protoClick = HTMLButtonElement.prototype.click;
    HTMLButtonElement.prototype.click = function () {
      try {
        var isSidebarToggle =
          this.matches('[data-dsh-responsive-part="sidebar-toggle"]') ||
          /收起侧边栏|Collapse sidebar|Open sidebar/i.test(this.getAttribute('aria-label') || '');
        if (isSidebarToggle && Date.now() - lastSecondaryTapAt < 900) {
          return; // 吞掉紧随次级操作图标点击之后的程序化收起
        }
      } catch (err) {}
      return protoClick.apply(this, arguments);
    };
  }

  function initDraggableNav() {
    var logoRow = document.querySelector('[data-pane="sidebar"] [class*="_logoRow"]');
    if (!logoRow || logoRow.__dsh_drag_init__) return;
    logoRow.__dsh_drag_init__ = true;

    var savedTop = localStorage.getItem('dsh_mobile_nav_top');
    if (savedTop && !isNaN(Number(savedTop))) {
      var topVal = Math.max(10, Math.min(window.innerHeight - 60, Number(savedTop)));
      logoRow.style.setProperty('top', topVal + 'px', 'important');
    }

    var startY = 0;
    var initialTop = 0;
    var isDragging = false;
    var hasMoved = false;

    function onTouchStart(e) {
      var sidebar = document.querySelector('[data-pane="sidebar"]');
      if (sidebar && !sidebar.querySelector('[class*="_collapsed"]')) return;

      var touch = e.touches ? e.touches[0] : e;
      startY = touch.clientY;
      var rect = logoRow.getBoundingClientRect();
      initialTop = rect.top;
      isDragging = true;
      hasMoved = false;
    }

    function onTouchMove(e) {
      if (!isDragging) return;
      var touch = e.touches ? e.touches[0] : e;
      var deltaY = touch.clientY - startY;

      if (!hasMoved && Math.abs(deltaY) > 5) {
        hasMoved = true;
      }

      if (hasMoved) {
        if (e.cancelable) e.preventDefault();
        var newTop = initialTop + deltaY;
        var minTop = 10;
        var maxTop = window.innerHeight - 56;
        newTop = Math.max(minTop, Math.min(maxTop, newTop));
        logoRow.style.setProperty('top', newTop + 'px', 'important');
      }
    }

    function onTouchEnd(e) {
      if (!isDragging) return;
      isDragging = false;
      if (hasMoved) {
        e.preventDefault();
        e.stopPropagation();
        var currentRect = logoRow.getBoundingClientRect();
        try {
          localStorage.setItem('dsh_mobile_nav_top', String(Math.round(currentRect.top)));
        } catch (err) {}
      }
    }

    logoRow.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { capture: true });

    logoRow.addEventListener('mousedown', onTouchStart);
    window.addEventListener('mousemove', onTouchMove);
    window.addEventListener('mouseup', onTouchEnd, { capture: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDraggableNav);
  } else {
    initDraggableNav();
  }
  setInterval(initDraggableNav, 800);
})();
`

/**
 * 挂载底层 http.Server 门禁劫持与回环上下文虚拟化代理
 * 
 * @param server - 底层 Node.js http.Server 实例
 * @param gateMiddleware - 全局安全门禁拦截器函数
 * @param store - 会话与配置管理器实例
 */
export function patchHttpServerWithVirtualizer(
  server: any,
  gateMiddleware: (req: IncomingMessage, res: ServerResponse, next?: () => void) => boolean,
  _store: SessionStore,
  styleStore?: StyleSnippetStore,
): void {
  if (!server || server.__dsh_tailscale_gate_patched__) return
  server.__dsh_tailscale_gate_patched__ = true

  // 复制并清空原有 request 事件监听器列表，确保门禁成为全链路首道关卡
  const originalListeners = server.listeners('request').slice(0)
  server.removeAllListeners('request')

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    // 0. 移动端判定（UA）与样式片段收集。
    // 样式注入与 UA 无关：collectCss() 产出按【视口宽度档】包装的 CSS
    // （mobileEnabled → @media (max-width:900px) 窄屏生效；pcEnabled → @media (min-width:901px) 宽屏生效），
    // 因此 PC 浏览器拉小窗口时移动端样式同样生效。isMobile 仍用于 data-dsh-mobile 标记与拖拽脚本注入。
    const userAgent = req.headers['user-agent'] || ''
    const isMobile = isMobileUserAgent(userAgent)
    const mobileStyleCss = styleStore ? styleStore.collectCss() : ''

    // 0. 优先在 Socket 首道关卡记录未经虚拟化篡改的真实客户端物理 IP (防止 Keep-Alive 连接复用污染)
    if (req.socket && !(req.socket as any).__dsh_real_remote_address__) {
      (req.socket as any).__dsh_real_remote_address__ = req.socket.remoteAddress
    }

    // 1. 响应层拦截：在主文档 index.html 响应流中的 <head> 首行注入 Crypto Polyfill
    const originalEnd = res.end
    let isHtml = false

    res.writeHead = ((origWriteHead: any) => {
      return function(this: ServerResponse, statusCode: number, ...args: any[]) {
        const headers = args.find((a) => typeof a === 'object' && a !== null) || {}
        const contentType = this.getHeader('content-type') || headers['content-type'] || headers['Content-Type'] || ''
        if (String(contentType).includes('text/html')) {
          isHtml = true
        }
        return (origWriteHead as any).apply(this, [statusCode, ...args])
      }
    })(res.writeHead)

    res.end = function(this: ServerResponse, chunk?: any, ...args: any[]) {
      const currentCt = this.getHeader?.('content-type') || this.getHeader?.('Content-Type') || ''
      const shouldInject = isHtml || String(currentCt).includes('text/html')

      // 是否实际改写了响应体（注入会改变 body 字节长度）
      let injected = false

      if (shouldInject && chunk) {
        if (typeof chunk === 'string' && chunk.includes('<head>')) {
          let html = chunk
          if (isMobile) html = applyDataMobileAttr(html)
          if (mobileStyleCss) {
            html = html.replace('<head>', `<head>${buildMobileStyleTag(mobileStyleCss)}`)
          }
          // 悬浮把手拖拽脚本全端注入：脚本自带“仅折叠时工作”守卫，
          // 预设按视口宽度生效后 PC 窄窗口同样需要可拖动的展开把手
          html = html.replace('<head>', `<head><script id="dsh-draggable-nav">${DRAGGABLE_NAV_SNIPPET}</script>`)
          html = html.replace('<head>', `<head><script id="dsh-crypto-polyfill">${CRYPTO_POLYFILL_SNIPPET}</script>`)
          chunk = html
          injected = true
        } else if (Buffer.isBuffer(chunk)) {
          let str = chunk.toString('utf8')
          if (str.includes('<head>')) {
            if (isMobile) str = applyDataMobileAttr(str)
            if (mobileStyleCss) {
              str = str.replace('<head>', `<head>${buildMobileStyleTag(mobileStyleCss)}`)
            }
            str = str.replace('<head>', `<head><script id="dsh-draggable-nav">${DRAGGABLE_NAV_SNIPPET}</script>`)
            str = str.replace('<head>', `<head><script id="dsh-crypto-polyfill">${CRYPTO_POLYFILL_SNIPPET}</script>`)
            chunk = Buffer.from(str, 'utf8')
            injected = true
          }
        }
      }

      // 防截断守卫：仅当头部尚未发出时移除显式的 Content-Length，
      // 让 Node 按最终 body 重新计算长度（writeHead 已发出后 removeHeader 无效，属不可挽救场景）
      if (injected && !(this as any).headersSent) {
        try {
          if (typeof this.removeHeader === 'function') this.removeHeader('content-length')
        } catch {}
      }
      return (originalEnd as any).apply(this, [chunk, ...args])
    }

    // 2. 请求层门禁判定与上下文虚拟化
    const allowed = gateMiddleware(req, res, () => {
      // 记录真实客户端来源信息（内部专用头，无条件覆盖避免伪造）
      const realIp = getClientIp(req)
      req.headers['x-dsh-real-ip'] = realIp
      req.headers['x-real-ip'] = realIp
      if (!req.headers['x-forwarded-host'] && req.headers.host) {
        req.headers['x-forwarded-host'] = req.headers.host
      }

      // 回环 socket（本机浏览器 / 本机程序）不做 Host/Origin/sec-fetch-site 洗白：
      // 保留浏览器原始同源信号，让下游自身的 CSRF 与 DNS-Rebinding 校验继续生效，
      // 防御恶意网页借道本机发起的 drive-by 跨站写与 Rebinding 攻击；虚拟化仅服务于外部合法流量。
      const isLoopbackSocket = realIp === '127.0.0.1' || realIp === '::1'

      if (!isLoopbackSocket) {
        // 虚拟化 Host 与 Origin（解决外部合法流量的 DNS-Rebinding 400 阻断与同源 host === origin 严格检查）
        const hostHeader = req.headers.host || ''
        const port = hostHeader.includes(':') ? hostHeader.split(':')[1] : '3080'
        req.headers.host = `127.0.0.1:${port}`
        if (req.headers.origin) {
          req.headers.origin = `http://127.0.0.1:${port}`
        }

        // 补齐浏览器同源探针标记（解决 task-board 等插件对 sec-fetch-site 的检查）
        if (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'cross-site') {
          req.headers['sec-fetch-site'] = 'same-origin'
        }
      } else {
        // 仅归一化本地 Host 变体（localhost / [::1] → 127.0.0.1），其余原样保留供下游校验
        const hostHeader = req.headers.host || ''
        let bareHost = hostHeader
        if (bareHost.startsWith('[')) {
          bareHost = bareHost.slice(1).split(']')[0]
        } else {
          bareHost = bareHost.split(':')[0]
        }
        bareHost = bareHost.toLowerCase()
        if (bareHost === 'localhost' || bareHost === '::1' || /^127\./.test(bareHost)) {
          const portMatch = hostHeader.match(/:(\d+)$/)
          req.headers.host = `127.0.0.1:${portMatch ? portMatch[1] : '3080'}`
          if (req.headers.origin) {
            req.headers.origin = `http://${req.headers.host}`
          }
        }
      }

      // 统一虚拟化 socket.remoteAddress 为 127.0.0.1（解除 dsh-ssh / plugin-manager 等插件写死的 loopback-only 限制）。
      // 说明：该改写仅对外部来源流量产生实际效果——真实回环请求的 remoteAddress 本就是 127.0.0.1（下方守卫使其为 no-op）；
      // drive-by 攻击者的浏览器同样真实 originating 自 127.0.0.1，socket 层无法也无需区分攻击者，
      // 跨站防御由门禁层 Origin / Sec-Fetch-Site 校验（虚拟化改写之前执行）与上方回环 Host 保留共同承担。
      if (req.socket && req.socket.remoteAddress !== '127.0.0.1') {
        try {
          Object.defineProperty(req.socket, 'remoteAddress', {
            get: () => '127.0.0.1',
            configurable: true,
          })
        } catch {}
      }

      // 放行至下游业务插件与路由分发器
      for (const listener of originalListeners) {
        listener.call(server, req, res)
      }
    })

    if (allowed === false) {
      // 请求未通过安全门禁，已在门禁层执行重定向或返回 401 拦截
    }
  })
}

/**
 * 注册 WebServer HTML 模板层的 Polyfill 注入钩子
 * 
 * @param ctx - Cordis 上下文对象
 */
export function mountIndexInjections(ctx: any): void {
  if (ctx.webServer && typeof ctx.webServer.tapIndex === 'function') {
    ctx.webServer.tapIndex((html: string) => {
      if (html.includes('<head>')) {
        return html.replace('<head>', `<head><script id="dsh-crypto-polyfill">${CRYPTO_POLYFILL_SNIPPET}</script>`)
      }
      return html
    })
  }

  ctx.on?.('webserver/index-inject', (table: any) => {
    if (Array.isArray(table)) {
      table.push({
        kind: 'script',
        placement: 'head',
        text: CRYPTO_POLYFILL_SNIPPET,
      })
    }
  })
}

/**
 * 配对桥接服务的运行时裁决状态（供 /status 接口与设置页横幅读取）
 *
 * - pending：激活窗口裁决尚未完成（启动后极短时间内的过渡态）
 * - active ：本插件已成功提供 remoteWebUiPairing 服务
 * - yielded：检测到其他插件已注册同名服务，本插件主动让出
 */
export type PairingBridgeMode = 'pending' | 'active' | 'yielded'

export interface PairingBridgeState {
  mode: PairingBridgeMode
  /** 占用服务的插件包名（可识别时）；无法识别提供方时为 null，前端回退为通用文案 */
  conflictWith: string | null
  /** 占用方的 loader entry id（可识别时），用于生成精确的 disabled: true 修复配置 */
  conflictEntryId: string | null
}

const pairingBridgeState: PairingBridgeState = {
  mode: 'pending',
  conflictWith: null,
  conflictEntryId: null,
}

/** 读取配对桥接当前裁决状态（快照） */
export function getPairingBridgeState(): PairingBridgeState {
  return { ...pairingBridgeState }
}

const PAIRING_SERVICE_NAME = 'remoteWebUiPairing'
/** 本插件在 loader 树中的模块名（从“兄弟 entry 尚未落定”判定中排除自身） */
export const PLUGIN_MODULE_NAME = 'dsh-remote-mobile'
/**
 * Cordis Fiber 运行态镜像（跨包 const enum 无运行时对象）：
 * 0=PENDING，1=LOADING，2=ACTIVE，3=FAILED
 */
const FIBER_STATE_PENDING = 0
const FIBER_STATE_LOADING = 1
/** 最短观察期：给并发创建中的兄弟 loader entry 留出出现时间 */
const MIN_SETTLE_GRACE_MS = 600
/** 激活窗口硬性兜底时限（超过即按“无其他注册者”处理） */
const BRIDGE_MAX_WAIT_MS = 10000
/** 裁决轮询间隔 */
const BRIDGE_DECISION_POLL_MS = 200

/**
 * 向 Cordis 容器桥接注册 remoteWebUiPairing 服务（延迟裁决版，通用共存保护）
 *
 * 背景：remoteWebUiPairing 是远程/Web 接入类插件的通用共享服务名（生态插件经
 * inject 消费）。任何其他插件先注册同名服务后，本插件再
 * 注册必然抛错；而 loader 以 Promise.allSettled 并发激活全部 entry，任一失败会
 * 回滚整棵插件树并使进程退出（致命）。
 *
 * 因此这里不「立即抢注」，而是轮询裁决：
 * 1. 服务名已被占用 → 让出（mode: yielded），并尽力定位提供方包名供界面提示；
 * 2. 兄弟 entry 全部落定且无人注册（未安装 / 被禁用 / 自身激活失败）→ 接管；
 * 3. 最长等待 BRIDGE_MAX_WAIT_MS 兜底；极端竞速下若注册瞬间输给对方，
 *    捕获异常同样按让出处理，绝不向外抛错。
 *
 * 判定完全基于 Cordis 公开运行时结构（服务名占用 + fiber 运行态），不针对
 * 任何特定第三方插件。
 *
 * @param ctx - Cordis 上下文对象
 * @param store - 会话管理器实例
 */
export function registerRemoteWebUiPairingBridge(ctx: any, store: SessionStore): void {
  const startedAt = Date.now()
  let settled = false
  let timer: any = null

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const settleYielded = (provider: { name: string | null; id: string | null }) => {
    if (settled) return
    settled = true
    clearTimer()
    pairingBridgeState.mode = 'yielded'
    pairingBridgeState.conflictWith = provider.name
    pairingBridgeState.conflictEntryId = provider.id
    ctx?.logger?.warn?.(
      `[dsh-remote-mobile] 检测到${provider.name ? ` ${provider.name} ` : '其他插件'}已注册 "${PAIRING_SERVICE_NAME}" 配对共享服务：` +
        '本插件已自动让出以避免启动冲突。两套远程接入功能并存可能出现重复入口，建议保留其一（禁用其中一款远程插件后重启）。详见设置页顶部提示。'
    )
  }

  const settleActive = () => {
    if (settled) return
    settled = true
    clearTimer()
    pairingBridgeState.mode = 'active'
    pairingBridgeState.conflictWith = null
    ctx?.logger?.info?.(`[dsh-remote-mobile] ${PAIRING_SERVICE_NAME} 配对共享服务已由本插件提供（生态插件免登互通可用）`)
  }

  const serviceTaken = (): boolean => {
    try {
      // ctx.get 对未注册服务返回 undefined 而不抛错；strict 模式只认激活中的提供者
      return Boolean(ctx?.get?.(PAIRING_SERVICE_NAME))
    } catch {
      return false
    }
  }

  const getLoaderEntries = (): any[] => {
    try {
      const loader = typeof ctx?.get === 'function' ? ctx.get('loader') : undefined
      if (loader && typeof loader.entries === 'function') return [...loader.entries()]
    } catch {}
    return []
  }

  /**
   * 定位当前占用 PAIRING_SERVICE_NAME 的插件（包名 + loader entry id）：
   * provide() 会把服务实现记录在提供方的 fiber.store 上（cordis 公开行为），
   * 据此无需针对特定插件做识别。entry id 用于生成精确的 disabled: true 修复配置。
   * 找不到则返回 { name: null, id: null }（前端回退通用文案）。
   */
  const findProviderEntry = (): { name: string | null; id: string | null } => {
    for (const entry of getLoaderEntries()) {
      try {
        const opts = entry?.options
        if (!opts || opts.group) continue
        if (entry.fiber?.store?.[PAIRING_SERVICE_NAME]) {
          const name = typeof opts.name === 'string' ? opts.name : ''
          const id = typeof entry.id === 'string' && entry.id ? entry.id : null
          return { name: name || null, id }
        }
      } catch {}
    }
    return { name: null, id: null }
  }

  /**
   * 是否仍存在「尚未落定」的其他启用插件 entry（fiber 未挂上 / PENDING /
   * LOADING）。全部落定前抢注服务有输给慢加载插件的风险，因此等待；
   * 自身 entry 通过模块名与对象身份双通道排除。
   */
  const othersSettling = (): boolean => {
    for (const entry of getLoaderEntries()) {
      try {
        const opts = entry?.options
        if (!opts || opts.group) continue
        if (opts.name === PLUGIN_MODULE_NAME) continue
        if (ctx?.fiber && entry === ctx.fiber.entry) continue
        if (entry.disabled) continue
        const state = entry.fiber?.state
        if (!entry.fiber || state === FIBER_STATE_PENDING || state === FIBER_STATE_LOADING) return true
      } catch {}
    }
    return false
  }

  const tryRegisterOurs = async (): Promise<void> => {
    if (settled) return
    // 双重检查：对方可能刚好在我们裁决前完成同步注册
    if (serviceTaken()) return settleYielded(findProviderEntry())
    try {
      // 经 new Function 动态导入，避免打包期解析内部模块说明符
      const importCordis = new Function('return import("@deepseek-ai/cordis")')
      const m: any = await importCordis()
      const ServiceClass = m?.Service || ctx?.constructor?.Service
      if (!ServiceClass) throw new Error('cordis Service unavailable')

      class RemoteWebUiPairingBridge extends ServiceClass {
        constructor(c: any) {
          super(c, PAIRING_SERVICE_NAME)
        }

        isPairedDevice(req: any): boolean {
          const clientIp = getClientIp(req)
          const options = store.getOptions()
          // 1. 免密直连设备自动放行
          if (options.allowTailscale && isTailscaleIp(clientIp)) return true
          if (options.allowLan && isLanIp(clientIp)) return true
          // 2. 已通过配对码/长期密码认证的设备放行
          const token = store.extractTokenFromRequest(req)
          if (token && store.validateToken(token, clientIp)) return true
          return false
        }
      }

      new RemoteWebUiPairingBridge(ctx)
      settleActive()
    } catch (error) {
      // 输掉最后时刻的竞速 → 让出；其余错误仅降级（安全门禁不依赖该服务），绝不向外抛错
      if (serviceTaken()) return settleYielded(findProviderEntry())
      settled = true
      clearTimer()
      pairingBridgeState.mode = 'active'
      pairingBridgeState.conflictWith = null
      ctx?.logger?.warn?.(
        `[dsh-remote-mobile] ${PAIRING_SERVICE_NAME} 服务注册失败（不影响本插件安全门禁与远程接入）: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  const decide = async (): Promise<void> => {
    if (settled) return
    if (serviceTaken()) return settleYielded(findProviderEntry())

    const elapsed = Date.now() - startedAt

    // 满足任一条件即接管：兄弟 entry 全部落定（过了最短观察期）或到达兜底时限
    if ((elapsed >= MIN_SETTLE_GRACE_MS && !othersSettling()) || elapsed >= BRIDGE_MAX_WAIT_MS) {
      return tryRegisterOurs()
    }

    timer = setTimeout(() => { decide().catch(() => {}) }, BRIDGE_DECISION_POLL_MS)
    if (typeof timer.unref === 'function') timer.unref()
  }

  decide().catch(() => {})
}
