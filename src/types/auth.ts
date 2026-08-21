/**
 * 移动端与远程访问安全认证 - 核心类型定义
 */

export interface PluginConfig {
  allowTailscale?: boolean
  allowLan?: boolean
  secret?: string
  secretHash?: string
  maxVisitsPerMinute?: number
  maxFailedAttempts?: number
  lockDurationMs?: number
}

export interface SessionInfo {
  token: string
  ip: string
  createdAt: number
  lastSeenAt: number
  userAgent?: string
  deviceName?: string
  authType: string
  isBypass?: boolean
}

export interface ShortCodeInfo {
  code: string
  token: string
  createdAt: number
  expiresAt: number
}

export interface IpSecurityStat {
  ip: string
  authVisits: number
  firstSeenAt: number
  lastSeenAt: number
  failedAttempts: number
  totalAttempts: number
  lockedUntil?: number
  lockCount: number
  authType?: string
  deviceName?: string
  userAgent?: string
}

export type DeviceEventType = 'device-connected' | 'device-online' | 'device-revoked' | 'ip-security-alert' | 'ip-security-updated'

export interface DeviceEventPayload {
  type: DeviceEventType
  device?: SessionInfo
  ip?: string
  reason?: string
  stat?: IpSecurityStat
}
