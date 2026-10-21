import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTailscaleIp, isLanIp, getClientIp, getAllNetworkIps } from './tailscale.js'
import type { SessionStore } from './token.js'
import { resolveRedirectPath } from './prefix.js'

/**
 * 判断请求是否来自本机回环。
 *
 * 不能只看 socket：同机反向代理同样从 127.0.0.1 连入，但 Host/Forwarded 头
 * 指向外部域名。若仍按回环无条件放行，会把所有反代外部用户当成本机。
 *
 * 规则：
 * - 受信网关（底座补丁校验 Secret 后打标）始终按回环处理；
 * - 物理回环 + 本地 Host（localhost、127.x、::1）且无 Forwarded 头 → 本机；
 * - 物理回环 + 外部 Host 或 X-Forwarded-* / X-Real-IP → 按外部/反代处理，走正常鉴权。
 */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const ip = getClientIp(req)
  const socketIsLoopback = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost'
  if (!socketIsLoopback) return false

  // 底座补丁已用网关内部 Secret 验证该请求来自受信 Gateway
  if ((req as any).__dsh_rm_trusted_gateway__) return true

  const host = extractBareHostname(req.headers.host)
  if (host && !isLocalVariant(host)) return false

  // 注意：插件自身会为 loopback 请求注入 x-forwarded-for / x-real-ip /
  // x-forwarded-host（值均为 127.0.0.1），不能把“存在 Forwarded 头”直接
  // 等同于“同机反向代理”，否则会误伤 3080 根路径的 connection 鉴权。
  // 只有转发值指向外部主机/外部 IP，或出现 X-Forwarded-Proto 时，才判为代理。
  const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for'])
  if (forwardedFor && !isLoopbackIpValue(forwardedFor)) return false

  const realIp = firstHeaderValue(req.headers['x-real-ip'])
  if (realIp && !isLoopbackIpValue(realIp)) return false

  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host'])
  if (forwardedHost) {
    const bareForwardedHost = extractBareHostname(forwardedHost)
    if (!bareForwardedHost || !isLocalVariant(bareForwardedHost)) return false
  }

  // X-Forwarded-Proto 由反向代理/TLS 终结器写入；插件自身不会为 loopback 注入
  if (firstHeaderValue(req.headers['x-forwarded-proto'])) return false

  return true
}

/** 取请求头首个值（兼容 Node 合并的数组形式） */
function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] || '').trim()
  return typeof value === 'string' ? value.trim() : ''
}

/** 判断一个转发头 IP 是否仍是本机回环地址 */
function isLoopbackIpValue(value: string): boolean {
  const first = value.split(',')[0].trim()
  if (!first) return false
  const clean = first
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/^::ffff:/i, '')
    .toLowerCase()
  return isLocalVariant(clean)
}

const STATIC_ASSET_EXT_REGEX = /\.(js|mjs|cjs|css|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|otf|map|json|txt|wasm)$/i


/**
 * 提取主机名（去除端口与 IPv6 方括号）
 */
export function extractBareHostname(hostWithPort = ''): string {
  if (!hostWithPort) return ''
  let host = hostWithPort.trim()
  if (host.startsWith('[')) {
    host = host.slice(1).split(']')[0]
  } else {
    host = host.split(':')[0]
  }
  // 去除通配符 *. 与末尾 FQDN 点
  return host.replace(/^\*\./, '').replace(/\.+$/, '').toLowerCase()
}

/**
 * 提取端口号字符串
 */
export function extractPortString(hostWithPort = ''): string {
  if (!hostWithPort) return ''
  const trimmed = hostWithPort.trim()
  if (trimmed.startsWith('[')) {
    const after = trimmed.split(']')[1]
    return after && after.startsWith(':') ? after.slice(1) : ''
  }
  return trimmed.includes(':') ? trimmed.split(':')[1] : ''
}

/**
 * 判断主机是否属于本地回环变体 (localhost, 127.*, ::1 等)
 */
function isLocalVariant(hostname = ''): boolean {
  if (!hostname) return false
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '0:0:0:0:0:0:0:1' ||
    hostname === '127.0.0.1' ||
    /^127\./.test(hostname)
  )
}

/**
 * 获取外部请求的有效协议（兼容 Nginx / Caddy / Tailscale Serve 等反代的 X-Forwarded-Proto）。
 *
 * 注意：该值用于同源判断与重定向，不用于认证。反向代理应正确设置 X-Forwarded-Proto；
 * 直接 HTTP 访问没有该头时按 http 处理。
 */
