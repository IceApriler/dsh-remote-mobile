/**
 * 无 GUI 部署（headless 服务器）下的 DSH 远程接入管理客户端
 *
 * 【设计职责】
 * 配对码与长期密码原本只能通过本机 Web UI（或手写 curl）获取，服务器上非常不便。
 * 本模块提供命令行子命令 `code` / `password` 所需的全部底座能力，包括：
 *
 * 1. 【端点发现】从插件自有 settings.json 读取 proxyPort，并结合本机网卡 IP
 *    依次探测候选地址，找到当前真正在运行的 DSH 核心或安全接入代理；
 * 2. 【只读窥视】`GET /api/remote-mobile/status` 返回的 `pairingCode`（仅本机操作者可见），
 *    让「查看当前配对码」不会把屏幕上已有的码刷新掉；
 * 3. 【API 调用】生成/刷新配对码、设置/清除长期密码；
 * 4. 【离线兜底】DSH 尚未启动（或端口不可达）时，直接以同等强度写入 settings.json，
 *    让「先设密码、再起服务」这种初始化顺序也能完成。
 *
 * 全部请求都走本机回环：插件门禁对 loopback 无条件放行，因此无需携带任何凭据。
 * 直连模式（direct + 非回环监听）下本机请求源地址是网卡 IP，此时可用 `--token` 传入
 * 已配对设备的会话令牌（Authorization: Bearer）。
 */

import { join } from 'node:path'
import { homedir, networkInterfaces } from 'node:os'
import { readPluginSettingsJson, writePluginSettingsJson, type SessionStoreOptions } from '../auth/token.js'
import { hashSecret } from '../auth/crypto.js'

/** 动作请求（生成配对码 / 写密码）的默认超时：冷启动或高负载机器上首次请求可能偏慢 */
export const DEFAULT_ACTION_TIMEOUT_MS = 8000

/** 端点探测的默认超时：候选地址可能很多，必须快速失败 */
export const DEFAULT_PROBE_TIMEOUT_MS = 2000

/** 状态接口返回的代理信息 */
export interface RemoteMobileProxyStatus {
  mode?: 'proxy' | 'direct'
  running?: boolean
  activePort?: number
  configuredMode?: 'proxy' | 'direct'
  proxyPort?: number
  proxyHost?: string
  corePort?: number
  trustedHosts?: string[]
}

/** 状态接口响应（只声明 CLI 用到的字段） */
export interface RemoteMobileStatus {
  success?: boolean
  locale?: string
  lanIp?: string | null
  tailscaleIp?: string | null
  allowLan?: boolean
  allowTailscale?: boolean
  hasSecret?: boolean
  devicesCount?: number
  pairingCode?: { code: string; expiresAt: number } | null
  proxy?: RemoteMobileProxyStatus
}

/** 端点探测与请求选项 */
export interface CliClientOptions {
  /** 显式指定服务地址（如 http://127.0.0.1:3081），指定后不再自动探测 */
  baseUrl?: string
  /** 显式指定端口，优先于 settings.json 中的 proxyPort */
  port?: number
  /** 显式指定主机，默认 127.0.0.1 */
  host?: string
  /** 会话令牌（直连模式下本机请求不被视为回环时使用） */
  token?: string
  /** 动作请求超时（毫秒，默认 8000）；探测阶段会自动收敛到更短，避免逐个候选地址长时间等待 */
  timeoutMs?: number
  /** DSH 主目录（默认 $DSH_HOME 或 ~/.dsh） */
  dshHome?: string
}

/** 探测结果 */
export interface ResolvedEndpoint {
  baseUrl: string
  status: RemoteMobileStatus
}

/** 单个候选地址的原始探测结果（保留 401/403 等失败语义） */
export interface EndpointProbeResult {
  baseUrl: string
  status: RemoteMobileStatus | null
  httpStatus: number
  error?: string
}

/** 端点发现结果：既可能找到端点，也可能只拿到 401/403 等鉴权失败 */
export interface EndpointSearchResult {
  endpoint: ResolvedEndpoint | null
  authFailure?: {
    baseUrl: string
    status: number
    message: string
  }
}

