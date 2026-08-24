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

/** 插件私有变更类 API 前缀（非 GET 请求需做跨站信号校验） */
const MUTATION_API_PREFIX = '/api/remote-mobile/'

/**
 * 判断请求是否携带浏览器跨站信号（用于回环 CSRF / drive-by 防御）。
 *
 * Origin 与 Sec-Fetch-Site 由浏览器强制填写，页面脚本无法伪造或隐藏；
 * 恶意网页驱使浏览器向本机回环发起的写请求必然携带这些信号。
 * 不带这些头的客户端（curl / 本机脚本 / 旧内核 WebView）不受影响，保持向后兼容。
 *
 * 说明（有意取舍，非缺陷）：
 * - 仅比较 host:port，不比较 scheme：插件主要运行于 HTTP 局域网/回环场景，
 *   同 host:port 下出现 HTTPS 恶意来源的现实可能性极低；
 * - 无 Origin 时仅将 Sec-Fetch-Site: cross-site 判为跨站，same-site 不拦截：
 *   回环场景无域名层级概念，子域场景不适用；收紧为「非 same-origin 即拦截」
 *   会误伤不发送这些头的旧内核 WebView，与向后兼容目标冲突。
 */
export function hasCrossSiteSignal(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin) {
    if (origin === 'null') return true // 沙箱 iframe 等场景的不透明 Origin，一律视为跨站
    try {
      const originHost = new URL(origin).host
      return originHost !== '' && originHost !== (req.headers.host || '')
    } catch {
      return true // 无法解析的 Origin 视为不可信
    }
  }
  return req.headers['sec-fetch-site'] === 'cross-site'
}

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

    // 0. 变更类插件 API 的跨站写请求防御（先于回环放行，且运行在上下文虚拟化改写之前，
    //    保证 Origin / Sec-Fetch-Site 为浏览器原始值）：本机回环虽免认证，但恶意网页驱使
    //    浏览器发起的跨站写请求（drive-by）必然携带跨站信号，在此直接拒绝。
    const pathname = (req.url || '').split('?')[0]
    if (
      pathname.startsWith(MUTATION_API_PREFIX) &&
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      hasCrossSiteSignal(req)
    ) {
      res.writeHead(403, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      res.end(JSON.stringify({
        error: 'Forbidden',
        message: '已拦截来自其他网站的跨站写请求。',
      }))
      return false
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
