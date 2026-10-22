/**
 * DSH 底座运行模式探测器
 *
 * 负责检测宿主 DSH WebServer 当前的网络暴露姿态：
 * 1. 默认使用代理模式 ('proxy')：宿主仅监听本地回环地址 (127.0.0.1 / localhost)，
 *    由插件启动独立安全接入代理 (0.0.0.0:3081)；
 * 2. 若宿主已监听 0.0.0.0 或具体的外部网卡 IP，则外部网络可直连，
 *    自动回退直连模式 ('direct')，沿用原生的 Hook 拦截机制，不额外占用端口；
 * 3. 用户可通过 options.mode ('proxy' | 'direct') 显式选择；不再提供 auto 模式。
 */

export type ProxyMode = 'proxy' | 'direct'

export interface ServerModeDetectionResult {
  /** 最终生效的运行模式 */
  mode: ProxyMode
  /** 底座核心监听的 host（未配置时默认 127.0.0.1，在 proxy 模式下已安全规范化为回环 target） */
  coreHost: string
  /** 底座核心监听的端口（默认 3080） */
  corePort: number
  /** 底座原始配置是否判定为纯回环监听 */
  isLoopback: boolean
  /** 原始底座 host */
  rawCoreHost: string
}

/**
 * 判断指定 host 是否属于本地回环地址（支持 localhost, 127.*, ::1, 0:0:0:0:0:0:0:1 等完整形态）
 */
export function isLoopbackHost(host?: string | null): boolean {
  if (!host || typeof host !== 'string') return true // 默认回环
  let trimmed = host.trim().toLowerCase()
  if (!trimmed) return true
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    trimmed = trimmed.slice(1, -1)
  }
  if (trimmed === 'localhost' || trimmed === '::1' || trimmed === '0:0:0:0:0:0:0:1') return true
  if (trimmed === '127.0.0.1' || trimmed.startsWith('127.')) return true
  if (trimmed === '::ffff:127.0.0.1' || trimmed.startsWith('::ffff:127.')) return true
  return false
}

/**
 * 规范化安全接入代理内部转发的目标核心 Host（仅在 proxy 模式下作为 proxy target 使用）
 * 将通配或 localhost 规范化为明确的回环 IP，消除 Node 18+ 的 Happy Eyeballs IPv6 优先解析 502 隐患
 */
export function normalizeGatewayTargetHost(host: string): string {
  const trimmed = host.trim().toLowerCase()
  if (trimmed === '0.0.0.0' || trimmed === 'localhost') return '127.0.0.1'
  if (trimmed === '::' || trimmed === '[::]') return '::1'
  // Node http.request 的 hostname 不接受 IPv6 方括号；去掉后由 coreTargetAuthority 重新加回
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return host.trim().slice(1, -1)
  }
  return host.trim()
}

/**
 * 探测底座运行姿态并裁决插件的工作模式
 *
 * @param ctx Cordis 上下文（含 webServer / webStartup 等服务）
 * @param configuredMode 用户显式配置的运行模式 ('proxy' | 'direct')
 * @param defaultCorePort 底座默认核心端口（3080）
 */
export function detectServerMode(
  ctx: any,
  configuredMode: 'proxy' | 'direct' = 'proxy',
  defaultCorePort = 3080
): ServerModeDetectionResult {
  const webServer = (typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined) || ctx?.webServer
  const webStartup = (typeof ctx?.get === 'function' ? ctx.get('webStartup') : undefined) || ctx?.webStartup

  // 提取宿主底座的 host 与 port 配置（保持原始字面量用于模式判定）
  const coreHostRaw = webServer?.config?.host ?? webServer?.options?.host ?? webStartup?.host ?? '127.0.0.1'
  const corePortRaw = webServer?.config?.port ?? webServer?.options?.port ?? webStartup?.port ?? webServer?.port ?? defaultCorePort

  const rawCoreHost = String(coreHostRaw || '127.0.0.1').trim()
  const corePort = Number(corePortRaw) || defaultCorePort
  const isLoopback = isLoopbackHost(rawCoreHost)

  // proxy 是默认模式，但只在核心回环时成立；核心已对外监听时回退 direct，
  // 以兼容旧版 webserver 配置或用户显式绑定的具体网卡 IP。
  const finalMode: ProxyMode =
    configuredMode === 'direct' || !isLoopback ? 'direct' : 'proxy'

  // 仅对最终生效的 proxy 模式的目标核心地址执行 proxyTarget 规范化
  const coreHost = finalMode === 'proxy' ? normalizeGatewayTargetHost(rawCoreHost) : rawCoreHost

  return {
    mode: finalMode,
    coreHost,
    corePort,
    isLoopback,
    rawCoreHost,
  }
}