export function getRequestProtocol(req: IncomingMessage): 'http' | 'https' {
  const raw = req?.headers?.['x-forwarded-proto']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value === 'string' && value.split(',')[0].trim().toLowerCase() === 'https') {
    return 'https'
  }
  if ((req as any)?.socket?.encrypted) return 'https'
  return 'http'
}

/**
 * 判断两个 Authority (host:port) 是否同源或属于本地回环等价。
 *
 * 当同时提供 Origin/请求的协议时，先严格比较协议，杜绝 http↔https 跨协议 CSRF；
 * 并仅按对应协议的默认端口（http:80 / https:443）做反向代理兼容。
 * 未提供协议时只做精确 authority 比较，不做默认端口放宽。
 */
export function isSameOriginOrLocalEquivalent(
  originAuthority: string,
  requestHost: string,
  originProtocol?: string,
  requestProtocol?: string
): boolean {
  if (!originAuthority || !requestHost) return false

  const originScheme = String(originProtocol || '').replace(/:$/, '').toLowerCase()
  const requestScheme = String(requestProtocol || '').replace(/:$/, '').toLowerCase()
  if (originScheme && requestScheme && originScheme !== requestScheme) return false

  if (originAuthority.toLowerCase() === requestHost.toLowerCase()) return true

  const origHost = extractBareHostname(originAuthority)
  const reqHost = extractBareHostname(requestHost)
  const origPort = extractPortString(originAuthority)
  const reqPort = extractPortString(requestHost)
  const defaultPort = originScheme === 'https' ? '443' : originScheme === 'http' ? '80' : ''
  const isDefaultPort = (port: string) => Boolean(defaultPort) && port === defaultPort

  // 外部主机：裸主机名相同，且端口相同或一方省略、另一方为该 Origin 协议的默认端口
  if (origHost && origHost === reqHost) {
    if (origPort === reqPort) return true
    if (isDefaultPort(origPort) && reqPort === '') return true
    if (origPort === '' && isDefaultPort(reqPort)) return true
  }

  // 本地变体等价判断：host 均属本地变体，且端口相同或为该协议的默认端口
  if (isLocalVariant(origHost) && isLocalVariant(reqHost)) {
    if (origPort === reqPort) return true
    if (isDefaultPort(origPort) && reqPort === '') return true
    if (origPort === '' && isDefaultPort(reqPort)) return true
  }

  return false
}

/**
 * 判断请求 Host 是否属于受信任主机（本机回环、本机网卡 IP、Tailscale IP 或静态 trustedHosts）。
 *
 * 该函数只校验主机名，不强制校验端口：反向代理、端口映射、TLS 终结场景的
 * 外部端口通常不是网关实际 boundPort，端口不应作为 DNS-Rebinding 的信任边界。
 */
export function isTrustedHost(
  hostHeader: string | undefined,
  store: SessionStore,
  extraHosts: string[] = []
): boolean {
  const host = extractBareHostname(hostHeader)
  if (!host) return false
  // 通配地址永远不能被当作受信任 Host
  if (host === '0.0.0.0' || host === '::') return false

  if (isLocalVariant(host)) return true

  try {
    const networkIps = getAllNetworkIps().map((i) => i.ip.toLowerCase())
    if (networkIps.includes(host)) return true
  } catch {}

  try {
    const statics = (store.getOptions().trustedHosts || [])
      .map((h) => extractBareHostname(String(h)))
      .filter((h) => Boolean(h) && h !== '0.0.0.0' && h !== '::')
    if (statics.includes(host)) return true
  } catch {}

  const extras = extraHosts
    .map((h) => extractBareHostname(String(h)))
    .filter((h) => Boolean(h) && h !== '0.0.0.0' && h !== '::')
  return extras.includes(host)
}

/**
 * 判断请求是否携带浏览器跨站信号（用于回环 CSRF / drive-by 防御）。
 *
 * Origin 与 Sec-Fetch-Site 由浏览器强制填写，页面脚本无法伪造或隐藏；
 * 恶意网页驱使浏览器向本机回环发起的写请求必然携带这些信号。
 */
