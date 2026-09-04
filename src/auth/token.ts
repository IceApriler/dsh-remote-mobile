import { randomBytes, randomInt } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { hashSecret, verifySecretHash } from './crypto.js'
import { isTailscaleIp, isLanIp } from './tailscale.js'

export const AUTH_COOKIE_NAME = 'dsh_mobile_token'
export const DEFAULT_PERSIST_FILE = join(homedir(), '.dsh', 'remote-mobile', 'devices.json')
export const GLOBAL_SETTINGS_FILE = join(homedir(), '.dsh', 'settings.yaml')

/**
 * 从 ~/.dsh/settings.yaml 中安全读取 dsh-remote-mobile 命名空间的最新配置
 */
export function readFromSettingsYaml(filePath = GLOBAL_SETTINGS_FILE): Partial<SessionStoreOptions> {
  try {
    if (!existsSync(filePath)) return {}
    const content = readFileSync(filePath, 'utf8')
    const ns = 'dsh-remote-mobile:'
    const lines = content.split(/\r?\n/)
    const startIdx = lines.findIndex((l) => l.trim() === ns)
    if (startIdx === -1) return {}

    const result: Partial<SessionStoreOptions> = {}
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t') && line.includes(':')) {
        break
      }
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) continue

      const key = trimmed.slice(0, colonIdx).trim()
      let val = trimmed.slice(colonIdx + 1).trim()
      if (val.includes('#')) {
        val = val.split('#')[0].trim()
      }
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1)
      }

      if (key === 'allowTailscale') result.allowTailscale = val === 'true'
      else if (key === 'allowLan') result.allowLan = val === 'true'
      else if (key === 'secretHash') result.secretHash = val
      else if (key === 'secret') result.secret = val
      else if (key === 'maxFailedAttempts') {
        const num = parseInt(val, 10)
        if (!isNaN(num) && num > 0) result.maxFailedAttempts = num
      } else if (key === 'lockDurationMs') {
        const num = parseInt(val, 10)
        if (!isNaN(num) && num > 0) result.lockDurationMs = num
      } else if (key === 'maxVisitsPerMinute') {
        const num = parseInt(val, 10)
        if (!isNaN(num) && num > 0) result.maxVisitsPerMinute = num
      }
    }
    return result
  } catch {
    return {}
  }
}

/**
 * 从 ~/.dsh/settings.yaml 中读取全局语言偏好 (locale.preference)
 */
export function readGlobalLocale(filePath = GLOBAL_SETTINGS_FILE): 'zh' | 'en' {
  try {
    if (!existsSync(filePath)) return 'zh'
    const content = readFileSync(filePath, 'utf8')
    const match = content.match(/^locale:\s*\r?\n\s+preference:\s*['"]?([a-zA-Z_-]+)['"]?/m)
    if (match && match[1]) {
      return match[1].toLowerCase().startsWith('en') ? 'en' : 'zh'
    }
    return 'zh'
  } catch {
    return 'zh'
  }
}

/**
 * 将最新的插件配置安全原子写回 ~/.dsh/settings.yaml 中的 dsh-remote-mobile 命名空间
 */
export function writeBackToSettingsYaml(options: SessionStoreOptions, filePath = GLOBAL_SETTINGS_FILE): boolean {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    if (!existsSync(filePath)) return false
    const content = readFileSync(filePath, 'utf8')
    const ns = 'dsh-remote-mobile:'

    const fields = [
      'dsh-remote-mobile:',
      `  allowTailscale: ${Boolean(options.allowTailscale)}`,
      `  allowLan: ${Boolean(options.allowLan)}`,
      `  secretHash: ${options.secretHash ? `'${options.secretHash}'` : `''`}`,
      `  maxFailedAttempts: ${options.maxFailedAttempts || 5}`,
      `  lockDurationMs: ${options.lockDurationMs || 900000}`,
      `  maxVisitsPerMinute: ${options.maxVisitsPerMinute || 60}`,
    ]
    const newBlock = fields.join('\n')

    const lines = content.split(/\r?\n/)
    const startIdx = lines.findIndex((l) => l.trim() === ns)

    let updatedContent = ''
    if (startIdx === -1) {
      updatedContent = content.trimEnd() + '\n\n' + newBlock + '\n'
    } else {
      let endIdx = lines.length
      for (let i = startIdx + 1; i < lines.length; i++) {
        const line = lines[i]
        if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t') && line.includes(':')) {
          endIdx = i
          break
        }
      }
      lines.splice(startIdx, endIdx - startIdx, newBlock)
      updatedContent = lines.join('\n')
    }

    writeFileSync(tmpPath, updatedContent, 'utf8')
    renameSync(tmpPath, filePath)
    return true
  } catch {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {}
    return false
  }
}

