/**
 * 反向代理路径前缀解析与安全重定向工具
 */

/**
 * 校验并提取反向代理传递的前缀路径 (如 X-Forwarded-Prefix)
 *
 * 安全约束：
 * 1. 必须以单个 / 开头，且不能以 // 开头（防御协议相对 URL 与开放重定向）
 * 2. 不能包含协议标识 (http:, https:, etc.)
 * 3. 不能包含反斜杠或控制字符（防御浏览器 URL 规范化逃逸与 CRLF 注入）
 * 4. 去除末尾冗余的斜杠
 */
export function resolveForwardedPrefix(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '/') return ''
  // 必须以单个 / 开头，拒绝 // (如 //evil.com)、带有协议字符、以及含反斜杠与控制字符
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
    /[\\\x00-\x1F\x7F]/.test(trimmed)
  ) {
    return ''
  }
  return trimmed.replace(/\/+$/, '')
}

/**
 * 构造带网关前缀的重定向目标路径
 * @param headers 请求头
 * @param targetPath 目标相对路径，如 '/auth' 或 '/'
 */
export function resolveRedirectPath(
  headers: Record<string, string | string[] | undefined> | undefined,
  targetPath: string
): string {
  const rawPrefix = headers?.['x-forwarded-prefix']
  const prefix = resolveForwardedPrefix(typeof rawPrefix === 'string' ? rawPrefix : Array.isArray(rawPrefix) ? rawPrefix[0] : '')
  const normPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`
  if (!prefix) {
    return normPath
  }
  return `${prefix}${normPath}`
}
