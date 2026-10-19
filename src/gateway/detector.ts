/**
 * DSH 底座运行模式探测器
 *
 * 负责检测宿主 DSH WebServer 当前的网络暴露姿态：
 * 1. 若宿主仅监听本地回环地址 (127.0.0.1 / localhost)，则外部网络无法直连，
 *    自适应判定为网关模式 ('gateway')，由插件启动独立安全反代网关 (0.0.0.0:3081)；
 * 2. 若宿主已监听 0.0.0.0 或具体的外部网卡 IP，则外部网络可直连，
 *    判定为直连模式 ('direct')，沿用原生的 Hook 拦截机制，不额外占用端口；
 * 3. 支持用户通过 options.mode ('auto' | 'gateway' | 'direct') 强制覆盖。
 */

export type GatewayMode = 'gateway' | 'direct'

export interface ServerModeDetectionResult {
  /** 最终生效的运行模式 */
  mode: GatewayMode
  /** 是否为自动探测得出 */
  isAuto: boolean
  /** 底座核心监听的 host（未配置时默认 127.0.0.1） */
  coreHost: string
  /** 底座核心监听的端口（默认 3080） */
  corePort: number
  /** 底座是否判定为纯回环监听 */
  isLoopback: boolean
}

/**
 * 判断指定 host 是否属于本地回环地址
 */
export function isLoopbackHost(host?: string | null): boolean {
  if (!host || typeof host !== 'string') return true // 默认回环
  const trimmed = host.trim().toLowerCase()
  if (!trimmed) return true
  if (trimmed === 'localhost' || trimmed === '::1') return true
  if (trimmed === '127.0.0.1' || trimmed.startsWith('127.')) return true
  if (trimmed === '::ffff:127.0.0.1' || trimmed.startsWith('::ffff:127.')) return true
  return false
}

/**
 * 探测底座运行姿态并裁决插件的工作模式
 *
 * @param ctx Cordis 上下文（含 webServer / webStartup 等服务）
 * @param configuredMode 用户显式配置的运行模式 ('auto' | 'gateway' | 'direct')
 * @param defaultCorePort 底座默认核心端口（3080）
 */
export function detectServerMode(
  ctx: any,
  configuredMode: 'auto' | 'gateway' | 'direct' = 'auto',
  defaultCorePort = 3080
): ServerModeDetectionResult {
  const webServer = (typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined) || ctx?.webServer
  const webStartup = (typeof ctx?.get === 'function' ? ctx.get('webStartup') : undefined) || ctx?.webStartup

  // 提取宿主底座的 host 与 port 配置
  const coreHostRaw = webServer?.config?.host ?? webServer?.options?.host ?? webStartup?.host ?? '127.0.0.1'
  const corePortRaw = webServer?.config?.port ?? webServer?.options?.port ?? webStartup?.port ?? webServer?.port ?? defaultCorePort

  const coreHost = String(coreHostRaw || '127.0.0.1').trim()
  const corePort = Number(corePortRaw) || defaultCorePort
  const isLoopback = isLoopbackHost(coreHost)

  let finalMode: GatewayMode = 'direct'
  const isAuto = configuredMode === 'auto'

  if (configuredMode === 'gateway') {
    finalMode = 'gateway'
  } else if (configuredMode === 'direct') {
    finalMode = 'direct'
  } else {
    // auto 自适应模式：底座为回环则启用网关，底座已对外开放则直连
    finalMode = isLoopback ? 'gateway' : 'direct'
  }

  return {
    mode: finalMode,
    isAuto,
    coreHost,
    corePort,
    isLoopback,
  }
}
