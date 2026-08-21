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
 * 3. 【Cordis 服务桥接 (remoteWebUiPairing Bridge)】：
 *    - 在用户关闭旧版 @linxin666/dsh-remote-web-ui 的情况下，以标准 Cordis Service 模式向全局暴露 remoteWebUiPairing 服务；
 *    - 实现宠物插件 (dsh-pet)、任务看板 (task-board) 等第三方生态组件与本插件授权状态的 100% 互通。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionStore } from '../auth/token.js'
import { getClientIp, isTailscaleIp, isLanIp } from '../auth/tailscale.js'

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
): void {
  if (!server || server.__dsh_tailscale_gate_patched__) return
  server.__dsh_tailscale_gate_patched__ = true

  // 复制并清空原有 request 事件监听器列表，确保门禁成为全链路首道关卡
  const originalListeners = server.listeners('request').slice(0)
  server.removeAllListeners('request')

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
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

      if (shouldInject && chunk) {
        if (typeof chunk === 'string' && chunk.includes('<head>')) {
          chunk = chunk.replace('<head>', `<head><script id="dsh-crypto-polyfill">${CRYPTO_POLYFILL_SNIPPET}</script>`)
        } else if (Buffer.isBuffer(chunk)) {
          const str = chunk.toString('utf8')
          if (str.includes('<head>')) {
            chunk = Buffer.from(str.replace('<head>', `<head><script id="dsh-crypto-polyfill">${CRYPTO_POLYFILL_SNIPPET}</script>`), 'utf8')
          }
        }
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