/**
 * 解析 DSH 主目录
 * @param explicit - 命令行显式传入的路径
 * @returns 绝对路径
 */
export function resolveDshHome(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim()
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/**
 * 插件自有配置文件的绝对路径
 * @param dshHome - DSH 主目录
 * @returns settings.json 路径
 */
export function settingsFilePath(dshHome: string): string {
  return join(dshHome, 'remote-mobile', 'settings.json')
}

/**
 * 读取 settings.json 中的配置（不存在或损坏时返回空对象）
 * @param dshHome - DSH 主目录
 * @returns 插件配置片段
 */
export function readLocalSettings(dshHome: string): Partial<SessionStoreOptions> {
  return readPluginSettingsJson(settingsFilePath(dshHome))
}

/**
 * 汇总候选端口：显式端口 → settings.proxyPort → 常见默认端口
 * @param explicitPort - 命令行 --port
 * @param settings - 本地配置
 * @returns 去重后的端口列表
 */
export function candidatePorts(explicitPort: number | undefined, settings: Partial<SessionStoreOptions>): number[] {
  const ports: number[] = []
  const push = (value: unknown) => {
    const port = Number(value)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return
    if (!ports.includes(port)) ports.push(port)
  }
  push(explicitPort)
  push(settings.proxyPort)
  for (const port of [3080, 3081, 3082, 3083]) push(port)
  return ports
}

/**
 * 汇总候选主机：显式主机 → 本机回环 → 本机全部 IPv4 地址
 * @param explicitHost - 命令行 --host
 * @returns 去重后的主机列表
 */
export function candidateHosts(explicitHost?: string): string[] {
  const hosts: string[] = []
  const push = (value?: string | null) => {
    const host = String(value || '').trim()
    if (!host || hosts.includes(host)) return
    hosts.push(host)
  }
  push(explicitHost)
  push('127.0.0.1')
  try {
    const interfaces = networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const info of interfaces[name] || []) {
        if (info.family === 'IPv4' && !info.internal) push(info.address)
      }
    }
  } catch {}
  return hosts
}

/**
 * 生成候选服务地址列表（显式 --base-url 时只保留该地址）
 * @param options - CLI 选项
 * @returns 候选地址
 */
export function candidateBaseUrls(options: CliClientOptions = {}): string[] {
  if (options.baseUrl) return [trimTrailingSlash(options.baseUrl)]
  const settings = readLocalSettings(resolveDshHome(options.dshHome))
  const ports = candidatePorts(options.port, settings)
  const hosts = candidateHosts(options.host)
  const urls: string[] = []
  for (const port of ports) {
    for (const host of hosts) {
      const authority = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
      const url = `http://${authority}`
      if (!urls.includes(url)) urls.push(url)
    }
  }
  return urls
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  token?: string
  timeoutMs?: number
}

/**
 * 发出一次 JSON 请求（永不抛错，统一返回结构化结果）
 * @param url - 完整地址
 * @param options - 方法、请求体、令牌与超时
 * @returns HTTP 状态码与解析后的 JSON
 */
