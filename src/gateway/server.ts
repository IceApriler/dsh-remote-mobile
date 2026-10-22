/**
 * DSH 移动端远程独立安全接入代理服务 (GatewayServer)
 *
 * 架构定位：
 * 解决 DSH 0.2.1+ 底层强行禁止 0.0.0.0 监听的问题。
 * DSH 官方 WebServer 继续保持纯粹、安全的 127.0.0.1:3080 本地回环监听（零外部暴露风险）；
 * 由本服务在 0.0.0.0:3081 启动专用安全接入代理，接纳局域网与 Tailscale 流量，
 * 执行端到端 RSA 加密、扫码配对、慢哈希密码认证与防暴力破解 IP 熔断，
 * 并将合法的流量全双工代理至底座核心服务，彻底解决换 Wi-Fi 崩溃、无法兼顾多网卡与本机回环失效的痛点。
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { isIP, type Socket } from 'node:net'
import type { SessionStore } from '../auth/token.js'
import { getClientIp } from '../auth/tailscale.js'
import { isRequestAuthorizedByGate } from '../bridge/compat.js'
import {
  isSameOriginOrLocalEquivalent,
  isTrustedHost,
  getRequestProtocol,
  isLoopbackRequest,
} from '../auth/gate.js'
import { getGatewaySecret } from './secret.js'

export interface GatewayServerOptions {
  /** 安全接入代理监听端口，默认 3081 */
  port?: number
  /** 安全接入代理监听网络地址，默认 0.0.0.0 */
  host?: string
  /** DSH 宿主核心服务端口，默认 3080 */
  corePort: number
  /** DSH 宿主核心服务主机，默认 127.0.0.1 */
  coreHost?: string
  /** 端口冲突时是否允许自动向后递增探测，默认 true */
  autoIncrementPort?: boolean
  /** WebSocket 升级握手超时（毫秒），默认 10000ms */
  upgradeTimeoutMs?: number
}

export type GatewayServerStatus = 'stopped' | 'starting' | 'running' | 'error'

export class GatewayServer {
  private server: http.Server | null = null
  private activeSockets: Set<Socket> = new Set()
  private store: SessionStore
  private gateMiddleware: (req: IncomingMessage, res: ServerResponse, next?: () => void) => boolean
  private configuredPort: number
  private boundPort: number
  private host: string
  private corePort: number
  private coreHost: string
  private coreTargetAuthority: string
  private autoIncrementPort: boolean
  private upgradeTimeoutMs: number
  private status: GatewayServerStatus = 'stopped'
  private lastError: string | null = null
  private logger?: any

  constructor(
    options: GatewayServerOptions,
    store: SessionStore,
    gateMiddleware: (req: IncomingMessage, res: ServerResponse, next?: () => void) => boolean,
    logger?: any
  ) {
    this.configuredPort = options.port ?? 3081
    this.boundPort = this.configuredPort
    this.host = options.host ?? '0.0.0.0'
    this.corePort = options.corePort ?? 3080
    this.coreHost = options.coreHost ?? '127.0.0.1'
    this.coreTargetAuthority =
      this.coreHost.includes(':') && !this.coreHost.startsWith('[')
        ? `[${this.coreHost}]:${this.corePort}`
        : `${this.coreHost}:${this.corePort}`
    this.autoIncrementPort = options.autoIncrementPort ?? true
    this.upgradeTimeoutMs = options.upgradeTimeoutMs ?? 10000
    this.store = store
    this.gateMiddleware = gateMiddleware
    this.logger = logger
  }

  /** 获取安全接入代理当前运行状态契约 */
  public getStatus(): GatewayServerStatus {
    return this.status
  }

  /** 获取网关最近发生的异常信息 */
  public getLastError(): string | null {
    return this.lastError
  }

  /** 获取安全接入代理实际生效绑定的端口 */
  public getBoundPort(): number {
    return this.boundPort
  }

  /** 获取安全接入代理监听的 host */
  public getHost(): string {
    return this.host
  }

  /** 获取内部转发的目标核心端口 */
  public getCorePort(): number {
    return this.corePort
  }

