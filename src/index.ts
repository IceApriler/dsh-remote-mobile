/**
 * DeepSeek Harness (DSH) 移动端远程控制与网络安全门禁插件
 *
 * 【插件主入口】
 * 本插件为 DSH 提供完整的远程接入与安全治理体系，包括：
 * 1. RSA 2048 端到端传输加密与防中间人窃听；
 * 2. 6 位一次性安全配对码与 365 天长效会话 Token；
 * 3. 自定义高强度长期密码与加盐哈希存储；
 * 4. Tailscale 虚拟私网与局域网 LAN 智能免密直连切换；
 * 5. 防暴力破解限流与单 IP 异常访问熔断审计；
 * 6. 全链路网络上下文虚拟化桥接与 @linxin666 生态无缝兼容。
 * 7. 接入 DSH Settings 服务，配置统一持久化于 ~/.dsh/settings.yaml 的 dsh-remote-mobile 命名空间。
 */

import { SessionStore, type SessionStoreOptions } from './auth/token.js'
import { createGlobalAuthGate } from './auth/gate.js'
import { createRoutes } from './routes/api.js'
import { StyleSnippetStore } from './styles/style-snippets.js'
import { getLocalTailscaleIp } from './auth/tailscale.js'
import {
  patchHttpServerWithVirtualizer,
  mountIndexInjections,
  registerRemoteWebUiPairingBridge,
} from './bridge/compat.js'

/** Cordis 插件名称标识 */
export const name = 'dsh-remote-mobile'

/** DSH 设置命名空间 */
export const REMOTE_MOBILE_SETTINGS_NAMESPACE = 'dsh-remote-mobile'

/** Cordis 依赖注入声明：声明注入底座内置的 webServer 服务 */
export const inject = ['webServer']

/**
 * 注册并绑定 DSH Settings 服务（若存在）
 */
function bindDshSettings(ctx: any, store: SessionStore): void {
  try {
    let settingsService = null
    if (typeof ctx.get === 'function') {
      settingsService = ctx.get('settings')
    }
    if (!settingsService?.register) return

    const ns = REMOTE_MOBILE_SETTINGS_NAMESPACE
    const scope = settingsService.register(ns, undefined, {
      base: store.getOptions(),
    })

    if (scope) {
      // 1. 同步 settings.yaml 中的最新配置到 SessionStore
      const initialVal = scope.get?.()
      if (initialVal && typeof initialVal === 'object') {
        store.updateOptions(initialVal, false)
      }

      // 2. 监听 settings.yaml 或 Web UI 配置变更
      scope.watch?.(() => {
        const updated = scope.get?.()
        if (updated && typeof updated === 'object') {
          store.updateOptions(updated, false)
        }
      })

      // 3. 绑定反向写入钩子：当插件 API 修改配置时同步写回 settings.yaml
      store.setSettingsMutator((patch) => {
        try {
          const ops = Object.entries(patch).map(([field, value]) => ({
            op: 'set',
            path: [field],
            value,
          }))
          settingsService.mutate?.(ns, ops)
        } catch {}
      })
    }
  } catch {}
}

/**
 * 插件生命周期挂载入口函数
 *
 * @param ctx - Cordis 应用上下文
 * @param config - 插件持久化配置选项 (SessionStoreOptions)
 */
export function apply(ctx: any, config: SessionStoreOptions = {}): void {
  // 1. 初始化会话与令牌持久化管理器
  const store = new SessionStore(config)
  const styleStore = new StyleSnippetStore()
  const gateMiddleware = createGlobalAuthGate(store)

  // 2. 接入 DSH Settings 服务 (命名空间: dsh-remote-mobile)
  bindDshSettings(ctx, store)

  // 3. 挂载底座 WebServer 相关的门禁拦截与路由注册
  if (ctx.webServer) {
    if (ctx.webServer.server) {
      patchHttpServerWithVirtualizer(ctx.webServer.server, gateMiddleware, store, styleStore)
    }

    // 挂载 HTML 模板层的 Crypto Polyfill 注入钩子
    mountIndexInjections(ctx)

    // 注册插件专属的 HTTP & SSE API 路由
    if (typeof ctx.webServer.register === 'function') {
      const routes = createRoutes(store, styleStore)
      for (const route of routes) {
        ctx.webServer.register(route)
      }
    }
  }

  // 4. 向 Cordis 容器桥接注册 remoteWebUiPairing 服务
  // 完美兼容 @linxin666 生态插件（如 dsh-pet 宠物、任务看板等），实现免登信任自动共享
  registerRemoteWebUiPairingBridge(ctx, store)

  // 5. 延迟补丁与服务启动日志输出
  setTimeout(() => {
    if (ctx.webServer && ctx.webServer.server) {
      patchHttpServerWithVirtualizer(ctx.webServer.server, gateMiddleware, store, styleStore)
    }
    const tsIp = getLocalTailscaleIp()
    const opts = store.getOptions()
    ctx.logger?.info?.(`[dsh-remote-mobile] 移动端远程控制与安全门禁已激活 (上下文虚拟化桥接就绪，样式片段: ${styleStore.list().length} 个)`)
    if (tsIp) {
      ctx.logger?.info?.(`[dsh-remote-mobile] Tailscale 地址: http://${tsIp}:3080 (免密直连: ${opts.allowTailscale ? '已开启' : '已关闭'})`)
    }
  }, 300)
}

// 导出所有子模块类型与核心工具
export * from './auth/tailscale.js'
export * from './auth/token.js'
export * from './auth/gate.js'
export * from './routes/api.js'
export * from './bridge/compat.js'
export * from './styles/style-snippets.js'

