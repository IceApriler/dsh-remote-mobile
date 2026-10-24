import type { WebRoute } from './api.js'

/**
 * 将插件路由注册到 DSH WebServer。
 *
 * DSH 0.2.1+ 的 `register(route)` 返回一个撤销函数。这里统一收集这些函数，
 * 并通过 Cordis `ctx.effect` 绑定到插件生命周期，避免插件重复激活时旧路由
 * 残留导致 `duplicate undefined route`。
 */
export function registerWebRoutes(ctx: any, routes: WebRoute[]): void {
  const webServer = ctx?.webServer
  if (!webServer || typeof webServer.register !== 'function') return

  const registerAll = () => {
    const disposers: Array<() => void> = []

    try {
      for (const route of routes) {
        const dispose = webServer.register({
          ...route,
          kind: route.kind ?? 'exact',
        })
        if (typeof dispose === 'function') {
          disposers.push(dispose)
        }
      }
    } catch (error) {
      // 中途失败时撤销本轮已经注册的路由，避免留下半套 API。
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {}
      }
      throw error
    }

    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {}
      }
    }
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(registerAll, 'dsh-remote-mobile:web-routes')
    return
  }

  // 兼容没有 ctx.effect 的旧宿主：至少尝试在 dispose 事件中回收路由。
  const cleanup = registerAll()
  if (typeof ctx.on === 'function') {
    ctx.on('dispose', cleanup)
  }
}
