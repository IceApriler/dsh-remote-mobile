import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTailscaleIp, isLanIp, getClientIp } from './tailscale.js'
import type { SessionStore } from './token.js'

/**
 * 判断请求是否来自本机回环
 */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const ip = getClientIp(req)
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost'
}

const STATIC_ASSET_EXT_REGEX = /\.(js|mjs|cjs|css|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|otf|map|json|txt|wasm)$/i

/**
 * 判断是否为无需鉴权的公开静态/登录路径
 */
export function isPublicPath(url = ''): boolean {
  const pathname = url.split('?')[0]
  if (pathname === '/auth') return true
  if (pathname.startsWith('/api/remote-mobile/public-key')) return true
  if (pathname.startsWith('/api/remote-mobile/verify')) return true
  if (pathname.startsWith('/plugins/') && STATIC_ASSET_EXT_REGEX.test(pathname)) return true
  if (pathname.startsWith('/assets/')) return true
  if (pathname === '/favicon.ico') return true
  return false
}

/**
 * 构造全局 HTTP & WebSocket 门禁拦截处理器
 */
export function createGlobalAuthGate(store: SessionStore) {
  return function authGateMiddleware(req: IncomingMessage, res: ServerResponse, next?: () => void): boolean {
    const pass = () => {
      if (typeof next === 'function') next()
      return true
    }

    // 1. 本机 127.0.0.1 回环无条件放行（保证本机 PC 始终可用）
    if (isLoopbackRequest(req)) {
      return pass()
    }

    // 2. 公开登录页面与认证接口放行
    if (isPublicPath(req.url)) {
      return pass()
    }

    const clientIp = getClientIp(req)
    const options = store.getOptions()

    // 3. 如果开启了 Tailscale 私网免密直连，且客户端来源是 Tailscale 虚拟网段，自动归因并放行
    if (options.allowTailscale && isTailscaleIp(clientIp)) {
      const ua = req.headers['user-agent'] || ''
      store.registerBypassDevice(clientIp, ua, 'Tailscale')
      return pass()
    }

    // 4. 如果开启了局域网 LAN 免密直连，且客户端来源是局域网私有网段 (10.x / 172.16-31.x / 192.168.x)，自动归因并放行
    if (options.allowLan && isLanIp(clientIp)) {
      const ua = req.headers['user-agent'] || ''
      store.registerBypassDevice(clientIp, ua, 'LAN')
      return pass()
    }

    // 5. 检查是否携带有效的授权会话 Token (Cookie / Header / URL Token)
    const token = store.extractTokenFromRequest(req)
    if (token && store.validateToken(token, clientIp)) {
      return pass()
    }

    // 5. 未授权访问拦截处理：
    // 只有主文档请求（GET 根路径或请求头明确包含 text/html）才 302 重定向到 /auth 登录页，子资源与 API 请求一律返回 401
    const accept = req.headers['accept'] || ''
    const isHtmlRequest = req.method === 'GET' && (accept.includes('text/html') || req.url === '/' || req.url?.startsWith('/?'))

    if (isHtmlRequest) {
      res.writeHead(302, {
        Location: '/auth',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      res.end()
      return false
    }

    res.writeHead(401, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    })
    res.end(JSON.stringify({
      error: 'Unauthorized',
      message: '设备未授权或会话已注销，请前往 /auth 重新配对。',
    }))
    return false
  }
}