export async function requestJson(
  url: string,
  options: RequestOptions = {}
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (typeof (timer as any).unref === 'function') (timer as any).unref()
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (options.token) headers.authorization = `Bearer ${options.token}`
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
    const text = await response.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    return { ok: response.ok, status: response.status, data }
  } catch (error: any) {
    const reason = error?.name === 'AbortError' ? '请求超时' : error?.message || String(error)
    return { ok: false, status: 0, data: null, error: reason }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 动作请求（生成配对码 / 设置密码）：超时类失败自动重试一次
 *
 * 服务器冷启动、或在低配机器上与大量插件同时加载时，首个请求偶发超时；
 * 这类失败重试一次即可成功，不必让用户手动再敲一遍命令。
 *
 * @param url - 完整地址
 * @param options - 请求参数
 * @returns 请求结果（至多两次尝试）
 */
async function requestAction(
  url: string,
  options: RequestOptions = {}
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const first = await requestJson(url, options)
  if (first.status === 0 && first.error === '请求超时') {
    return requestJson(url, options)
  }
  return first
}

/**
 * 判断服务地址是否指向本机（回环或本机网卡地址）
 *
 * 密码默认以明文 JSON 发往探测到的端点：地址指向本机时不出网卡，无需加密；
 * 但 `--base-url` 可以指向其它主机，那就是真正的明文跨网传输，必须给出警告。
 *
 * @param baseUrl - 服务地址
 * @param localHosts - 视为本机的主机名集合，默认取本机回环与网卡 IP
 * @returns 是否本机地址（解析失败按本机处理，不制造误报）
 */
export function isLocalBaseUrl(baseUrl: string, localHosts: string[] = candidateHosts()): boolean {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    return localHosts.includes(host)
  } catch {
    return true
  }
}

/**
 * 探测单个候选地址上的插件状态接口
 * @param baseUrl - 候选地址
 * @param options - 令牌与超时
 * @returns 命中时返回状态，否则 null
 */
export async function probeEndpointDetailed(
  baseUrl: string,
  options: CliClientOptions = {}
): Promise<EndpointProbeResult> {
  const result = await requestJson(`${trimTrailingSlash(baseUrl)}/api/remote-mobile/status`, {
    token: options.token,
    timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS),
  })
  if (!result.ok || !result.data || result.data.success !== true) {
    return {
      baseUrl,
      status: null,
      httpStatus: result.status,
      error: result.error || describeFailure(result),
    }
  }
  // 只接受本插件自己的响应：必须带 proxy 结构，避免把别的服务误判为 DSH
  if (!result.data.proxy || typeof result.data.proxy !== 'object') {
    return { baseUrl, status: null, httpStatus: result.status, error: '响应不是 dsh-remote-mobile 状态结构' }
  }
  return { baseUrl, status: result.data as RemoteMobileStatus, httpStatus: result.status }
}

/**
 * 探测单个候选地址上的插件状态接口
 * @param baseUrl - 候选地址
 * @param options - 令牌与超时
 * @returns 命中时返回状态，否则 null
 */
export async function probeEndpoint(
  baseUrl: string,
  options: CliClientOptions = {}
): Promise<RemoteMobileStatus | null> {
  return (await probeEndpointDetailed(baseUrl, options)).status
}

/**
 * 依次探测候选地址，返回第一个可用的 DSH 端点
 * @param options - CLI 选项
 * @returns 命中的端点（含状态）或 null
 */
export async function findEndpointDetailed(options: CliClientOptions = {}): Promise<EndpointSearchResult> {
  let authFailure: EndpointSearchResult['authFailure']
  for (const baseUrl of candidateBaseUrls(options)) {
    const probe = await probeEndpointDetailed(baseUrl, options)
    if (probe.status) return { endpoint: { baseUrl, status: probe.status } }
    // 401/403 不是「没找到服务」，而是服务在但当前请求没有通过鉴权。
    // 记录下来供上层直接报错，绝不能伪装成探测失败后静默写本机配置。
    if (!authFailure && (probe.httpStatus === 401 || probe.httpStatus === 403)) {
      authFailure = {
        baseUrl,
        status: probe.httpStatus,
        message: probe.error || describeFailure({ status: probe.httpStatus, data: null }),
      }
    }
  }
  return { endpoint: null, authFailure }
}

/**
 * 依次探测候选地址，返回第一个可用的 DSH 端点
 * @param options - CLI 选项
 * @returns 命中的端点（含状态）或 null
 */
export async function findEndpoint(options: CliClientOptions = {}): Promise<ResolvedEndpoint | null> {
  return (await findEndpointDetailed(options)).endpoint
}

/**
 * 生成/刷新配对码（旧的未使用配对码会被服务端保留至过期，但屏幕上已发出的码可能被新码取代）
 * @param baseUrl - 命中的服务地址
 * @param options - 令牌与超时
 * @returns 新配对码；失败时返回错误说明
 */
