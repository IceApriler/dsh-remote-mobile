/**
 * 解析当前对外访问端口。
 *
 * 手机/外部设备必须通过安全接入代理（或 direct 模式下的核心端口）访问，
 * 不能使用设置页自身的 window.location.port，也不能回退到硬编码 3080。
 */
export function resolveAccessPort(status) {
  const port = Number(status?.proxy?.activePort)

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null
  }
  return port
}

/** 使用指定主机、对外端口和配对码构造手机登录直达链接。 */
export function buildDirectLink(host, port, token) {
  return `http://${host}:${port}/auth?token=${token || ''}`
}
