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
 *    - 对通过认证（已扫码配对 / 长期密码 / 免密直连）的合法外部请求，在进入下游各业务插件前，
 *      统一将 Host、Origin、Socket RemoteAddress 及 Sec-Fetch-Site 规范化虚拟为 127.0.0.1 回环特征；
 *    - 彻底解除底层 WebServer 的 DNS-Rebinding 阻断，以及第三方插件写死的 loopback-only 403 限制。
 *
 * 4. 【移动端样式片段注入 (Mobile Style Snippets Injection)】：
 *    - 在网关响应层按 User-Agent 判定移动端，向主工作区 index.html 与 /auth 登录页
 *      注入可拼装去重的 CSS 片段（内置预设 + 用户自定义，见 styles/style-snippets.ts），
 *      并给 <html> 打上 data-dsh-mobile 标记供样式选择器使用。
 *
 * 3. 【Cordis 服务桥接 (remoteWebUiPairing Bridge)】：
 *    - 在用户关闭旧版 @linxin666/dsh-remote-web-ui 的情况下，以标准 Cordis Service 模式向全局暴露 remoteWebUiPairing 服务；
 *    - 实现宠物插件 (dsh-pet)、任务看板 (task-board) 等第三方生态组件与本插件授权状态的 100% 互通。
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
      req.headers['x-dsh-real-ip'] = getClientIp(req)
      req.headers['x-real-ip'] = req.headers['x-dsh-real-ip']
      if (!req.headers['x-forwarded-host'] && req.headers.host) {
        req.headers['x-forwarded-host'] = req.headers.host
      }

      // 虚拟化 Host 与 Origin（解决 DNS-Rebinding 400 阻断与同源 host === origin 严格检查）
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

      // 统一虚拟化 socket.remoteAddress 为 127.0.0.1（解除 dsh-ssh / plugin-manager 等插件写死的 loopback-only 限制）
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
 * 向 Cordis 容器桥接注册 remoteWebUiPairing 服务
 * 完美兼容 @linxin666 生态插件（如 dsh-pet 宠物、面板插件等），实现免登信任自动共享
 * 
 * @param ctx - Cordis 上下文对象
 * @param store - 会话管理器实例
 */
export function registerRemoteWebUiPairingBridge(ctx: any, store: SessionStore): void {
  try {
    const importCordis = new Function('return import("@deepseek-ai/cordis")')
    importCordis().then((m: any) => {
      const ServiceClass = m?.Service || ctx?.constructor?.Service
      if (ServiceClass) {
        class RemoteWebUiPairingBridge extends ServiceClass {
          constructor(c: any) {
            super(c, 'remoteWebUiPairing')
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
      }
    }).catch(() => {})
  } catch {}
}