export async function generatePairingCode(
  baseUrl: string,
  options: CliClientOptions = {}
): Promise<{ ok: boolean; code?: string; expiresAt?: number; error?: string }> {
  const result = await requestAction(`${trimTrailingSlash(baseUrl)}/api/remote-mobile/generate-code`, {
    method: 'POST',
    token: options.token,
    timeoutMs: options.timeoutMs,
  })
  if (!result.ok || !result.data?.success) {
    return { ok: false, error: describeFailure(result) }
  }
  return { ok: true, code: String(result.data.code), expiresAt: Number(result.data.expiresAt) }
}

/**
 * 通过运行中的服务设置长期密码（服务端会即时生效并持久化）
 * @param baseUrl - 命中的服务地址
 * @param secret - 明文密码
 * @param options - 令牌与超时
 * @returns 结果
 */
export async function setLongTermPassword(
  baseUrl: string,
  secret: string,
  options: CliClientOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const result = await requestAction(`${trimTrailingSlash(baseUrl)}/api/remote-mobile/set-secret`, {
    method: 'POST',
    body: { secret },
    token: options.token,
    timeoutMs: options.timeoutMs,
  })
  if (!result.ok || !result.data?.success) {
    const reason = result.data?.reason
    return { ok: false, error: typeof reason === 'string' && reason ? reason : describeFailure(result) }
  }
  return { ok: true }
}

/**
 * 通过运行中的服务清除长期密码
 * @param baseUrl - 命中的服务地址
 * @param options - 令牌与超时
 * @returns 结果
 */
export async function clearLongTermPassword(
  baseUrl: string,
  options: CliClientOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const result = await requestAction(`${trimTrailingSlash(baseUrl)}/api/remote-mobile/clear-secret`, {
    method: 'POST',
    token: options.token,
    timeoutMs: options.timeoutMs,
  })
  if (!result.ok || !result.data?.success) {
    return { ok: false, error: describeFailure(result) }
  }
  return { ok: true }
}

/**
 * 离线写入长期密码哈希（DSH 未运行时的兜底路径）
 *
 * 复用与服务端完全一致的 `hashSecret`（scrypt + 盐），因此服务下次启动即可识别；
 * 保留文件内其余配置字段，避免把用户的 allowLan / proxyPort 等设置覆盖成默认值。
 *
 * @param dshHome - DSH 主目录
 * @param secret - 明文密码；传空串表示清除
 * @returns 写入结果与目标路径
 */
export function writePasswordOffline(
  dshHome: string,
  secret: string
): { ok: boolean; path: string; error?: string } {
  const path = settingsFilePath(dshHome)
  try {
    const current = readLocalSettings(dshHome)
    const next: SessionStoreOptions = {
      ...current,
      secret: '',
      secretHash: secret ? hashSecret(secret) : '',
    }
    const ok = writePluginSettingsJson(next, path)
    return ok ? { ok: true, path } : { ok: false, path, error: '无法写入配置文件（权限不足？）' }
  } catch (error: any) {
    return { ok: false, path, error: error?.message || String(error) }
  }
}

/** 把失败的请求转换成可读原因 */
function describeFailure(result: { status: number; data: any; error?: string }): string {
  if (result.error === '请求超时') {
    return '请求超时：服务器繁忙或冷启动较慢，可加大超时后重试（--timeout 15000）'
  }
  if (result.error) return result.error
  if (result.status === 401) return '服务拒绝了该请求（HTTP 401），直连模式下请用 --token 传入已配对设备令牌'
  if (result.status === 403) return '服务拒绝了该请求（HTTP 403），请检查 trustedHosts / Host 是否受信'
  if (result.status === 404) return '目标地址不是 dsh-remote-mobile 服务（HTTP 404）'
  if (result.data?.message) return String(result.data.message)
  if (result.status) return `请求失败（HTTP ${result.status}）`
  return '请求失败：未收到响应'
}