  /** 获取内部底层 Server 实例（供测试或状态检测） */
  public getServer(): http.Server | null {
    return this.server
  }

  /**
   * 检验请求的 Host 头是否符合动态白名单（防 DNS-Rebinding 与非法主机注入）
   */
  public isHostAllowed(hostHeader?: string): boolean {
    // 只校验主机名，不强制端口等于 boundPort：
    // 反向代理、TLS 终结、路由器端口映射场景的外部端口通常不是 3081，
    // 端口不应作为 DNS-Rebinding 的信任边界。网关配置的特定监听 Host 作为额外白名单。
    const extraHosts =
      this.host && this.host !== '0.0.0.0' && this.host !== '::' ? [this.host] : []
    return isTrustedHost(hostHeader, this.store, extraHosts)
  }

  /**
   * 获取外部访问协议（兼容 Nginx / Caddy / Tailscale Serve 等反代的 X-Forwarded-Proto）
   */
  private getExternalProtocol(req: IncomingMessage): 'http' | 'https' {
    return getRequestProtocol(req)
  }

  /**
   * 计算转发到底座的真实客户端 IP。
   *
   * 正常 LAN/Tailscale 客户端直接连网关，socket IP 即真实 IP；
   * 同机反向代理从 127.0.0.1 连入时，若门禁已判定为非回环（Host/Forwarded 表明是代理），
   * 则采用 X-Forwarded-For 首个合法 IP，恢复防暴破/审计的真实来源。
   */
  private getEffectiveClientIp(req: IncomingMessage, useForwardedFor: boolean): string {
    if (useForwardedFor) {
      const raw = req.headers['x-forwarded-for']
      const value = Array.isArray(raw) ? raw[0] : raw
      if (typeof value === 'string') {
        const first = value.split(',')[0].trim().replace(/^::ffff:/, '')
        if (isIP(first)) return first
      }
    }
    return getClientIp(req)
  }

  /** 请求是否携带反向代理透传头 */
  private hasForwardedHeaders(req: IncomingMessage): boolean {
    return Boolean(
      req.headers['x-forwarded-for'] ||
      req.headers['x-forwarded-host'] ||
      req.headers['x-forwarded-proto'] ||
      req.headers['x-real-ip']
    )
  }

