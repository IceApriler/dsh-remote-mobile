import { execSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'

/**
 * 判断 IP 是否为 Tailscale 官方虚拟私网 IP (CGNAT 网段 100.64.0.0/10)
 * 范围: 100.64.0.0 ~ 100.127.255.255
 */
export function isTailscaleIp(rawIp?: string): boolean {
  if (!rawIp) return false
  // 规范化 IPv4 (处理 ::ffff:100.x.y.z 格式)
  const ip = rawIp.replace(/^::ffff:/, '').trim()
  if (!ip.startsWith('100.')) return false
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const second = parseInt(parts[1], 10)
  return second >= 64 && second <= 127
}

/**
 * 判断 IP 是否为局域网私有 IP (RFC 1918 规范: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 */
export function isLanIp(rawIp?: string): boolean {
  if (!rawIp) return false
  const ip = rawIp.replace(/^::ffff:/, '').trim()
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || isTailscaleIp(ip)) return false

  const parts = ip.split('.').map((p) => parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false

  const [a, b] = parts
  // 10.0.0.0/8
  if (a === 10) return true
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true

  return false
}

/**
 * 获取底层物理连接的真实 Socket IP（严格基于底座物理连接，绝不受任何请求头篡改，仅去除 IPv6 映射前缀）
 * 专用于底座与网关内部的物理信任边界判定（如 isLoopbackSocket）
 */
export function getPhysicalSocketIp(req: { socket?: { remoteAddress?: string } }): string {
  const raw = req?.socket?.remoteAddress
  return raw ? raw.replace(/^::ffff:/, '').trim() : '127.0.0.1'
}

/**
 * 提取请求的物理 Socket 来源 IP（兼容历史接口，保持物理连接语义）
 */
export function getClientIp(req: { socket?: { remoteAddress?: string; __dsh_real_remote_address__?: string }; headers?: Record<string, string | string[] | undefined> }): string {
  const realAddress = req.socket?.__dsh_real_remote_address__ || req.socket?.remoteAddress
  return realAddress?.replace(/^::ffff:/, '').trim() || '127.0.0.1'
}



/**
 * 获取当前本机的 Tailscale IP
 */
export function getLocalTailscaleIp(): string | null {
  // 1. 尝试通过 CLI 快速获取
  try {
    const out = execSync('tailscale ip -4', { encoding: 'utf8', timeout: 800, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (out && isTailscaleIp(out)) {
      return out
    }
  } catch {
    // CLI 不可用或未在 PATH 中，回退到网卡扫描
  }

  // 2. 扫描系统网卡
  try {
    const interfaces = networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const info of interfaces[name] || []) {
        if (info.family === 'IPv4' && !info.internal && isTailscaleIp(info.address)) {
          return info.address
        }
      }
    }
  } catch {}

  return null
}

/**
 * 获取当前本机局域网 IP (优先常见 en0 / eth0 / wlan0 等)
 */
export function getLocalLanIp(): string | null {
  try {
    const interfaces = networkInterfaces()
    // 优先匹配局域网常规网卡名
    const preferredOrder = ['en0', 'eth0', 'wlan0', 'Wi-Fi', 'en1', 'eth1']
    for (const name of preferredOrder) {
      for (const info of interfaces[name] || []) {
        if (info.family === 'IPv4' && !info.internal && isLanIp(info.address)) {
          return info.address
        }
      }
    }
    // 遍历所有其他可用网卡
    for (const name of Object.keys(interfaces)) {
      for (const info of interfaces[name] || []) {
        if (info.family === 'IPv4' && !info.internal && isLanIp(info.address)) {
          return info.address
        }
      }
    }
  } catch {}
  return null
}

let cachedNetworkIps: { name: string; ip: string; isTailscale: boolean; isLan: boolean }[] | null = null
let cacheExpiresAt = 0
let mockNetworkIps: { name: string; ip: string; isTailscale: boolean; isLan: boolean }[] | null = null

/**
 * 设置模拟网络网卡 IP（仅供单测模拟切换 Wi-Fi / 新网卡场景）
 */
export function setMockNetworkIps(mockList: { name: string; ip: string; isTailscale: boolean; isLan: boolean }[] | null): void {
  mockNetworkIps = mockList
  cachedNetworkIps = null
  cacheExpiresAt = 0
}

/**
 * 清除网络网卡 IP 缓存
 */
export function clearNetworkIpCache(): void {
  cachedNetworkIps = null
  cacheExpiresAt = 0
}

/**
 * 获取本机所有可用的网络 IP（带 2 秒短缓存，兼顾动态切换 Wi-Fi 响应与高频访问性能）
 */
export function getAllNetworkIps(): { name: string; ip: string; isTailscale: boolean; isLan: boolean }[] {
  if (mockNetworkIps) {
    return [...mockNetworkIps]
  }

  const now = Date.now()
  if (cachedNetworkIps && now < cacheExpiresAt) {
    return cachedNetworkIps
  }

  const list: { name: string; ip: string; isTailscale: boolean; isLan: boolean }[] = []
  try {
    const interfaces = networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const info of interfaces[name] || []) {
        if (info.family === 'IPv4' && !info.internal) {
          list.push({
            name,
            ip: info.address,
            isTailscale: isTailscaleIp(info.address),
            isLan: isLanIp(info.address),
          })
        }
      }
    }
  } catch {}

  cachedNetworkIps = list
  cacheExpiresAt = now + 2000
  return list
}

