import type { IncomingMessage } from 'node:http'

/**
 * 本机操作者请求标记
 *
 * 仅在底座虚拟化层完成「物理 socket + 受信网关 Secret + 反代头」三重校验后写入。
 * 路由层不得再用 socket.remoteAddress / getClientIp 自行推断本机身份：
 * 受信网关与同机反向代理的物理连接同样是 127.0.0.1，直接推断会把外部已认证设备误判为本机。
 *
 * 使用全局 Symbol 避免请求头或普通字符串属性被伪造，同时兼容插件热重载后的模块重复加载。
 */
const LOCAL_OPERATOR_MARKER = Symbol.for('dsh-remote-mobile.local-operator')

/** 标记本次请求来自真正的本机操作者（仅由底座虚拟化层调用） */
export function markLocalOperatorRequest(req: IncomingMessage): void {
  try {
    Object.defineProperty(req, LOCAL_OPERATOR_MARKER, {
      value: true,
      configurable: true,
      enumerable: false,
      writable: false,
    })
  } catch {
    // 极端情况下请求对象不可扩展时保持未标记，路由层按非本机处理
  }
}

/** 清除本机操作者标记（防止 Keep-Alive / 复用请求对象残留） */
export function clearLocalOperatorRequest(req: IncomingMessage): void {
  try {
    delete (req as any)[LOCAL_OPERATOR_MARKER]
  } catch {}
}

/** 判断请求是否由底座虚拟化层确认的本机操作者发起 */
export function isLocalOperatorRequest(req: IncomingMessage): boolean {
  try {
    return (req as any)[LOCAL_OPERATOR_MARKER] === true
  } catch {
    return false
  }
}