  /**
   * 启动安全接入代理服务（带端口冲突自愈探测与状态机落定）
   */
  public async start(): Promise<{ port: number; host: string }> {
    if (this.server && this.status === 'running') {
      return { port: this.boundPort, host: this.host }
    }

    this.status = 'starting'
    this.lastError = null

    const server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res)
    })

    server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head)
    })

    server.on('connection', (socket: Socket) => {
      this.activeSockets.add(socket)
      socket.on('close', () => {
        this.activeSockets.delete(socket)
      })
    })

    this.server = server

    const maxTries = this.autoIncrementPort ? 10 : 1
    let currentPort = this.configuredPort

    for (let attempt = 0; attempt < maxTries; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', (err: any) => {
            reject(err)
          })
          server.listen(currentPort, this.host, () => {
            resolve()
          })
        })

        const addr = server.address()
        this.boundPort = addr && typeof addr === 'object' ? addr.port : currentPort
        this.status = 'running'
        this.logger?.info?.(
          `[dsh-remote-mobile] 安全接入代理已就绪: http://${this.host}:${this.boundPort} -> ${this.coreHost}:${this.corePort}`
        )
        return { port: this.boundPort, host: this.host }
      } catch (err: any) {
        if (err.code === 'EADDRINUSE' && attempt < maxTries - 1 && currentPort > 0) {
          this.logger?.warn?.(`[dsh-remote-mobile] 端口 ${currentPort} 已被占用，尝试自增探测端口 ${currentPort + 1}...`)
          currentPort++
          continue
        }
        this.status = 'error'
        this.lastError = err?.message || String(err)
        this.server = null
        throw err
      }
    }

    this.status = 'error'
    this.lastError = `尝试端口均被占用 (${this.configuredPort} ~ ${currentPort})`
    throw new Error(`[dsh-remote-mobile] 启动安全接入代理失败：${this.lastError}`)
  }

  /**
   * 优雅关闭安全接入代理，立即释放端口与所有客户端 Socket
   */
  public async close(): Promise<void> {
    if (!this.server) {
      this.status = 'stopped'
      return
    }

    // 1. 遍历销毁所有保持活跃的连接（包括 Keep-Alive 与长连接 WebSocket）
    for (const socket of this.activeSockets) {
      try {
        socket.destroy()
      } catch {}
    }
    this.activeSockets.clear()

    // 2. 彻底关闭 Server 监听
    const s = this.server
    this.server = null
    this.status = 'stopped'

    await new Promise<void>((resolve) => {
      s.close(() => resolve())
    })
  }

  /**
   * 处理 HTTP 请求：
   * 1. 严格校验 Host 白名单（阻断 DNS-Rebinding）
   * 2. 执行安全门禁 gateMiddleware 与跨站写拦截
   * 3. 构造请求头：抹除客户端伪造 Secret，注入真实 IP 与内部有效握手密钥
   * 4. 实施成对虚拟化决策矩阵
   * 5. 转发到底座并流式透明 Pipe
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const originalHost = req.headers.host || ''

    // 1. Host 校验：不在有效网络白名单内的未知域名直接 400 阻断
    if (!this.isHostAllowed(originalHost)) {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      res.end(
        JSON.stringify({
          error: 'Bad Request',
          message: `未受信任的主机名: "${originalHost}"。若使用 Tailscale MagicDNS 或自定义域名，请在插件设置中的 trustedHosts 声明。`,
        })
      )
      return
    }

    // 网关已完成 Host 白名单校验，通知共享门禁跳过重复 Host 校验
    // （proxyHost 可能是自定义域名，不属于核心的 trustedHosts / 网卡 IP）
    ;(req as any).__dsh_rm_host_allowed__ = true

    // 2. 门禁中间件校验与原因标记获取
    this.gateMiddleware(req, res, () => {
      this.proxyHttpRequest(req, res)
    })
  }

  /**
   * 转发已授权的 HTTP 请求至 DSH 本地核心服务
   */
  private proxyHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const originalHost = req.headers.host || ''
    const externalProto = this.getExternalProtocol(req)
    const gateResult = (req as any).__dsh_rm_gate_result || 'public'
    // 以门禁判定结果为准：同机反代会从 127 连入但 Host/Forwarded 指向外部，
    // 不能被误当成 loopback 本机流量。
    const isLoopbackClient = gateResult === 'loopback'
    const clientIp = this.getEffectiveClientIp(
      req,
      !isLoopbackClient && this.hasForwardedHeaders(req)
    )

    // 构造发往内部核心的请求头
    const proxyHeaders: Record<string, string | string[] | undefined> = { ...req.headers }

    // 强制消除客户端可能伪造的内部网关密钥头
    delete proxyHeaders['x-dsh-gateway-secret']

    // 注入当前进程真实有效的握手密钥，通知底座采纳真实客户端 IP
    const secret = getGatewaySecret(this.server)
    if (secret) {
      proxyHeaders['x-dsh-gateway-secret'] = secret
    }

    // 规范化溯源专用代理头
    proxyHeaders['x-dsh-real-ip'] = clientIp
    proxyHeaders['x-real-ip'] = clientIp
    proxyHeaders['x-forwarded-for'] = clientIp
    proxyHeaders['x-original-host'] = originalHost
    proxyHeaders['x-forwarded-host'] = this.coreTargetAuthority
    proxyHeaders['x-forwarded-proto'] = externalProto

    // 成对虚拟化决策矩阵
    if (isLoopbackClient) {
      // 回环客户端（本机访问）：
      // 1. 若带有 Origin：
      //    - 若 origin === 'null'：按跨站处理，绝不修改洗白；
      //    - 若属于本地回环变体且同源/本地等价：成对规范化 Host 和 Origin 为内部核心权威源，端口保持一致；
      //    - 若为外部跨站域名（如 evil.com）：原样保留供下游 CSRF 检查，严禁洗白；
      // 2. 若不带 Origin：仅规范化 Host 为内部核心权威源
      const origin = req.headers.origin
      const hasOrigin = typeof origin === 'string' && origin
      if (hasOrigin) {
        if (origin !== 'null') {
          try {
            const originUrl = new URL(origin)
            if (isSameOriginOrLocalEquivalent(originUrl.host, originalHost, originUrl.protocol, externalProto)) {
              proxyHeaders['host'] = this.coreTargetAuthority
              proxyHeaders['origin'] = `${externalProto}://${this.coreTargetAuthority}`
              if (proxyHeaders['referer'] && typeof proxyHeaders['referer'] === 'string') {
                try {
                  const refUrl = new URL(proxyHeaders['referer'])
                  refUrl.host = this.coreTargetAuthority
                  refUrl.protocol = `${externalProto}:`
                  proxyHeaders['referer'] = refUrl.toString()
                } catch {}
              }
            } else {
              // 跨站 Origin：保留原始 host 或不做洗白
            }
          } catch {}
        }
      } else {
        proxyHeaders['host'] = this.coreTargetAuthority
      }
    } else if (gateResult === 'public') {
      // 公开路径（/auth 等）：成对原则
      // 若带有 Origin 且与原始 Host 同源，则 Host + Origin 成对规范化为内部核心；
      // 若跨站则 Origin 绝不洗白，原样保留传递；若不带 Origin 则仅改写 Host
      const origin = req.headers.origin
      const hasOrigin = typeof origin === 'string' && origin
      if (hasOrigin) {
        try {
          const originUrl = new URL(origin)
          if (isSameOriginOrLocalEquivalent(originUrl.host, originalHost, originUrl.protocol, externalProto)) {
            proxyHeaders['host'] = this.coreTargetAuthority
            proxyHeaders['origin'] = `${externalProto}://${this.coreTargetAuthority}`
            if (proxyHeaders['referer'] && typeof proxyHeaders['referer'] === 'string') {
              try {
                const refUrl = new URL(proxyHeaders['referer'])
                refUrl.host = this.coreTargetAuthority
                refUrl.protocol = `${externalProto}:`
                proxyHeaders['referer'] = refUrl.toString()
              } catch {}
            }
            proxyHeaders['sec-fetch-site'] = 'same-origin'
          }
        } catch {}
      } else {
        proxyHeaders['host'] = this.coreTargetAuthority
      }
    } else {
      // token 或 bypass-* 已认证外部合法流量：
      // 在确认同源后，成对虚拟化为内部回环权威源，解除生态插件 403 围栏
      const origin = req.headers.origin
      const hasOrigin = typeof origin === 'string' && origin
      if (hasOrigin) {
        try {
          const originUrl = new URL(origin)
          if (isSameOriginOrLocalEquivalent(originUrl.host, originalHost, originUrl.protocol, externalProto)) {
            proxyHeaders['host'] = this.coreTargetAuthority
            proxyHeaders['origin'] = `${externalProto}://${this.coreTargetAuthority}`
            if (proxyHeaders['referer'] && typeof proxyHeaders['referer'] === 'string') {
              try {
                const refUrl = new URL(proxyHeaders['referer'])
                refUrl.host = this.coreTargetAuthority
                refUrl.protocol = `${externalProto}:`
                proxyHeaders['referer'] = refUrl.toString()
              } catch {}
            }
            proxyHeaders['sec-fetch-site'] = 'same-origin'
          }
        } catch {}
      } else {
        proxyHeaders['host'] = this.coreTargetAuthority
        if (!proxyHeaders['sec-fetch-site'] || proxyHeaders['sec-fetch-site'] === 'cross-site') {
          proxyHeaders['sec-fetch-site'] = 'same-origin'
        }
      }
    }

    const proxyReq = http.request(
      {
        hostname: this.coreHost,
        port: this.corePort,
        path: req.url,
        method: req.method,
        headers: proxyHeaders,
      },
      (proxyRes) => {
        // 1. 重定向 Location 头改写：防止底座 302 重定向到 127.0.0.1 导致手机打不开
        const location = proxyRes.headers.location
        if (location && [301, 302, 303, 307, 308].includes(proxyRes.statusCode || 0)) {
          proxyRes.headers.location = this.rewriteRedirectLocation(location, originalHost, externalProto)
        }

        // 2. 针对 SSE 长连接流式输出（打字机效果），禁用代理缓冲并立即刷头
        const contentType = String(proxyRes.headers['content-type'] || '').toLowerCase()
        if (contentType.includes('text/event-stream')) {
          proxyRes.headers['x-accel-buffering'] = 'no'
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
          if (typeof res.flushHeaders === 'function') {
            res.flushHeaders()
          }
        } else {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
        }

        // 3. 将底座响应流透明 pipe 回客户端
        proxyRes.pipe(res)
      }
    )

    proxyReq.on('error', (err: any) => {
      if (!res.headersSent) {
        res.writeHead(502, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        })
        res.end(
          `[dsh-remote-mobile] 502 Bad Gateway: 无法连接 DSH 本地核心服务 (${this.coreTargetAuthority}): ${err.message}`
        )
      }
    })

    // 客户端提前中断时同步销毁代理请求
    req.on('aborted', () => {
      proxyReq.destroy()
    })

    // 将客户端请求体 pipe 到底座
    req.pipe(proxyReq)
  }

  /**
   * 处理 WebSocket Upgrade 协议升级代理（支持超时清除、非 101 状态传递与 CSWSH 防御）
   */
  private handleUpgrade(req: IncomingMessage, clientSocket: Socket | any, head: Buffer): void {
    const originalHost = req.headers.host || ''

    // 1. Host 白名单校验
    if (!this.isHostAllowed(originalHost)) {
      clientSocket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      clientSocket.destroy()
      return
    }

    // 网关已完成 Host 白名单校验，通知共享门禁跳过重复 Host 校验
    ;(req as any).__dsh_rm_host_allowed__ = true

    const externalProto = this.getExternalProtocol(req)

    // 2. WebSocket 跨站劫持 (CSWSH) 校验：Origin 必须与当前 Host 同源
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin) {
      try {
        const originUrl = new URL(origin)
        if (!isSameOriginOrLocalEquivalent(originUrl.host, originalHost, originUrl.protocol, externalProto)) {
          clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
          clientSocket.destroy()
          return
        }
      } catch {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        clientSocket.destroy()
        return
      }
    }

    // 3. 门禁鉴权守卫：未通过身份校验的 WebSocket 连接直接拒绝
    if (!isRequestAuthorizedByGate(req, this.store)) {
      clientSocket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      clientSocket.destroy()
      return
    }

    const isLoopbackClient = isLoopbackRequest(req)
    const clientIp = this.getEffectiveClientIp(
      req,
      !isLoopbackClient && this.hasForwardedHeaders(req)
    )
    const proxyHeaders: Record<string, string | string[] | undefined> = { ...req.headers }

    // 消除伪造并注入有效内部握手密钥与真实 IP
    delete proxyHeaders['x-dsh-gateway-secret']
    const secret = getGatewaySecret(this.server)
    if (secret) {
      proxyHeaders['x-dsh-gateway-secret'] = secret
    }

    proxyHeaders['x-dsh-real-ip'] = clientIp
    proxyHeaders['x-real-ip'] = clientIp
    proxyHeaders['x-forwarded-for'] = clientIp
    proxyHeaders['x-original-host'] = originalHost
    proxyHeaders['x-forwarded-host'] = this.coreTargetAuthority
    proxyHeaders['x-forwarded-proto'] = externalProto

    // 成对虚拟化 Host 与 Origin，解除生态插件 WebSocket 升级围栏
    proxyHeaders['host'] = this.coreTargetAuthority
    if (proxyHeaders['origin']) {
      proxyHeaders['x-forwarded-origin'] = proxyHeaders['origin']
      proxyHeaders['origin'] = `${externalProto}://${this.coreTargetAuthority}`
    }
    if (!proxyHeaders['sec-fetch-site'] || proxyHeaders['sec-fetch-site'] === 'cross-site') {
      proxyHeaders['sec-fetch-site'] = 'same-origin'
    }

    let isUpgraded = false
    const proxyReq = http.request({
      hostname: this.coreHost,
      port: this.corePort,
      path: req.url,
      method: req.method || 'GET',
      headers: proxyHeaders,
    })

    // 设置握手阶段超时（仅在升级前生效）
    proxyReq.setTimeout(this.upgradeTimeoutMs, () => {
      if (!isUpgraded) {
        proxyReq.destroy()
        try {
          clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\nConnection: close\r\n\r\n')
          clientSocket.destroy()
        } catch {}
      }
    })

    // 客户端若在升级完成前主动断开，及时清理上游请求
    const onEarlyClose = () => {
      if (!isUpgraded) {
        proxyReq.destroy()
      }
    }
    clientSocket.once('close', onEarlyClose)

    // 底座返回非 101 HTTP 响应处理（如 403 / 401 / 500 等）
    proxyReq.on('response', (proxyRes) => {
      proxyReq.setTimeout(0) // 立即清除握手阶段超时，防止大响应体被误杀
      clientSocket.removeListener('close', onEarlyClose)
      const rawStatusLine = `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage || ''}\r\n`
      let headersStr = ''
      const raw = proxyRes.rawHeaders
      for (let i = 0; i < raw.length; i += 2) {
        headersStr += `${raw[i]}: ${raw[i + 1]}\r\n`
      }
      try {
        clientSocket.write(`${rawStatusLine}${headersStr}\r\n`)
        proxyRes.pipe(clientSocket)
      } catch {
        clientSocket.destroy()
      }
    })

    proxyReq.on('upgrade', (proxyRes, coreSocket, proxyHead) => {
      isUpgraded = true
      clientSocket.removeListener('close', onEarlyClose)

      // 升级成功：立即清除握手阶段的超时定时器，保证长连接不被误杀
      proxyReq.setTimeout(0)

      // 下发 101 Switching Protocols 响应头给客户端
      const rawStatusLine = `HTTP/${proxyRes.httpVersion} 101 Switching Protocols\r\n`
      let headersStr = ''
      const raw = proxyRes.rawHeaders
      for (let i = 0; i < raw.length; i += 2) {
        headersStr += `${raw[i]}: ${raw[i + 1]}\r\n`
      }
      clientSocket.write(`${rawStatusLine}${headersStr}\r\n`)

      // 推回预先消费的头缓冲区
      if (proxyHead && proxyHead.length) {
        clientSocket.unshift(proxyHead)
      }
      if (head && head.length) {
        coreSocket.unshift(head)
      }

      // 开启 TCP_NODELAY，关闭 Nagle 算法，消除终端交互延迟
      clientSocket.setNoDelay(true)
      coreSocket.setNoDelay(true)

      // 全双工透传
      clientSocket.pipe(coreSocket)
      coreSocket.pipe(clientSocket)

      // 异常互斥同步清理
      clientSocket.on('error', () => coreSocket.destroy())
      coreSocket.on('error', () => clientSocket.destroy())
      clientSocket.on('close', () => coreSocket.destroy())
      coreSocket.on('close', () => clientSocket.destroy())
    })

    proxyReq.on('error', (err: any) => {
      clientSocket.removeListener('close', onEarlyClose)
      if (!isUpgraded) {
        this.logger?.error?.('[dsh-remote-mobile] WebSocket 代理建立失败:', err)
        try {
          clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
          clientSocket.destroy()
        } catch {}
      }
    })

    proxyReq.end()
  }

  /**
   * 改写底座 30x 重定向的目标 Location，将回环地址替换为外部真实访问的 Host
   * 兼容 127.0.0.1, localhost, [::1] 以及 127.* 回环变体
   */
  public rewriteRedirectLocation(
    location: string,
    originalHost: string,
    externalProto: 'http' | 'https' = 'http'
  ): string {
    if (!location || !originalHost) return location

    try {
      // 匹配 http://127.0.0.1:3080/..., http://localhost:3080/..., http://[::1]:3080/...
      const loopbackPattern = new RegExp(
        `^(?:https?):\\/\\/(?:127\\.\\d+\\.\\d+\\.\\d+|localhost|\\[::1\\]):${this.corePort}(\\/.*)?$`,
        'i'
      )
      const match = location.match(loopbackPattern)

      if (match) {
        const pathPart = match[1] || ''
        return `${externalProto}://${originalHost}${pathPart}`
      }

      return location
    } catch {
      return location
    }
  }
}