export interface SessionRecord {
  token: string
  createdAt: number
  lastSeenAt: number
  ip?: string
  deviceName?: string
  userAgent?: string
  authType?: string
  isBypass?: boolean
}

export interface ShortCodeRecord {
  code: string
  token: string
  createdAt: number
  expiresAt: number
}

export interface IpSecurityStat {
  ip: string
  authVisits: number
  authVisitsInWindow: number
  windowStart: number
  failedAttempts: number
  totalAttempts: number
  lockedUntil: number
  lastAttemptAt: number
  lastSeenAt: number
  authType?: string
  deviceName?: string
  userAgent?: string
}

export interface SessionStoreOptions {
  allowTailscale?: boolean
  allowLan?: boolean
  secret?: string
  secretHash?: string
  devicesFile?: string
  maxFailedAttempts?: number // 连续失败阈值，默认 5 次
  lockDurationMs?: number    // 锁定时间，默认 15 分钟
  maxVisitsPerMinute?: number // 每分钟打开 auth 页面上限，默认 60 次
}

/**
 * 将 User-Agent 字符串解析为人类友好的设备名称
 */
export function parseDeviceName(ua = ''): string {
  const isIPhone = /iPhone/i.test(ua)
  const isIPad = /iPad/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  const isMac = /Macintosh/i.test(ua) && !isIPhone && !isIPad
  const isWindows = /Windows/i.test(ua)
  const isLinux = /Linux/i.test(ua) && !isAndroid

  let browser = 'Browser'
  if (/EdgA?\/|Edge\//i.test(ua)) browser = 'Edge'
  else if (/Chrome\//i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome'
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'
  else if (/MicroMessenger/i.test(ua)) browser = '微信内置浏览器'

  if (isIPhone) return `📱 iPhone (${browser})`
  if (isIPad) return `📱 iPad (${browser})`
  if (isAndroid) return `🤖 Android 手机 (${browser})`
  if (isMac) return `💻 Mac (${browser})`
  if (isWindows) return `💻 Windows (${browser})`
  if (isLinux) return `💻 Linux (${browser})`
  return `📱 移动设备 (${browser})`
}

const activeStores = new Set<SessionStore>()
if (typeof process !== 'undefined' && typeof process.on === 'function') {
  process.on('beforeExit', () => {
    for (const s of activeStores) {
      try { s.flushPersistedData() } catch {}
    }
  })
}

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, SessionRecord>()
  private shortCodes = new Map<string, ShortCodeRecord>()
  private ipStats = new Map<string, IpSecurityStat>()
  private options: Required<SessionStoreOptions>
  private settingsMutator?: (patch: Partial<SessionStoreOptions>) => void
  private debounceTimer: NodeJS.Timeout | null = null
  public readonly persistPath: string
  public readonly settingsFilePath: string | null

  constructor(options: SessionStoreOptions = {}) {
    super()
    this.setMaxListeners(100)

    // 严密隔离单测环境：当处于 node --test 环境或使用了自定义设备文件时，严禁读写全局 settings.yaml
    const isTestEnv = Boolean(
      process.env.NODE_TEST_CONTEXT ||
      process.argv.some((arg) => arg.includes('test')) ||
      (options.devicesFile && options.devicesFile !== DEFAULT_PERSIST_FILE)
    )
    this.settingsFilePath = isTestEnv ? null : GLOBAL_SETTINGS_FILE
    const yamlOpts = isTestEnv ? {} : readFromSettingsYaml(GLOBAL_SETTINGS_FILE)
    const mergedOpts = { ...yamlOpts, ...options }

    let secretHash = ''
    if (typeof options.secretHash === 'string' && options.secretHash) {
      secretHash = options.secretHash
    } else if (typeof options.secret === 'string' && options.secret) {
      secretHash = hashSecret(options.secret)
    } else if (typeof yamlOpts.secretHash === 'string' && yamlOpts.secretHash) {
      secretHash = yamlOpts.secretHash
    } else if (typeof yamlOpts.secret === 'string' && yamlOpts.secret) {
      secretHash = hashSecret(yamlOpts.secret)
    }

    this.options = {
      allowTailscale: mergedOpts.allowTailscale ?? false,
      allowLan: mergedOpts.allowLan ?? false,
      secret: '',
      secretHash,
      devicesFile: mergedOpts.devicesFile ?? DEFAULT_PERSIST_FILE,
      maxFailedAttempts: mergedOpts.maxFailedAttempts ?? 5,
      lockDurationMs: mergedOpts.lockDurationMs ?? 15 * 60 * 1000,
      maxVisitsPerMinute: mergedOpts.maxVisitsPerMinute ?? 60,
    }
    this.persistPath = this.options.devicesFile
    this.loadPersistedData()
    activeStores.add(this)
  }

  getOptions(): Required<SessionStoreOptions> {
    return { ...this.options }
  }

  hasSecret(): boolean {
    return Boolean(this.options.secretHash || this.options.secret)
  }

  setSettingsMutator(mutator: (patch: Partial<SessionStoreOptions>) => void) {
    this.settingsMutator = mutator
  }

  updateOptions(newOpts: Partial<SessionStoreOptions>, syncToSettings = true) {
    const prevTailscale = this.options.allowTailscale
    const prevLan = this.options.allowLan

    if (typeof newOpts.secret === 'string') {
      if (!newOpts.secret) {
        newOpts.secret = ''
        newOpts.secretHash = ''
      } else {
        newOpts.secretHash = hashSecret(newOpts.secret)
        newOpts.secret = ''
      }
    }
    this.options = { ...this.options, ...newOpts }

    if (syncToSettings) {
      if (this.settingsMutator) {
        try {
          const patch: Partial<SessionStoreOptions> = {}
          if (typeof newOpts.allowTailscale === 'boolean') patch.allowTailscale = newOpts.allowTailscale
          if (typeof newOpts.allowLan === 'boolean') patch.allowLan = newOpts.allowLan
          if (typeof newOpts.secretHash === 'string') patch.secretHash = newOpts.secretHash
          if (typeof newOpts.maxFailedAttempts === 'number') patch.maxFailedAttempts = newOpts.maxFailedAttempts
          if (typeof newOpts.lockDurationMs === 'number') patch.lockDurationMs = newOpts.lockDurationMs
          if (typeof newOpts.maxVisitsPerMinute === 'number') patch.maxVisitsPerMinute = newOpts.maxVisitsPerMinute
          this.settingsMutator(patch)
        } catch {}
      }
      // 仅在非测试环境或指定了 settingsFilePath 时，同步持久化至 ~/.dsh/settings.yaml
      if (this.settingsFilePath) {
        writeBackToSettingsYaml(this.options, this.settingsFilePath)
      }
    }

    // 1. 如果关闭了 Tailscale 免密直连，自动清理所有 Tailscale 免密设备，并将审计状态重置为 ⚪ 待认证
    if (prevTailscale && newOpts.allowTailscale === false) {
      for (const [token, s] of Array.from(this.sessions.entries())) {
        if (s.isBypass && (s.authType?.includes('Tailscale') || token.startsWith('bypass:tailscale:'))) {
          this.sessions.delete(token)
          if (s.ip && this.ipStats.has(s.ip)) {
            const stat = this.ipStats.get(s.ip)!
            if (stat.authType?.includes('Tailscale') || stat.authType?.includes('免密')) {
              stat.authType = '⚪ 待认证'
            }
          }
        }
      }
      this.emit('device-revoked', { bypassType: 'Tailscale' })
      this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
    }

    // 2. 如果关闭了 局域网 LAN 免密直连，自动清理所有 LAN 免密设备，并将审计状态重置为 ⚪ 待认证
    if (prevLan && newOpts.allowLan === false) {
      for (const [token, s] of Array.from(this.sessions.entries())) {
        if (s.isBypass && (s.authType?.includes('局域网') || s.authType?.includes('LAN') || token.startsWith('bypass:lan:'))) {
          this.sessions.delete(token)
          if (s.ip && this.ipStats.has(s.ip)) {
            const stat = this.ipStats.get(s.ip)!
            if (stat.authType?.includes('局域网') || stat.authType?.includes('LAN') || stat.authType?.includes('免密')) {
              stat.authType = '⚪ 待认证'
            }
          }
        }
      }
      this.emit('device-revoked', { bypassType: 'LAN' })
      this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
    }

    this.savePersistedData()
  }

  /**
   * 记录 IP 打开 /auth 页面的计数并进行限频判定与设备指纹解析
   */
  recordAuthVisit(ip: string, userAgent = ''): { allowed: boolean; lockedUntil?: number; reason?: string } {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
      return { allowed: true }
    }

    const now = Date.now()
    const devName = parseDeviceName(userAgent)
    let stat = this.ipStats.get(ip)
    if (!stat) {
      stat = {
        ip,
        authVisits: 0,
        authVisitsInWindow: 0,
        windowStart: now,
        failedAttempts: 0,
        totalAttempts: 0,
        lockedUntil: 0,
        lastAttemptAt: 0,
        lastSeenAt: 0,
        authType: '⚪ 待认证',
        deviceName: devName,
        userAgent: (userAgent || '').slice(0, 150),
      }
      this.ipStats.set(ip, stat)
    } else {
      if (devName && devName !== '💻 未知设备' && devName !== '📱 移动设备 (Browser)') {
        stat.deviceName = devName
      }
      if (userAgent) {
        stat.userAgent = userAgent.slice(0, 150)
      }
    }

    // 当设备打开登录页时，若该 IP 当前没有正式授权会话且未处于免密直连中，状态明确更新为 ⚪ 待认证
    const hasValidSession = Array.from(this.sessions.values()).some((s) => s.ip === ip && !s.isBypass)
    const isTailscaleBypassActive = this.options.allowTailscale && isTailscaleIp(ip)
    const isLanBypassActive = this.options.allowLan && isLanIp(ip)

    if (!hasValidSession && !isTailscaleBypassActive && !isLanBypassActive) {
      stat.authType = '⚪ 待认证'
      // 同步清理残留的 bypass session
      for (const [token, s] of Array.from(this.sessions.entries())) {
        if (s.ip === ip && s.isBypass) {
          this.sessions.delete(token)
        }
      }
    }

    stat.lastSeenAt = now
    stat.authVisits += 1

    // 检查是否在锁定期内
    if (stat.lockedUntil > now) {
      this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
      return {
        allowed: false,
        lockedUntil: stat.lockedUntil,
        reason: `IP 已被锁定，请在 ${Math.ceil((stat.lockedUntil - now) / 60000)} 分钟后再试`,
      }
    }

    // 1 分钟滑动窗口限频
    if (now - stat.windowStart > 60000) {
      stat.windowStart = now
      stat.authVisitsInWindow = 1
    } else {
      stat.authVisitsInWindow += 1
      if (stat.authVisitsInWindow > this.options.maxVisitsPerMinute) {
        stat.lockedUntil = now + 5 * 60 * 1000 // 恶意刷页面封锁 5 分钟
        this.emit('ip-security-alert', {
          ip,
          reason: '短时间内高频打开登录页，已自动安全拦截 5 分钟',
          remainingSeconds: 300,
          level: 'danger',
        })
        this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
        this.savePersistedData()
        return {
          allowed: false,
          lockedUntil: stat.lockedUntil,
          reason: '页面请求过于频繁，已被临时安全保护',
        }
      }
    }

    this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
    this.savePersistedDataDebounced()
    return { allowed: true }
  }

  /**
   * 检查 IP 是否被防暴力破解锁定
   */
  isIpLocked(ip: string): { locked: boolean; lockedUntil?: number; remainingSeconds?: number } {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
      return { locked: false }
    }
    const stat = this.ipStats.get(ip)
    if (!stat || stat.lockedUntil <= Date.now()) {
      return { locked: false }
    }
    const remainingSeconds = Math.ceil((stat.lockedUntil - Date.now()) / 1000)
    return { locked: true, lockedUntil: stat.lockedUntil, remainingSeconds }
  }

  /**
   * 获取所有 IP 的安全审计统计数据
   */
  getIpSecurityStats(): IpSecurityStat[] {
    const list = Array.from(this.ipStats.values())
    list.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    return list
  }

  /**
   * 管理员手动解锁某个 IP
   */
  unlockIp(ip: string): boolean {
    const stat = this.ipStats.get(ip)
    if (stat) {
      stat.lockedUntil = 0
      stat.failedAttempts = 0
      stat.authVisitsInWindow = 0
      this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
      this.savePersistedData()
      return true
    }
    return false
  }

  generateShortCode(): { code: string; token: string; expiresAt: number } {
    const code = randomInt(100000, 1000000).toString()
    const token = randomBytes(24).toString('hex')
    const now = Date.now()
    const expiresAt = now + 5 * 60 * 1000 // 5 分钟配对有效期

    const record: ShortCodeRecord = { code, token, createdAt: now, expiresAt }
    this.shortCodes.set(code, record)
    this.shortCodes.set(token, record)

    // 定时清理，调用 unref 避免阻塞 Node 进程退出/测试执行
    const timer = setTimeout(() => {
      this.shortCodes.delete(code)
      this.shortCodes.delete(token)
    }, 5 * 60 * 1000 + 1000)
    if (typeof (timer as any).unref === 'function') {
      ;(timer as any).unref()
    }

    return { code, token, expiresAt }
  }

  verify(credential: string, userAgent?: string, clientIp?: string): { success: boolean; token?: string; reason?: string; locked?: boolean; remainingSeconds?: number } {
    const trimmed = (credential || '').trim()
    const now = Date.now()
    const deviceName = parseDeviceName(userAgent)
    const ip = clientIp || ''

    // 0. 防暴力破解检查：IP 是否处于封锁期
    if (ip) {
      const lockCheck = this.isIpLocked(ip)
      if (lockCheck.locked) {
        return {
          success: false,
          locked: true,
          remainingSeconds: lockCheck.remainingSeconds,
          reason: `连续尝试错误过多，IP 已被安全锁定，请在 ${Math.ceil((lockCheck.remainingSeconds || 0) / 60)} 分钟后再试`,
        }
      }
    }

    let stat = ip ? this.ipStats.get(ip) : undefined
    if (!stat && ip) {
      stat = {
        ip,
        authVisits: 1,
        authVisitsInWindow: 1,
        windowStart: now,
        failedAttempts: 0,
        totalAttempts: 0,
        lockedUntil: 0,
        lastAttemptAt: now,
        lastSeenAt: now,
      }
      this.ipStats.set(ip, stat)
    }
    if (stat) {
      stat.totalAttempts += 1
      stat.lastAttemptAt = now
      stat.lastSeenAt = now
      if (deviceName && deviceName !== '💻 未知设备' && deviceName !== '📱 移动设备 (Browser)') {
        stat.deviceName = deviceName
      }
      if (userAgent) {
        stat.userAgent = userAgent.slice(0, 150)
      }
    }

    // 1. 验证 6 位一次性配对码
    const short = this.shortCodes.get(trimmed)
    if (short) {
      if (short.expiresAt < now) {
        this.shortCodes.delete(short.code)
        this.shortCodes.delete(short.token)
        this.handleFailedAttempt(stat, now)
        return { success: false, reason: '配对码已过期，请在 PC 上刷新获取' }
      }
      this.shortCodes.delete(short.code)
      this.shortCodes.delete(short.token)

      // 认证成功，重置失败计数并记录认证归因
      if (stat) {
        stat.failedAttempts = 0
        stat.lockedUntil = 0
        stat.authType = '📱 扫码配对认证'
      }

      // 配对成功后派发 365 天长效会话 Token
      const sessionToken = randomBytes(32).toString('hex')
      const session: SessionRecord = {
        token: sessionToken,
        createdAt: now,
        lastSeenAt: now,
        ip,
        deviceName,
        userAgent: (userAgent || '').slice(0, 150),
        authType: '扫码配对码 (365天免登)',
      }
      this.sessions.set(sessionToken, session)
      this.savePersistedData()
      this.emit('device-connected', session)
      this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
      return { success: true, token: sessionToken }
    }

    // 2. 验证长期密码 (通过加盐哈希安全校验，防时序攻击与明文泄露)
    const targetHash = this.options.secretHash || (this.options.secret ? hashSecret(this.options.secret) : '')
    if (targetHash && verifySecretHash(trimmed, targetHash)) {
      // 认证成功，重置失败计数并记录认证归因
      if (stat) {
        stat.failedAttempts = 0
        stat.lockedUntil = 0
        stat.authType = '🔑 长期密码认证'
      }

      const sessionToken = randomBytes(32).toString('hex')
      const session: SessionRecord = {
        token: sessionToken,
        createdAt: now,
        lastSeenAt: now,
        ip,
        deviceName,
        userAgent: (userAgent || '').slice(0, 150),
        authType: '长期密码认证 (365天免登)',
      }
      this.sessions.set(sessionToken, session)
      this.savePersistedData()
      this.emit('device-connected', session)
      this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
      return { success: true, token: sessionToken }
    }

    // 认证失败，累加失败次数并判定是否锁定
    const lockInfo = this.handleFailedAttempt(stat, now)
    this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
    this.savePersistedData()

    if (lockInfo.justLocked) {
      this.emit('ip-security-alert', {
        ip: stat?.ip || ip,
        reason: `连续输入错误达 ${this.options.maxFailedAttempts} 次，已触发安全锁定 15 分钟！`,
        remainingSeconds: lockInfo.remainingSeconds,
        level: 'danger',
      })
      return {
        success: false,
        locked: true,
        remainingSeconds: lockInfo.remainingSeconds,
        reason: `连续输入错误达 ${this.options.maxFailedAttempts} 次，IP 已被安全锁定 15 分钟！`,
      }
    }

    const remainingTries = Math.max(0, this.options.maxFailedAttempts - (stat?.failedAttempts || 1))
    return {
      success: false,
      reason: remainingTries > 0
        ? `配对码或长期密码错误（还可尝试 ${remainingTries} 次）`
        : '配对码或长期密码错误',
    }
  }

  private handleFailedAttempt(stat: IpSecurityStat | undefined, now: number): { justLocked: boolean; remainingSeconds?: number } {
    if (!stat) return { justLocked: false }
    stat.failedAttempts += 1
    if (stat.failedAttempts >= this.options.maxFailedAttempts) {
      stat.lockedUntil = now + this.options.lockDurationMs
      const remainingSeconds = Math.ceil(this.options.lockDurationMs / 1000)
      return { justLocked: true, remainingSeconds }
    }
    return { justLocked: false }
  }

  validateToken(token: string, clientIp?: string): boolean {
    if (!token) return false
    const session = this.sessions.get(token)
    if (!session) return false

    const now = Date.now()
    // 服务端 365 天过期校验（与客户端 Cookie Max-Age 对齐）
    const MAX_SESSION_AGE = 365 * 24 * 60 * 60 * 1000
    if (now - session.createdAt > MAX_SESSION_AGE) {
      this.sessions.delete(token)
      this.savePersistedData()
      return false
    }

    // 设备距离上次活跃超过 5 分钟，判定为重连上线，触发上线提醒（避免连续请求重复弹窗）
    const isReconnecting = (now - (session.lastSeenAt || 0)) > 5 * 60 * 1000
    session.lastSeenAt = now

    if (clientIp) {
      session.ip = clientIp
      let stat = this.ipStats.get(clientIp)
      if (!stat) {
        stat = {
          ip: clientIp,
          authVisits: 0,
          authVisitsInWindow: 0,
          windowStart: now,
          failedAttempts: 0,
          totalAttempts: 0,
          lockedUntil: 0,
          lastAttemptAt: 0,
          lastSeenAt: now,
        }
        this.ipStats.set(clientIp, stat)
      }
      stat.lastSeenAt = now
      if (session.deviceName && session.deviceName !== '💻 未知设备' && session.deviceName !== '📱 移动设备 (Browser)') {
        stat.deviceName = session.deviceName
      }
      if (session.authType) {
        if (session.authType.includes('扫码') || session.authType.includes('配对')) {
          stat.authType = '📱 扫码配对认证'
        } else if (session.authType.includes('密码')) {
          stat.authType = '🔑 长期密码认证'
        }
      }
    }

    if (isReconnecting) {
      this.emit('device-online', session)
      this.savePersistedDataDebounced()
    }
    return true
  }

  extractTokenFromRequest(req: IncomingMessage): string | null {
    const cookies = req.headers.cookie || ''
    const match = cookies.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]+)`))
    if (match) return match[1]

    const authHeader = req.headers.authorization || ''
    if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim()

    if (req.url && (req.url.includes('rm_token=') || req.url.includes('auth_token='))) {
      try {
        const u = new URL(req.url, 'http://localhost')
        const t = u.searchParams.get('rm_token') || u.searchParams.get('auth_token')
        if (t) return t
      } catch {}
    }
    return null
  }

  /**
   * 自动登记并归因免密直连设备（Tailscale / LAN）
   */
  registerBypassDevice(ip: string, userAgent = '', type: 'Tailscale' | 'LAN'): SessionRecord {
    const token = `bypass:${type.toLowerCase()}:${ip}`
    const now = Date.now()
    const deviceName = parseDeviceName(userAgent)
    const authType = type === 'Tailscale' ? '⚡ Tailscale 免密直连' : '⚡ 局域网 LAN 免密直连'

    let session = this.sessions.get(token)
    let isNew = false
    let isReconnecting = false

    if (!session) {
      isNew = true
      session = {
        token,
        createdAt: now,
        lastSeenAt: now,
        ip,
        deviceName,
        userAgent: (userAgent || '').slice(0, 150),
        authType,
        isBypass: true,
      }
      this.sessions.set(token, session)
    } else {
      isReconnecting = (now - (session.lastSeenAt || 0)) > 5 * 60 * 1000
      session.lastSeenAt = now
      if (deviceName && deviceName !== '💻 未知设备' && deviceName !== '📱 移动设备 (Browser)') {
        session.deviceName = deviceName
      }
      if (userAgent) {
        session.userAgent = userAgent.slice(0, 150)
      }
    }

    // 同步更新 IP 安全审计中的归因标记与设备型号
    let stat = this.ipStats.get(ip)
    if (!stat) {
      stat = {
        ip,
        authVisits: 0,
        authVisitsInWindow: 0,
        windowStart: now,
        failedAttempts: 0,
        totalAttempts: 0,
        lockedUntil: 0,
        lastAttemptAt: 0,
        lastSeenAt: now,
        authType,
        deviceName,
        userAgent: (userAgent || '').slice(0, 150),
      }
      this.ipStats.set(ip, stat)
    } else {
      stat.lastSeenAt = now
      stat.authType = authType
      if (deviceName && deviceName !== '💻 未知设备' && deviceName !== '📱 移动设备 (Browser)') {
        stat.deviceName = deviceName
      }
    }

    if (isNew) {
      this.savePersistedData()
      this.emit('device-connected', session)
      this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
    } else if (isReconnecting) {
      this.savePersistedData()
      this.emit('device-online', session)
      this.emit('ip-security-updated', { stats: this.getIpSecurityStats() })
    }

    return session
  }

  getSessionsList(): { count: number; devices: Array<Omit<SessionRecord, 'userAgent'>> } {
    const list = Array.from(this.sessions.values()).map((s) => ({
      token: s.token,
      deviceName: s.deviceName || parseDeviceName(s.userAgent),
      ip: s.ip || '未知',
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      authType: s.authType || '配对认证',
      isBypass: Boolean(s.isBypass),
    }))
    list.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    return {
      count: list.length,
      devices: list,
    }
  }

  revokeDevice(token: string): boolean {
    if (!token) return false
    const ok = this.sessions.delete(token)
    this.savePersistedData()
    this.emit('device-revoked', { token })
    return ok
  }

  revokeAllSessions() {
    this.sessions.clear()
    this.savePersistedData()
    this.emit('device-revoked', { all: true })
  }

  /**
   * 清空所有 IP 安全审计与防暴破统计记录
   */
  clearAllIpSecurityStats() {
    this.ipStats.clear()
    this.savePersistedData()
    this.emit('ip-security-updated', { stats: [] })
  }

  loadPersistedData() {
    try {
      if (existsSync(this.persistPath)) {
        const content = readFileSync(this.persistPath, 'utf8')
        const data = JSON.parse(content)
        if (Array.isArray(data)) {
          for (const s of data) {
            if (s && s.token) this.sessions.set(s.token, s)
          }
        } else if (data && typeof data === 'object') {
          if (Array.isArray(data.devices)) {
            for (const s of data.devices) {
              if (s && s.token) {
                // 如果当前未开启对应的免密直连，忽略并清理残留的 bypass session
                if (s.isBypass) {
                  if (s.token.startsWith('bypass:tailscale:') && !this.options.allowTailscale) continue
                  if (s.token.startsWith('bypass:lan:') && !this.options.allowLan) continue
                }
                this.sessions.set(s.token, s)
              }
            }
          }
          if (Array.isArray(data.ipStats)) {
            for (const stat of data.ipStats) {
              if (stat && stat.ip) {
                this.ipStats.set(stat.ip, stat)
              }
            }
          }
          // 关联纠偏：如果已授权设备列表中有该 IP，确保审计归因与设备实际认证方式一致
          for (const s of this.sessions.values()) {
            if (s.ip && this.ipStats.has(s.ip)) {
              const stat = this.ipStats.get(s.ip)!
              if (!stat.authType || stat.authType === '⚪ 待认证') {
                if (s.authType?.includes('扫码') || s.authType?.includes('配对')) {
                  stat.authType = '📱 扫码配对认证'
                } else if (s.authType?.includes('密码')) {
                  stat.authType = '🔑 长期密码认证'
                } else if (s.authType) {
                  stat.authType = s.authType
                }
              }
              if (!stat.deviceName && s.deviceName) {
                stat.deviceName = s.deviceName
              }
            }
          }
        }
      }
    } catch {}
  }

  /**
   * 同步立即持久化落盘（由关键路径调用：配对成功、密码认证、撤销设备、手动改密/配置等）
   */
  savePersistedData() {
    this.flushPersistedData()
  }

  /**
   * 500ms 防抖持久化落盘（由高频访问路径调用：每次打开 /auth、validateToken 重连时间戳更新等）
   */
  savePersistedDataDebounced() {
    if (this.debounceTimer) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.flushPersistedData()
    }, 500)
    if (typeof (this.debounceTimer as any).unref === 'function') {
      ;(this.debounceTimer as any).unref()
    }
  }

  /**
   * 立即执行待写的持久化数据落盘并清理定时器
   */
  flushPersistedData() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true })
      const payload = {
        devices: Array.from(this.sessions.values()),
        ipStats: Array.from(this.ipStats.values()),
      }
      writeFileSync(this.persistPath, JSON.stringify(payload, null, 2), 'utf8')
      // 会话文件内含长效 Token（即完整凭证），权限与 rsa-keys.json 对齐收紧为仅当前用户可读写
      try { chmodSync(this.persistPath, 0o600) } catch {}
    } catch {}
  }
}

