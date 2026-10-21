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
import net from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import zlib from 'node:zlib'
import type { SessionStore } from '../auth/token.js'
import { getPhysicalSocketIp, getClientIp, isTailscaleIp, isLanIp, getAllNetworkIps } from '../auth/tailscale.js'
import { getGatewaySecret, safeCompareSecret } from '../gateway/secret.js'
import {
  extractBareHostname,
  extractPortString,
  isLoopbackRequest,
  isTrustedHost,
  hasCrossSiteSignal,
  getRequestProtocol,
} from '../auth/gate.js'
export { extractBareHostname, extractPortString }

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
 * 注入到 index.html <head> 最前列的 Clipboard API Polyfill 脚本
 * 针对非安全上下文（HTTP + 外部 IP，如 Tailscale / 局域网）下
 * navigator.clipboard 为 undefined 的场景：提供 execCommand('copy') 降级实现，
 * 避免官方 bundle 直接调用 navigator.clipboard.writeText 时抛
 * "Cannot read properties of undefined (reading 'writeText')" 崩溃。
 * 原生可用时不做任何替换。
 */
export const CLIPBOARD_POLYFILL_SNIPPET = `
(function() {
  if (typeof navigator === "undefined") return;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") return;
    var writeText = function(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = String(text == null ? '' : text);
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
      } catch (err) {
        return Promise.reject(err);
      }
    };
    var readText = function() {
      return Promise.reject(new Error('clipboard readText is not supported in insecure context'));
    };
    try {
      if (!navigator.clipboard) navigator.clipboard = {};
      if (typeof navigator.clipboard.writeText !== "function") navigator.clipboard.writeText = writeText;
      if (typeof navigator.clipboard.readText !== "function") navigator.clipboard.readText = readText;
    } catch (err) {
      try {
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: writeText, readText: readText },
          configurable: true,
        });
      } catch (err2) {}
    }
  } catch (err) {}
})();
`

/**
 * 注入到 index.html <head> 最前列的生态插件 remote-web-ui 移动端冲突防护脚本
 * 写入 sessionStorage 'dsh-remote-force-desktop' = '1'，触发对方内置的强制桌面跳过机制，
 * 避免生态插件重复渲染小鲸鱼按钮 (#dshRemoteWhale) 以及引发手势拦截冲突
 */
