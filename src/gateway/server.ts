/**
 * DSH 移动端远程独立安全网关服务 (GatewayServer)
 *
 * 架构定位：
 * 解决 DSH 0.2.1+ 底层强行禁止 0.0.0.0 监听的问题。
 * DSH 官方 WebServer 继续保持纯粹、安全的 127.0.0.1:3080 本地回环监听（零外部暴露风险）；
 * 由本服务在 0.0.0.0:3081 启动专用安全反代网关，接纳局域网与 Tailscale 流量，
 * 执行端到端 RSA 加密、扫码配对、慢哈希密码认证与防暴力破解 IP 熔断，
 * 并将合法的流量全双工代理至底座核心服务，彻底解决换 Wi-Fi 崩溃、无法兼顾多网卡与本机回环失效的痛点。
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import net, { type Socket } from 'node:net'
import type { SessionStore } from '../auth/token.js'
import type { StyleSnippetStore } from '../styles/style-snippets.js'
import { getClientIp } from '../auth/tailscale.js'
import { isRequestAuthorizedByGate } from '../bridge/compat.js'

export interface GatewayServerOptions {
  /** 网关监听端口，默认 3081 */
  port?: number
  /** 网关监听网络地址，默认 0.0.0.0 */
  host?: string
  /** DSH 宿主核心服务端口，默认 3080 */
  corePort: number
  /** DSH 宿主核心服务主机，默认 127.0.0.1 */
  coreHost?: string
  /** 端口冲突时是否允许自动向后递增探测，默认 true */
  autoIncrementPort?: boolean
}

export class GatewayServer {
  private server: http.Server | null = null
  private activeSockets: Set<Socket> = new Set()
  private store: SessionStore
  private styleStore: StyleSnippetStore
  private gateMiddleware: (req: IncomingMessage, res: ServerResponse, next?: () => void) => boolean
  private configuredPort: number
  private boundPort: number
  private host: string
  private corePort: number
  private coreHost: string
  private autoIncrementPort: boolean
  private logger?: any

  constructor(
    options: GatewayServerOptions,
    store: SessionStore,
    styleStore: StyleSnippetStore,
    gateMiddleware: (req: IncomingMessage, res: ServerResponse, next?: () => void) => boolean,
    logger?: any
  ) {
    this.configuredPort = options.port ?? 3081
    this.boundPort = this.configuredPort
    this.host = options.host ?? '0.0.0.0'
    this.corePort = options.corePort ?? 3080
    this.coreHost = options.coreHost ?? '127.0.0.1'
    this.autoIncrementPort = options.autoIncrementPort ?? true
    this.store = store
    this.styleStore = styleStore
    this.gateMiddleware = gateMiddleware
    this.logger = logger
  }

  /** 获取网关实际生效绑定的端口 */
  public getBoundPort(): number {
    return this.boundPort
  }

