import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * 内部网关私密握手密钥管理器
 *
 * 用于网关与底层 DSH HTTP Server 之间的受信通信鉴权：
 * 仅当底层物理连接为回环 Socket (127.0.0.1 / ::1) 且携带匹配的私密握手密钥时，
 * 底层虚拟化补丁才采纳网关上报的真实客户端 IP (x-dsh-real-ip)。
 *
 * 采用全局活跃单例兼 WeakMap 绑定实例机制，完美兼容 Cordis 插件热重载与多实例隔离场景。
 */

let globalActiveSecret = ''
const serverSecretMap = new WeakMap<any, string>()

/**
 * 生成 32 字节高强度密码学随机密钥
 */
export function generateGatewaySecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * 设置网关内部共享密钥
 * @param serverOrKey - 关联的 Server 实例（可选）
 * @param secret - 密钥字符串
 */
export function setGatewaySecret(serverOrKey: any, secret: string): void {
  globalActiveSecret = secret
  if (serverOrKey && (typeof serverOrKey === 'object' || typeof serverOrKey === 'function')) {
    serverSecretMap.set(serverOrKey, secret)
  }
}

/**
 * 获取当前有效的网关内部共享密钥
 * @param serverOrKey - 关联的 Server 实例（可选）
 */
export function getGatewaySecret(serverOrKey?: any): string {
  if (serverOrKey && (typeof serverOrKey === 'object' || typeof serverOrKey === 'function')) {
    const bound = serverSecretMap.get(serverOrKey)
    if (bound) return bound
  }
  return globalActiveSecret
}

/**
 * 清除网关内部密钥
 */
export function clearGatewaySecret(serverOrKey?: any): void {
  if (serverOrKey && (typeof serverOrKey === 'object' || typeof serverOrKey === 'function')) {
    serverSecretMap.delete(serverOrKey)
  }
  globalActiveSecret = ''
}

/**
 * 恒定时间安全比对两个密钥，防止时序侧信道攻击
 */
export function safeCompareSecret(candidate: string | string[] | undefined, actual: string): boolean {
  if (!candidate || !actual) return false
  const candStr = Array.isArray(candidate) ? candidate[0] : candidate
  if (typeof candStr !== 'string') return false

  const bufCand = Buffer.from(candStr, 'utf8')
  const bufActual = Buffer.from(actual, 'utf8')

  if (bufCand.length !== bufActual.length) return false
  return timingSafeEqual(bufCand, bufActual)
}