export const FORCE_DESKTOP_SUPPRESSION_SNIPPET = `
(function() {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem('dsh-remote-force-desktop', '1');
    }
  } catch (e) {}
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
   * 这里记录最近一次对条目内任意部位（项目名称主体 / 次级按钮 / 箭头图标）的触摸时间，
   * 并包装 HTMLButtonElement.prototype.click：短时间窗口内的程序化收起调用直接忽略。
   * 覆盖条目主体是为了让选中高亮后浮现的展开/收起箭头与新增/更多操作图标有足够的
   * 停留操作时间；用户真实点击收起按钮（浏览器合成事件不走 prototype.click）与
   * 点击抽屉外暗处收起的官方行为均不受影响。 */
  if (!window.__dshRmAntiCollapseInstalled__) {
    window.__dshRmAntiCollapseInstalled__ = true;
    var lastEntryTapAt = 0;
    document.addEventListener('pointerdown', function (e) {
      try {
        var t = e.target;
        if (!t || !t.closest) return;
        if (!t.closest('[data-pane="sidebar"], [class*="_sidebarCol"]')) return;

        // 会话条目（_sessionRow）除操作按钮（_rowActions/button等）以外的主体点击：
        // 用户意在进入/切换会话并查看正文，不拦截程序化收起（放行自动回主区）
        var isSessionRow = t.closest('[class*="_sessionRow"]');
        var isActionOrToggle = t.closest('[class*="_rowActions"], [class*="_chevron"], [class*="_arrow"], button, [role="button"]');
        if (isSessionRow && !isActionOrToggle) {
          lastEntryTapAt = 0;
          return;
        }

        var entry = t.closest('[role="treeitem"], [data-dsh-part="sidebar-entry"]');
        if (!entry) return;
        lastEntryTapAt = Date.now();
      } catch (err) {}
    }, { capture: true, passive: true });

    var protoClick = HTMLButtonElement.prototype.click;
    HTMLButtonElement.prototype.click = function () {
      try {
        var isSidebarToggle =
          this.matches('[data-dsh-responsive-part="sidebar-toggle"]') ||
          /收起侧边栏|Collapse sidebar|Open sidebar/i.test(this.getAttribute('aria-label') || '');
        if (isSidebarToggle && Date.now() - lastEntryTapAt < 900) {
          return; // 吞掉紧随工作区/操作控件点击之后的程序化收起
        }
      } catch (err) {}
      return protoClick.apply(this, arguments);
    };
  }

  function initDraggableNav() {
    var logoRow = document.querySelector('[data-pane="sidebar"] [class*="_logoRow"], [class*="_sidebarCol"] [class*="_logoRow"]');
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
      var sidebar = document.querySelector('[data-pane="sidebar"], [class*="_sidebarCol"]');
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
 * 注入到 index.html 的移动端抽屉「点外部收起」脚本
 *
 * 【设计职责】
 * 仅当 @linxin666/dsh-web-ui-all 未启用时生效——web-ui 已自带 installMobileSidebarDismiss，
 * 本脚本通过检测 style[data-dsh-compat="responsive"] 动态让位，绝不与 web-ui 叠加双份收起逻辑。
 *
 * 定位全部基于官方 CSS Modules 稳定后缀（_frame / _sidebarCol / _toggle，前缀 hash 随机、
 * 后缀稳定），不依赖 web-ui 注入的 data-pane / data-dsh-frame 属性，因此装/不装 web-ui
 * 两种环境行为一致。折叠状态沿用官方写入的 data-sidebar-collapsed 属性。
 */
export const MOBILE_DISMISS_SNIPPET = `
(function() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var frameSelector = '[class*="_frame"]';
  var sidebarSelector = '[class*="_sidebarCol"]';

  function webUiOwnsDrawer() {
    return !!document.querySelector('style[data-dsh-compat="responsive"]');
  }

  function findToggle(frame) {
    return frame.querySelector('[class*="_toggle"]') ||
      Array.prototype.filter.call(frame.querySelectorAll('button'), function (b) {
        return /收起侧边栏|Collapse sidebar|Open sidebar/i.test(b.getAttribute('aria-label') || '');
      })[0] || null;
  }

  function install(frame) {
    if (frame.__dshRmDismissInstalled__) return;
    frame.__dshRmDismissInstalled__ = true;
    var raf = 0;

    frame.addEventListener('click', function (event) {
      try {
        // web-ui 可能运行中才注入 responsive style：每次事件都复查，动态让位
        if (webUiOwnsDrawer()) return;
        var target = event.target;
        if (!target || !(target instanceof Element)) return;
        if (typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 900px)').matches) return;
        var sidebar = frame.querySelector(sidebarSelector);
        var toggle = findToggle(frame);
        if (!sidebar || !toggle) return;

        // 抽屉展开时点击正文（sidebar 外）→ 触发官方收起按钮，并拦截被吞掉的点击；
        // 找不到收起按钮时上面已 return，绝不误拦正文交互；
        // 增加对 sidebar 内部 _collapsed 的状态校验，双重保证仅在侧边栏真正展开时才拦截正文点击
        var isSidebarOpen = !frame.hasAttribute('data-sidebar-collapsed') && !sidebar.querySelector('[class*="_collapsed"]');
        if (isSidebarOpen && !sidebar.contains(target)) {
          event.preventDefault();
          event.stopPropagation();
          toggle.click();
          return;
        }
        // 点击侧边栏内次级操作图标（更多操作 ⋯ / 展开箭头等）、工作区行（_projectRow）或原生切换按钮 → 不收起抽屉
        if (target.closest('[class*="_toggle"], [class*="_rowActions"], [class*="_projectRow"], [class*="_chevron"], [class*="_arrow"], button, [role="button"]')) return;
        // 点击会话条目（_sessionRow）主体（选中会话后回主区）→ 下一帧程序化收起
        if (!target.closest('[class*="_sessionRow"], [role="treeitem"], [data-dsh-part="sidebar-entry"]')) return;
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () {
          raf = 0;
          if (!frame.hasAttribute('data-sidebar-collapsed')) toggle.click();
        });
      } catch (err) {}
    }, true);
  }

  function ensure() {
    if (webUiOwnsDrawer()) return;
    var frame = document.querySelector(frameSelector);
    if (frame) install(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensure);
  } else {
    ensure();
  }
  setInterval(ensure, 800);
})();
`

/**
 * 向 HTML 文档的 <head> 顶部安全注入样式片段与 Polyfill 脚本（自带幂等防重守卫）
 *
 * @param html - 待注入的原始 HTML 字符串
 * @param isMobile - 是否为移动端（用于追加 data-dsh-mobile 标记）
 * @param mobileStyleCss - 动态收集的样式片段 CSS（支持按视口宽度生效）
 */
export function injectHtmlPayload(
  html: string,
  isMobile: boolean = false,
  mobileStyleCss: string = ''
): string {
  if (!html || !html.includes('<head>')) return html

  let result = html
  if (isMobile) {
    result = applyDataMobileAttr(result)
  }

  // 1. 样式片段覆写（按视口宽度生效，优先且幂等）
  if (mobileStyleCss && !result.includes('id="dsh-remote-mobile-style-snippets"')) {
    result = result.replace('<head>', `<head>${buildMobileStyleTag(mobileStyleCss)}`)
  }

  // 2. 悬浮把手拖拽脚本（全端注入，内部自带仅折叠时生效守卫）
  if (!result.includes('id="dsh-draggable-nav"')) {
    result = result.replace('<head>', `<head><script id="dsh-draggable-nav">${DRAGGABLE_NAV_SNIPPET}</script>`)
  }

  // 3. 移动端抽屉「点外部收起」脚本
  if (!result.includes('id="dsh-mobile-dismiss"')) {
    result = result.replace('<head>', `<head><script id="dsh-mobile-dismiss">${MOBILE_DISMISS_SNIPPET}</script>`)
  }

  // 4. 非安全上下文 Crypto Polyfill 脚本
  if (!result.includes('id="dsh-crypto-polyfill"')) {
    result = result.replace('<head>', `<head><script id="dsh-crypto-polyfill">${CRYPTO_POLYFILL_SNIPPET}</script>`)
  }

  // 5. 非安全上下文 Clipboard Polyfill 脚本
  if (!result.includes('id="dsh-clipboard-polyfill"')) {
    result = result.replace('<head>', `<head><script id="dsh-clipboard-polyfill">${CLIPBOARD_POLYFILL_SNIPPET}</script>`)
  }

  // 6. 桌面端全家桶冲突防护脚本
  if (!result.includes('id="dsh-force-desktop-suppression"')) {
    result = result.replace('<head>', `<head><script id="dsh-force-desktop-suppression">${FORCE_DESKTOP_SUPPRESSION_SNIPPET}</script>`)
  }

  return result
}

/**
 * 挂载底层 http.Server 门禁劫持与回环上下文虚拟化代理
 * 
 * @param server - 底层 Node.js http.Server 实例
 * @param gateMiddleware - 全局安全门禁拦截器函数
 * @param store - 会话与配置管理器实例
 * @param styleStore - 样式片段管理器实例
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

    // 1. 响应层拦截：在主文档 index.html 响应流中注入样式片段与 Polyfill 脚本
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
      const contentEncoding = String(this.getHeader?.('content-encoding') || this.getHeader?.('Content-Encoding') || '').toLowerCase()

      // 是否实际改写了响应体（注入会改变 body 字节长度）
      let injected = false

      if (shouldInject && chunk) {
        if (typeof chunk === 'string' && chunk.includes('<head>')) {
          const updated = injectHtmlPayload(chunk, isMobile, mobileStyleCss)
          if (updated !== chunk) {
            chunk = updated
            injected = true
          }
        } else if (Buffer.isBuffer(chunk)) {
          // 判定是否经过压缩：Gzip (Magic Number 0x1f 0x8b) 或 Deflate
          const isGzip = contentEncoding.includes('gzip') || (chunk.length >= 2 && chunk[0] === 0x1f && chunk[1] === 0x8b)
          const isDeflate = contentEncoding.includes('deflate')

          if (isGzip) {
            try {
              const decompressed = zlib.gunzipSync(chunk).toString('utf8')
              if (decompressed.includes('<head>')) {
                const updated = injectHtmlPayload(decompressed, isMobile, mobileStyleCss)
                if (updated !== decompressed) {
                  chunk = zlib.gzipSync(Buffer.from(updated, 'utf8'))
                  injected = true
                }
              }
            } catch {}
          } else if (isDeflate) {
            try {
              const decompressed = zlib.inflateSync(chunk).toString('utf8')
              if (decompressed.includes('<head>')) {
                const updated = injectHtmlPayload(decompressed, isMobile, mobileStyleCss)
                if (updated !== decompressed) {
                  chunk = zlib.deflateSync(Buffer.from(updated, 'utf8'))
                  injected = true
                }
              }
            } catch {}
          } else {
            // 普通未压缩 Buffer
            const str = chunk.toString('utf8')
            if (str.includes('<head>')) {
              const updated = injectHtmlPayload(str, isMobile, mobileStyleCss)
              if (updated !== str) {
                chunk = Buffer.from(updated, 'utf8')
                injected = true
              }
            }
          }
        }
      }

      // 长度防截断守卫：仅当头部尚未发出时移除显式的 Content-Length，
      // 让 Node 按最终 body 重新计算长度或转为分块传输
      if (injected && !(this as any).headersSent) {
        try {
          if (typeof this.removeHeader === 'function') {
            this.removeHeader('content-length')
            this.removeHeader('Content-Length')
          }
        } catch {}
      }
      return (originalEnd as any).apply(this, [chunk, ...args])
    }

    // 1.5 在门禁判定前校验受信网关 Secret。
    // 网关转发请求同样来自物理回环，且带有 X-Forwarded-*，不能仅凭 Host/Forwarded
    // 把它误判为同机反向代理；这里用 Secret 打上受信标记，供 isLoopbackRequest 识别。
    try {
      const trustSocketIp = getPhysicalSocketIp(req)
      const trustIsLoopback = trustSocketIp === '127.0.0.1' || trustSocketIp === '::1'
      const trustSecret = getGatewaySecret(server)
      if (
        trustIsLoopback &&
        trustSecret &&
        safeCompareSecret(req.headers['x-dsh-gateway-secret'], trustSecret)
      ) {
        ;(req as any).__dsh_rm_trusted_gateway__ = true
      }
    } catch {}

    // 2. 请求层门禁判定与上下文虚拟化
    const allowed = gateMiddleware(req, res, () => {
      // 物理 Socket 连接真实 IP（严格取底层物理连接，仅去除 ::ffff: 前缀，绝不受任何头篡改）
      const physicalSocketIp = getPhysicalSocketIp(req)
      const isLoopbackSocket = physicalSocketIp === '127.0.0.1' || physicalSocketIp === '::1' || physicalSocketIp === 'localhost'

      // 网关受信密钥核验：仅当底层物理连接为本地回环且 Secret 比对一致时，才采纳网关上报的有效真实客户端 IP
      const currentSecret = getGatewaySecret(server)
      const candidateSecret = req.headers['x-dsh-gateway-secret']
      const candidateRealIp = req.headers['x-dsh-real-ip']
      const candidateIpStr = Array.isArray(candidateRealIp) ? candidateRealIp[0] : candidateRealIp

      const trustedGateway =
        isLoopbackSocket &&
        Boolean(currentSecret) &&
        safeCompareSecret(candidateSecret, currentSecret)

      let effectiveClientIp = physicalSocketIp
      if (
        trustedGateway &&
        typeof candidateIpStr === 'string' &&
        candidateIpStr.trim() !== '' &&
        net.isIP(candidateIpStr.replace(/^::ffff:/, '').trim()) !== 0
      ) {
        effectiveClientIp = candidateIpStr.replace(/^::ffff:/, '').trim()
      } else if (isLoopbackSocket && !isLoopbackRequest(req)) {
        // 同机反向代理：物理来源是 127，但 Host/Forwarded 表明是外部流量；
        // 采用代理透传的 X-Forwarded-For 首个合法 IP，恢复防暴破/审计真实来源。
        const rawXff = req.headers['x-forwarded-for']
        const value = Array.isArray(rawXff) ? rawXff[0] : rawXff
        if (typeof value === 'string') {
          const first = value.split(',')[0].trim().replace(/^::ffff:/, '')
          if (net.isIP(first)) effectiveClientIp = first
        }
      } else if (!isLoopbackSocket && req.headers['x-forwarded-for']) {
        // 反向代理位于 LAN/Tailscale 网段：同样使用代理透传的真实 IP
        const rawXff = req.headers['x-forwarded-for']
        const value = Array.isArray(rawXff) ? rawXff[0] : rawXff
        if (typeof value === 'string') {
          const first = value.split(',')[0].trim().replace(/^::ffff:/, '')
          if (net.isIP(first)) effectiveClientIp = first
        }
      }

      // 同步有效客户端 IP 到三头（外部伪造的头在此被强制净化，下游生态插件与审计均可准确读取）
      req.headers['x-dsh-real-ip'] = effectiveClientIp
      req.headers['x-real-ip'] = effectiveClientIp
      req.headers['x-forwarded-for'] = effectiveClientIp

      // 消费完毕后立即抹除内部私密密钥头，防止向下游泄露
      delete req.headers['x-dsh-gateway-secret']

      if (!req.headers['x-forwarded-host'] && req.headers.host) {
        req.headers['x-forwarded-host'] = req.headers.host
      }

      // 仅当底层物理 socket 为外部来源（Direct 模式直接对公网开放）时才由底座补丁进行外部虚拟化；
      // 若底层物理 socket 为本地回环（包括本机直接访问或来自受信 Gateway 的回环转发），底座绝不无条件洗白 Origin，
      // 保证下游生态插件的 CSRF / DNS-Rebinding 校验全额生效。
      if (!isLoopbackSocket) {
        // Direct 外部直连模式下的 Host/Origin 虚拟化
        const externalProto = getRequestProtocol(req)
        const hostHeader = req.headers.host || ''
        const port = extractPortString(hostHeader) || '3080'
        req.headers.host = `127.0.0.1:${port}`
        if (req.headers.origin) {
          req.headers.origin = `${externalProto}://127.0.0.1:${port}`
        }
        if (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'cross-site') {
          req.headers['sec-fetch-site'] = 'same-origin'
        }
      } else {
        // 本地回环连接：仅成对规范化本地 Host 变体（localhost / [::1] → 127.0.0.1）
        // 关键安全原则：仅当 Origin 自身也是本地回环变体时才成对规范化；恶意的跨站 Origin（如 http://evil.com）必须 100% 原样保留！
        const hostHeader = req.headers.host || ''
        const bareHost = extractBareHostname(hostHeader)
        const isLocalHostVariant = bareHost === 'localhost' || bareHost === '::1' || /^127\./.test(bareHost)

        if (isLocalHostVariant) {
          const targetPort = extractPortString(hostHeader) || '3080'
          req.headers.host = `127.0.0.1:${targetPort}`

          if (req.headers.origin && typeof req.headers.origin === 'string') {
            try {
              const origUrl = new URL(req.headers.origin)
              const origHostname = origUrl.hostname.toLowerCase()
              const isLocalOrigin = origHostname === 'localhost' || origHostname === '::1' || /^127\./.test(origHostname)
              if (isLocalOrigin) {
                req.headers.origin = `${origUrl.protocol}//127.0.0.1:${targetPort}`
              }
              // 非本地 Origin（如 evil.com）原样保留，供下游 CSRF 检查
            } catch {}
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

  // WebSocket Upgrade 不经过上面的 request 监听器；同样需要在校验网关 Secret 后打受信标记，
  // 否则网关转发的 WS 会因为 X-Forwarded-* 被误判为同机反代，从而在底座再次要求 token。
  server.prependListener('upgrade', (req: IncomingMessage) => {
    try {
      const upgradeSocketIp = getPhysicalSocketIp(req)
      const upgradeIsLoopback = upgradeSocketIp === '127.0.0.1' || upgradeSocketIp === '::1'
      const upgradeSecret = getGatewaySecret(server)
      if (
        upgradeIsLoopback &&
        upgradeSecret &&
        safeCompareSecret(req.headers['x-dsh-gateway-secret'], upgradeSecret)
      ) {
        ;(req as any).__dsh_rm_trusted_gateway__ = true
        delete req.headers['x-dsh-gateway-secret']
      }
    } catch {}
  })
}

/**
 * 注册 WebServer HTML 模板层的样式与 Polyfill 注入钩子（在 Gzip 压缩前执行）
 * 
 * @param ctx - Cordis 上下文对象
 * @param styleStore - 样式片段管理器实例
 */
export function mountIndexInjections(ctx: any, styleStore?: StyleSnippetStore): void {
  if (!ctx || ctx.__dsh_rm_index_mounted__) return
  ctx.__dsh_rm_index_mounted__ = true
  const injectFn = (html: string) => {
    const mobileStyleCss = styleStore ? styleStore.collectCss() : ''
    // tapIndex 阶段在服务端模板渲染期执行，尚未绑定单次请求的 UA，
    // 因此 isMobile 设为 false，样式的 collectCss() 自带 @media 视口查询，
    // PC 与移动端均能完美自适应生效。
    return injectHtmlPayload(html, false, mobileStyleCss)
  }

  if (ctx.webServer && typeof ctx.webServer.tapIndex === 'function') {
    ctx.webServer.tapIndex(injectFn)
  }

  ctx.on?.('webserver/index-inject', (table: any) => {
    if (Array.isArray(table)) {
      const mobileStyleCss = styleStore ? styleStore.collectCss() : ''
      if (mobileStyleCss) {
        table.push({
          kind: 'style',
          placement: 'head',
          text: mobileStyleCss,
        })
      }
      table.push({
        kind: 'script',
        placement: 'head',
        text: CRYPTO_POLYFILL_SNIPPET,
      })
      table.push({
        kind: 'script',
        placement: 'head',
        text: CLIPBOARD_POLYFILL_SNIPPET,
      })
      table.push({
        kind: 'script',
        placement: 'head',
        text: FORCE_DESKTOP_SUPPRESSION_SNIPPET,
      })
      table.push({
        kind: 'script',
        placement: 'head',
        text: DRAGGABLE_NAV_SNIPPET,
      })
      table.push({
        kind: 'script',
        placement: 'head',
        text: MOBILE_DISMISS_SNIPPET,
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

/**
 * 恒定时间字符串比较，防止针对 secret token 的时序攻击
 */
function safeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  try {
    const bufA = Buffer.from(a, 'utf8')
    const bufB = Buffer.from(b, 'utf8')
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

/**
 * 判定一个请求是否已获得 dsh-remote-mobile 门禁授权（包括回环、免密直连与已认证会话）
 */
export function isRequestAuthorizedByGate(req: any, store: SessionStore): boolean {
  if (!req) return false

  // 0. WebSocket Upgrade 直连（direct 模式）必须先通过 Host 白名单与 Origin 同源检查。
  //    网关模式在 GatewayServer.handleUpgrade 中已完成同样的检查，并打上 __dsh_rm_host_allowed__，
  //    此处避免重复校验，同时确保 direct 模式的核心 WS 不会被 DNS-Rebinding / CSWSH 绕过。
  const isWebSocketUpgrade = String(req.headers?.upgrade || '').toLowerCase().includes('websocket')
  if (isWebSocketUpgrade && !(req as any).__dsh_rm_host_allowed__) {
    if (!isTrustedHost(req.headers.host, store) || hasCrossSiteSignal(req)) {
      return false
    }
  }

  // 1. 本机 127.0.0.1 / ::1 回环无条件放行
  if (isLoopbackRequest(req)) return true

  const clientIp = getClientIp(req)
  const options = store.getOptions()

  // 反向代理位于 LAN/Tailscale 网段时不能被当作真实客户端免密放行
  const hasForwardedHeaders = Boolean(
    req.headers?.['x-forwarded-for'] ||
    req.headers?.['x-forwarded-host'] ||
    req.headers?.['x-forwarded-proto'] ||
    req.headers?.['x-real-ip']
  )

  // 2. Tailscale 私网免密直连放行
  if (!hasForwardedHeaders && options.allowTailscale && isTailscaleIp(clientIp)) return true

  // 3. 局域网 LAN 免密直连放行
  if (!hasForwardedHeaders && options.allowLan && isLanIp(clientIp)) return true

  // 4. 检查是否携带有效的授权会话 Token (Cookie / Header / URL Token)
  const token = store.extractTokenFromRequest(req)
  if (token && store.validateToken(token, clientIp)) return true

  return false
}

/**
 * 透明接管 DSH 官方底座的 Token 鉴权服务 (connection.browserAuth & connection.requestRejection)
 *
 * 【设计职责】
 * 官方新版在底座硬编码了临时进程 Token（dsh web: http://.../?token=xxxx）以及基于签名 Cookie 的
 * 全链路 RPC/WebSocket 401 阻断。对于已安装本插件的用户而言，两层鉴权导致体验严重割裂且使手机书签失效。
 * 本函数对底层 connection 服务实施透明短路代理：
 * 1. 凡通过本插件门禁（本机、Tailscale/LAN 免密直连、已扫码配对/长期密码认证）的请求，底座鉴权全链路放行；
 * 2. 彻底消除进程重启后移动端遭遇官方 401 的痛点，对外提供唯一定制化移动端门禁体系；
 * 3. 未授权外部请求保持官方与插件原本拦截逻辑，且保留官方原生合法 token 的交换能力。
 *
 * @param connection - DSH 底座提供的 connection 服务实例
 * @param store - 会话与配置管理器实例
 */
export function takeOverConnectionAuth(connection: any, store: SessionStore): void {
  if (!connection || connection.__dsh_rm_auth_takeover__) return
  connection.__dsh_rm_auth_takeover__ = true

  // 1. 接管底层统一的 browserAuth.isAuthenticated (供各类 RPC/WebSocket 与内部检查调用)
  if (connection.browserAuth && typeof connection.browserAuth.isAuthenticated === 'function') {
    const origIsAuthenticated = connection.browserAuth.isAuthenticated.bind(connection.browserAuth)
    connection.browserAuth.isAuthenticated = (request: any): boolean => {
      if (isRequestAuthorizedByGate(request, store)) {
        return true
      }
      return origIsAuthenticated(request)
    }
  }

  // 2. 接管 connection.requestRejection (底层拦截未授权的 RPC / WebSocket 请求)
  if (typeof connection.requestRejection === 'function') {
    const origRequestRejection = connection.requestRejection.bind(connection)
    connection.requestRejection = (request: any): number | undefined => {
      if (isRequestAuthorizedByGate(request, store)) {
        return undefined // 明确放行，杜绝 401
      }
      return origRequestRejection(request)
    }
  }

  // 3. 接管 connection.authorizeIndex (控制根路径 GET / 下发 index.html)
  if (typeof connection.authorizeIndex === 'function') {
    const origAuthorizeIndex = connection.authorizeIndex.bind(connection)
    connection.authorizeIndex = (req: any, res: any): boolean => {
      if (isRequestAuthorizedByGate(req, store)) {
        // 若携带官方进程 token 且与当前 launchToken 匹配，优先走官方换取官方 Cookie 与重定向
        if (req.url && req.url.includes('token=')) {
          try {
            const url = new URL(req.url, 'http://dsh.invalid')
            const tokens = url.searchParams.getAll('token')
            if (
              tokens.length > 0 &&
              connection.browserAuth?.launchToken &&
              safeStringEqual(tokens[0], connection.browserAuth.launchToken)
            ) {
              return origAuthorizeIndex(req, res)
            }
          } catch {}
        }
        // 已授权设备直接放行提供 HTML，跳过官方 401 阻断
        return true
      }
      return origAuthorizeIndex(req, res)
    }
  }

  // 4. 动态向 DSH 底座 connection.trustedHosts 注入当前本机所有可用 IP 与网关端口
  // （适配 DSH 0.2.1+ 底层 Host/Origin 信任围栏，使外部网关合规直通，免去伪造 Host 头带来的副作用）
  injectTrustedHosts(connection, [store.getActivePort(), 3080, 3081], store.getOptions().trustedHosts)
}

/**
 * 向 DSH 运行时（webRuntime、connection、webStartup）的 trustedHosts 数组注入受信任的主机与端口
 * 
 * @param target - Cordis 上下文对象或包含 trustedHosts 的服务对象
 * @param ports - 允许访问的活跃端口（包含底座端口与网关实际绑定端口）
 * @param staticTrustedHosts - 用户静态配置的白名单（如 Tailscale MagicDNS 域名等）
 */
export function injectTrustedHosts(target: any, ports: number[] = [3080, 3081], staticTrustedHosts: string[] = []): void {
  if (!target) return

  const arraysToInject: string[][] = []

  // 1. 如果 target 本身带有 trustedHosts 数组（如 connection 或 webRuntime）
  if (Array.isArray(target.trustedHosts)) {
    arraysToInject.push(target.trustedHosts)
  }

  // 2. 如果 target 是 Cordis 上下文 ctx，检查并提取各子服务的 trustedHosts
  try {
    const wr = (typeof target.get === 'function' ? target.get('webRuntime') : undefined) || target.webRuntime
    if (wr && Array.isArray(wr.trustedHosts) && !arraysToInject.includes(wr.trustedHosts)) {
      arraysToInject.push(wr.trustedHosts)
    }

    const conn = (typeof target.get === 'function' ? target.get('connection') : undefined) || target.connection
    if (conn && Array.isArray(conn.trustedHosts) && !arraysToInject.includes(conn.trustedHosts)) {
      arraysToInject.push(conn.trustedHosts)
    }

    const ws = (typeof target.get === 'function' ? target.get('webStartup') : undefined) || target.webStartup
    if (ws && Array.isArray(ws.trustedHosts) && !arraysToInject.includes(ws.trustedHosts)) {
      arraysToInject.push(ws.trustedHosts)
    }
  } catch {}

  if (arraysToInject.length === 0) return

  try {
    const netIps = getAllNetworkIps().map((i) => i.ip)
    // 规范化静态配置的主机名：去除端口、去除末尾点、过滤通配符
    const cleanStatics = (staticTrustedHosts || [])
      .map((h) => {
        let raw = String(h).trim().toLowerCase().replace(/\.$/, '')
        if (raw.startsWith('[')) {
          const closeBracket = raw.indexOf(']')
          if (closeBracket !== -1) raw = raw.slice(1, closeBracket)
        } else if (raw.includes(':')) {
          raw = raw.split(':')[0]
        }
        return raw.trim()
      })
      .filter((h) => h && h !== '0.0.0.0' && h !== '::')

    const candidates = ['127.0.0.1', 'localhost', '::1', ...netIps, ...cleanStatics]

    for (const arr of arraysToInject) {
      for (const hostItem of candidates) {
        if (!arr.includes(hostItem)) {
          arr.push(hostItem)
        }
        for (const port of ports) {
          if (!port) continue
          const isIpv6 = hostItem.includes(':') && !hostItem.startsWith('[')
          const withPort = isIpv6 ? `[${hostItem}]:${port}` : `${hostItem}:${port}`
          if (!arr.includes(withPort)) {
            arr.push(withPort)
          }
        }
      }
    }
  } catch {}
}

