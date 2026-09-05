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
import { getLocalTailscaleIp, getLocalLanIp } from './auth/tailscale.js'
import {
  patchHttpServerWithVirtualizer,
  mountIndexInjections,
  registerRemoteWebUiPairingBridge,
  takeOverConnectionAuth,
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

  // 4. 向 Cordis 容器桥接注册 remoteWebUiPairing 服务（延迟裁决：与其他远程接入
  // 类插件共存时自动让出，保证启动不冲突，详见 compat.ts）
  registerRemoteWebUiPairingBridge(ctx, store)

  // 5. 透明接管 DSH 底座 connection 鉴权服务（短路官方 Token 401 阻断）
  /**
   * connection 鉴权接管采用三点冗余策略：
   * 1) 插件 apply 时立即尝试 —— 覆盖 connection 先于本插件就绪的场景
   * 2) ctx.inject 动态注入 —— 覆盖 connection 后于本插件就绪的场景
   * 3) printReadyBanner 中兜底 —— 覆盖上述两者都未捕获到的极端时序
   *
   * takeOverConnectionAuth 内部通过 __dsh_rm_auth_takeover__ 标记保证幂等，
   * 同一 connection 实例不会被重复接管。
   */
  const attachConnectionAuth = (conn: any) => {
    if (conn) {
      takeOverConnectionAuth(conn, store)
    }
  }

  // 1) 优先通过 ctx.get 安全获取（未注入时不抛错返回 undefined）
  try {
    const conn = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    if (conn) attachConnectionAuth(conn)
  } catch (e) {
    ctx.logger?.debug?.('[dsh-remote-mobile] 尝试直接获取 connection 失败:', e)
  }

  // 2) 声明动态子注入，在 connection 服务就绪时接管
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['connection'], (connCtx: any) => {
        try {
          // 统一通过 get 获取服务实例，避免属性访问与方法获取返回不同对象
          const conn = typeof connCtx?.get === 'function' ? connCtx.get('connection') : connCtx?.connection
          if (conn) attachConnectionAuth(conn)
        } catch (e) {
          ctx.logger?.debug?.('[dsh-remote-mobile] inject 接收 connection 注入失败:', e)
        }
      })
    } catch (e) {
      ctx.logger?.debug?.('[dsh-remote-mobile] 注册 connection 动态注入失败:', e)
    }
  }

  // 6. 服务就绪时输出提示横幅与接入地址
  let printed = false
  let disposed = false
  let timer1: ReturnType<typeof setTimeout> | null = null
  let timer2: ReturnType<typeof setTimeout> | null = null

  try {
    ctx.on?.('dispose', () => {
      disposed = true
      if (timer1) clearTimeout(timer1)
      if (timer2) clearTimeout(timer2)
    })
  } catch {}

  const printReadyBanner = () => {
    // 生命周期守卫：若上下文已废弃/进入 dispose，放弃回调
    if (disposed || printed) return
    printed = true

    try {
      const webServer = (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined) || ctx.webServer
      if (webServer?.server) {
        patchHttpServerWithVirtualizer(webServer.server, gateMiddleware, store, styleStore)
      }
      try {
        const conn = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
        if (conn) attachConnectionAuth(conn)
      } catch (e) {
        ctx.logger?.debug?.('[dsh-remote-mobile] 就绪回调获取 connection 失败:', e)
      }

      const tsIp = getLocalTailscaleIp()
      const lanIp = getLocalLanIp()
      const port = webServer?.port ?? 3080
      const opts = store.getOptions()

      const divider = '─'.repeat(72)
      console.log(`\n┌${divider}`)
      console.log(`│ [dsh-remote-mobile] 官方临时 Token 鉴权已接管，PC/移动端访问无需携带官方token`)
      console.log(`│ 远程安全网关已就绪，支持手机浏览器访问:`)
      console.log(`│   • 本机回环:   http://127.0.0.1:${port}`)
      if (lanIp && lanIp !== '127.0.0.1') {
        console.log(`│   • 局域网:     http://${lanIp}:${port} (同 Wi-Fi 局域网直连)`)
      }
      if (tsIp) {
        console.log(`│   • 虚拟私网:   http://${tsIp}:${port} (Tailscale 私网异地直连)`)
      }
      console.log(`│ 访问与配置说明:`)
      console.log(`│   - 手机/远程设备打开对应地址即可直接访问`)
      console.log(`│   - 在本机打开 Web 界面 ->「设置」->「远程与移动端」进行安全管理:`)
      console.log(`│     可开启免密直连(局域网/Tailscale)、查看 6 位临时配对码或设置长期密码`)
      console.log(`│   - 项目文档:   https://github.com/IceApriler/dsh-remote-mobile`)
      console.log(`└${divider}\n`)

      ctx.logger?.info?.(`[dsh-remote-mobile] 移动端远程控制与安全门禁已激活 (上下文虚拟化桥接就绪，样式片段: ${styleStore.list().length} 个)`)
      if (tsIp) {
        ctx.logger?.info?.(`[dsh-remote-mobile] Tailscale 地址: http://${tsIp}:${port} (免密直连: ${opts.allowTailscale ? '已开启' : '已关闭'})`)
      }
    } catch (e) {
      // 上下文若在并发或极端时序下重载，静默退出，防止未捕获异常导致主进程崩溃
    }
  }

  // 1) 优先在 loader 插件树就绪后紧跟官方提示打印
  try {
    const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined
    const settled = loader?.await?.()
    if (settled && typeof settled.then === 'function') {
      settled.then(() => {
        timer1 = setTimeout(printReadyBanner, 120)
      }).catch((e: any) => {
        ctx.logger?.debug?.('[dsh-remote-mobile] loader await 异常:', e)
      })
    }
  } catch (e) {
    ctx.logger?.debug?.('[dsh-remote-mobile] 获取 loader 失败:', e)
  }

  // 2) 兜底定时器（避免无 loader 环境时不输出）
  timer2 = setTimeout(printReadyBanner, 1500)
}

// 导出所有子模块类型与核心工具
export * from './auth/tailscale.js'
export * from './auth/token.js'
export * from './auth/gate.js'
export * from './routes/api.js'
export * from './bridge/compat.js'
export * from './styles/style-snippets.js'