export function hasCrossSiteSignal(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin) {
    if (origin === 'null') return true // 沙箱 iframe 等场景的不透明 Origin，一律视为跨站
    try {
      const originUrl = new URL(origin)
      const reqHost = req.headers.host || ''
      return !isSameOriginOrLocalEquivalent(
        originUrl.host,
        reqHost,
        originUrl.protocol,
        getRequestProtocol(req)
      )
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
  if (pathname === '/favicon.ico' || pathname === '/manifest.webmanifest' || pathname === '/manifest.json') return true
  return false
}

/**
 * 构造全局 HTTP & WebSocket 门禁拦截处理器
 */
export function createGlobalAuthGate(store: SessionStore) {
  return function authGateMiddleware(req: IncomingMessage, res: ServerResponse, next?: () => void): boolean {
    const pass = (reason: 'loopback' | 'public' | 'bypass-tailscale' | 'bypass-lan' | 'token') => {
      ;(req as any).__dsh_rm_gate_result = reason
      if (typeof next === 'function') next()
      return true
    }

    // 0. 全局非 GET/HEAD 写请求的跨站防御（在上下文虚拟化改写之前运行，
    //    保证 Origin / Sec-Fetch-Site 为浏览器原始值）：
    //    不论回环还是外部，恶意跨站写请求（Local Drive-by / CSWSH）直接 403 阻断。
    if (req.method !== 'GET' && req.method !== 'HEAD' && hasCrossSiteSignal(req)) {
      res.writeHead(403, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      res.end(JSON.stringify({
        error: 'Forbidden',
        message: '已拦截来自其他网站的跨站写请求 (Cross-Site Request Blocked)。',
      }))
      return false
    }

    // 1. 本机 127.0.0.1 回环无条件放行（保证本机 PC 始终可用）
    if (isLoopbackRequest(req)) {
      return pass('loopback')
    }

    // 1.5 非回环请求必须先通过 Host 白名单（DNS-Rebinding / 恶意 Host 防御）。
    // GatewayServer 在转发前已经用自己的 Host 白名单校验过，并打上 __dsh_rm_host_allowed__，
    // 这里避免对同一请求重复校验（尤其是 gatewayHost 为自定义域名时）。
    if (
      req.headers.host &&
      !(req as any).__dsh_rm_host_allowed__ &&
      !isTrustedHost(req.headers.host, store)
    ) {
      res.writeHead(403, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      res.end(JSON.stringify({
        error: 'Forbidden',
        message: '未受信任的 Host。若使用 Tailscale MagicDNS 或自定义域名，请在 trustedHosts 中声明。',
      }))
      return false
    }

    // 2. 公开登录页面与认证接口放行
    if (isPublicPath(req.url)) {
      return pass('public')
    }

    const clientIp = getClientIp(req)
    const options = store.getOptions()

    // 反向代理同样可能位于 LAN/Tailscale 网段；若携带 Forwarded 头，说明是代理而非
    // 真实客户端，不能再按 allowLan/allowTailscale 免密放行，否则外部用户可借代理绕过认证。
    const hasForwardedHeaders = Boolean(
      req.headers['x-forwarded-for'] ||
      req.headers['x-forwarded-host'] ||
      req.headers['x-forwarded-proto'] ||
      req.headers['x-real-ip']
    )

    // 3. 如果开启了 Tailscale 私网免密直连，且客户端来源是 Tailscale 虚拟网段，自动归因并放行
    if (!hasForwardedHeaders && options.allowTailscale && isTailscaleIp(clientIp)) {
      const ua = req.headers['user-agent'] || ''
      store.registerBypassDevice(clientIp, ua, 'Tailscale')
      return pass('bypass-tailscale')
    }

    // 4. 如果开启了局域网 LAN 免密直连，且客户端来源是局域网私有网段 (10.x / 172.16-31.x / 192.168.x)，自动归因并放行
    if (!hasForwardedHeaders && options.allowLan && isLanIp(clientIp)) {
      const ua = req.headers['user-agent'] || ''
      store.registerBypassDevice(clientIp, ua, 'LAN')
      return pass('bypass-lan')
    }

    // 5. 检查是否携带有效的授权会话 Token (Cookie / Header / URL Token)
    const token = store.extractTokenFromRequest(req)
    if (token && store.validateToken(token, clientIp)) {
      return pass('token')
    }

    // 5. 未授权访问拦截处理：
    // 只有主文档请求（GET 根路径或请求头明确包含 text/html）才 302 重定向到 /auth 登录页，子资源与 API 请求一律返回 401
    const accept = req.headers['accept'] || ''
    const isHtmlRequest = req.method === 'GET' && (accept.includes('text/html') || req.url === '/' || req.url?.startsWith('/?'))

    if (isHtmlRequest) {
      const authLocation = resolveRedirectPath(req.headers, '/auth')
      res.writeHead(302, {
        Location: authLocation,
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