  /** 获取网关监听的 host */
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
   * 启动网关服务（带端口冲突自愈探测）
   */
  public async start(): Promise<{ port: number; host: string }> {
    if (this.server) {
      return { port: this.boundPort, host: this.host }
    }

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
        this.logger?.info?.(`[dsh-remote-mobile] 独立安全反向代理网关已就绪: http://${this.host}:${this.boundPort} -> 127.0.0.1:${this.corePort}`)
        return { port: this.boundPort, host: this.host }
      } catch (err: any) {
        if (err.code === 'EADDRINUSE' && attempt < maxTries - 1 && currentPort > 0) {
          this.logger?.warn?.(`[dsh-remote-mobile] 端口 ${currentPort} 已被占用，尝试自增探测端口 ${currentPort + 1}...`)
          currentPort++
          continue
        }
        this.server = null
        throw err
      }
    }

    throw new Error(`[dsh-remote-mobile] 启动安全网关失败：尝试端口均被占用 (${this.configuredPort} ~ ${currentPort})`)
  }

  /**
   * 优雅关闭网关服务，立即释放端口与所有客户端 Socket
   */
  public async close(): Promise<void> {
    if (!this.server) return

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

    await new Promise<void>((resolve) => {
      s.close(() => resolve())
    })
  }

  /**
   * 处理 HTTP 请求：门禁前置拦截 -> 代理流式转发 -> 重定向头改写
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    // 1. 执行插件全局安全门禁中间件
    this.gateMiddleware(req, res, () => {
      // 2. 鉴权通过（或属免密直连），转发请求至底座核心
      this.proxyHttpRequest(req, res)
    })
  }

  /**
   * 转发已授权的 HTTP 请求至 DSH 本地核心服务
   */
  private proxyHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const clientIp = getClientIp(req)
    const originalHost = req.headers.host || ''

    // 规范化代理请求头
    const proxyHeaders: Record<string, string | string[] | undefined> = { ...req.headers }
    proxyHeaders['x-dsh-real-ip'] = clientIp
    proxyHeaders['x-real-ip'] = clientIp
    proxyHeaders['x-forwarded-for'] = clientIp
    proxyHeaders['x-forwarded-host'] = originalHost
    proxyHeaders['x-forwarded-proto'] = 'http'

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
          proxyRes.headers.location = this.rewriteRedirectLocation(location, originalHost)
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
        res.end(`[dsh-remote-mobile] 502 Bad Gateway: 无法连接 DSH 本地核心服务 (127.0.0.1:${this.corePort}): ${err.message}`)
      }
    })

    // 将客户端请求体 pipe 到底座
    req.pipe(proxyReq)
  }

  /**
   * 处理 WebSocket Upgrade 协议升级
   */
  private handleUpgrade(req: IncomingMessage, clientSocket: Socket | any, head: Buffer): void {
    // 1. 门禁鉴权守卫：未通过身份校验的 WebSocket 连接直接拒绝
    if (!isRequestAuthorizedByGate(req, this.store)) {
      clientSocket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      clientSocket.destroy()
      return
    }

    const clientIp = getClientIp(req)
    const originalHost = req.headers.host || ''

    const proxyHeaders: Record<string, string | string[] | undefined> = { ...req.headers }
    proxyHeaders['x-dsh-real-ip'] = clientIp
    proxyHeaders['x-real-ip'] = clientIp
    proxyHeaders['x-forwarded-for'] = clientIp
    proxyHeaders['x-forwarded-host'] = originalHost
    proxyHeaders['x-forwarded-proto'] = 'http'

    const proxyReq = http.request({
      hostname: this.coreHost,
      port: this.corePort,
      path: req.url,
      method: req.method || 'GET',
      headers: proxyHeaders,
    })

    proxyReq.on('upgrade', (proxyRes, coreSocket, proxyHead) => {
      // 1. 下发 101 Switching Protocols 响应头给客户端
      const headersStr = Object.entries(proxyRes.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n')
      clientSocket.write(`HTTP/1.1 101 Switching Protocols\r\n${headersStr}\r\n\r\n`)

      // 2. 推回预先消费的头缓冲区
      if (proxyHead && proxyHead.length) {
        clientSocket.unshift(proxyHead)
      }
      if (head && head.length) {
        coreSocket.unshift(head)
      }

      // 3. 开启 TCP_NODELAY，关闭 Nagle 算法，消除终端交互延迟
      clientSocket.setNoDelay(true)
      coreSocket.setNoDelay(true)

      // 4. 全双工透传
      clientSocket.pipe(coreSocket)
      coreSocket.pipe(clientSocket)

      // 5. 异常互斥同步清理
      clientSocket.on('error', () => coreSocket.destroy())
      coreSocket.on('error', () => clientSocket.destroy())
      clientSocket.on('close', () => coreSocket.destroy())
      coreSocket.on('close', () => clientSocket.destroy())
    })

    proxyReq.on('error', (err: any) => {
      this.logger?.error?.('[dsh-remote-mobile] WebSocket 代理建立失败:', err)
      try {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
        clientSocket.destroy()
      } catch {}
    })

    proxyReq.end()
  }

  /**
   * 改写底座 30x 重定向的目标 Location，将 127.0.0.1 替换为外部真实访问的 Host
   */
  public rewriteRedirectLocation(location: string, originalHost: string): string {
    if (!location || !originalHost) return location

    // 匹配类似 http://127.0.0.1:3080/path 或 http://localhost:3080/path
    const loopbackPattern = new RegExp(`^http://(?:127\\.0\\.0\\.1|localhost):${this.corePort}(/.*)?$`, 'i')
    const match = location.match(loopbackPattern)

    if (match) {
      const pathPart = match[1] || ''
      return `http://${originalHost}${pathPart}`
    }

    return location
  }
}
