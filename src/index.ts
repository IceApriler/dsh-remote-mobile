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
 * 7. 配置持久化于插件自有文件 ~/.dsh/remote-mobile/settings.json（DSH 0.1.7+ 起官方已弃用 settings.yaml），
 *    启动时一次性兼容迁移旧 settings.yaml / settings.yaml.imported 中的配置。
 */

import { createRequire } from 'node:module'
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
  injectTrustedHosts,
} from './bridge/compat.js'
import { detectServerMode } from './gateway/detector.js'
import { GatewayServer } from './gateway/server.js'
import { generateGatewaySecret, setGatewaySecret, clearGatewaySecret } from './gateway/secret.js'

/** Cordis 插件名称标识 */
export const name = 'dsh-remote-mobile'

/** 服务端 Banner 使用的插件版本（从安装包 package.json 读取，避免与客户端版本常量重复维护） */
let pluginVersion = ''
try {
  const require = createRequire(import.meta.url)
  pluginVersion = String(require('../package.json').version || '')
} catch {}

/** DSH 设置命名空间 */
export const REMOTE_MOBILE_SETTINGS_NAMESPACE = 'dsh-remote-mobile'

/** Cordis 依赖注入声明：声明注入底座内置的 webServer 服务 */
export const inject = ['webServer']

/**
 * 尽力接入 DSH Settings 服务（若宿主提供旧版 register API）。
 *
 * 说明：DSH 0.1.7+ 起官方 dsh-settings 已改为基于 profile cordis.patch.yml 的
 * Config 表单模型（无 register 方法），本函数在该版本下会安全跳过；插件的配置
 * 持久化改由自有 settings.json 承担（见 token.ts）。
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
      // 1. 同步宿主 Settings 中的最新配置到 SessionStore
      const initialVal = scope.get?.()
      if (initialVal && typeof initialVal === 'object') {
        store.updateOptions(initialVal, false)
      }

      // 2. 监听宿主 Settings 或 Web UI 配置变更
      scope.watch?.(() => {
        const updated = scope.get?.()
        if (updated && typeof updated === 'object') {
          store.updateOptions(updated, false)
        }
      })

      // 3. 绑定反向写入钩子：插件 API 修改配置时同步写回宿主 Settings（旧版 API）
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
  // 1. 初始化会话与令牌持久化管理器及内部握手密钥
  const store = new SessionStore(config)
  const styleStore = new StyleSnippetStore()
  const gateMiddleware = createGlobalAuthGate(store)

  // 为本次插件生命周期生成高强度握手 Secret，并绑定到底座 Server
  const gatewaySecret = generateGatewaySecret()
  if (ctx.webServer?.server) {
    setGatewaySecret(ctx.webServer.server, gatewaySecret)
  }

  // 2. 接入 DSH Settings 服务 (命名空间: dsh-remote-mobile)
  bindDshSettings(ctx, store)

  // 3. 挂载底座 WebServer 相关的门禁拦截与路由注册
  if (ctx.webServer) {
    if (ctx.webServer.server) {
      patchHttpServerWithVirtualizer(ctx.webServer.server, gateMiddleware, store, styleStore)
    }

    // 挂载 HTML 模板层的样式与 Polyfill 注入钩子（在 Gzip 压缩前注入）
    mountIndexInjections(ctx, styleStore)

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
  let connectionAuthAttached = false
  const attachConnectionAuth = (conn: any): boolean => {
    if (!conn) return false
    try {
      takeOverConnectionAuth(conn, store)
      connectionAuthAttached = Boolean((conn as any).__dsh_rm_auth_takeover__)
    } catch {
      connectionAuthAttached = false
    }
    return connectionAuthAttached
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

  // 动态同步受信任主机到所有底层运行时（webRuntime、connection、webStartup）
  const syncTrustedHosts = (target?: any) => {
    try {
      injectTrustedHosts(target || ctx, [store.getActivePort(), 3080, 3081], store.getOptions().trustedHosts)
    } catch {}
  }
  syncTrustedHosts()

  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webRuntime'], (runtimeCtx: any) => {
        syncTrustedHosts(runtimeCtx)
      })
    } catch {}
  }

  // 6. 探测 DSH 底座网络暴露姿态：默认 proxy；核心已对外监听时回退 direct。
  // 检测逻辑本身不抛错，异常时仍保留兜底，避免插件 apply 崩溃。
  let modeFallbackError = ''
  let detection: ReturnType<typeof detectServerMode>
  try {
    detection = detectServerMode(ctx, store.getOptions().mode, ctx.webServer?.port ?? 3080)
  } catch (err: any) {
    modeFallbackError = err?.message || String(err)
    ctx.logger?.error?.('[dsh-remote-mobile] 安全接入代理配置不可用，已回退 direct 模式:', err)
    detection = detectServerMode(ctx, 'direct', ctx.webServer?.port ?? 3080)
  }

  // proxy 是默认模式，但核心已对外监听时会回退 direct：
  // - 旧版 webserver 配置（0.0.0.0 / 具体网卡 IP）继续可用；
  // - direct + 回环核心时，外部手机无法直连，仅适合同机反向代理。
  const requestedMode = store.getOptions().mode ?? 'proxy'
  const legacyDirectFallback =
    requestedMode === 'proxy' && detection.mode === 'direct' && !detection.isLoopback
  const directLoopbackWarning = detection.mode === 'direct' && detection.isLoopback
  const modeWarning = legacyDirectFallback
    ? `检测到底座监听 ${detection.rawCoreHost}，已自动使用 direct 模式；3080 直接对外，如需 proxy 请恢复 127.0.0.1 监听。`
    : directLoopbackWarning
      ? 'direct 模式 + 回环核心：外部手机无法直连，仅适合同机反向代理。'
      : ''

  let gatewayServer: GatewayServer | null = null
  let gatewayReadyPromise: Promise<number> | null = null

  if (detection.mode === 'proxy') {
    const opts = store.getOptions()
    gatewayServer = new GatewayServer(
      {
        port: opts.proxyPort ?? 3081,
        host: opts.proxyHost ?? '0.0.0.0',
        corePort: detection.corePort,
        coreHost: detection.coreHost,
      },
      store,
      gateMiddleware,
      ctx.logger
    )

    // 初始标记为正在启动中
    store.setActiveGatewayInfo('proxy', opts.proxyPort ?? 3081, detection.corePort, false)

    gatewayReadyPromise = gatewayServer.start().then(({ port }) => {
      if (gatewayServer?.getServer()) {
        setGatewaySecret(gatewayServer.getServer(), gatewaySecret)
      }
      store.setActiveGatewayInfo('proxy', port, detection.corePort, true)
      syncTrustedHosts()
      return port
    }).catch((err) => {
      store.setActiveGatewayInfo('proxy', opts.proxyPort ?? 3081, detection.corePort, false, err?.message || String(err))
      ctx.logger?.error?.('[dsh-remote-mobile] 安全接入代理启动失败:', err)
      return opts.proxyPort ?? 3081
    })
  } else {
    store.setActiveGatewayInfo('direct', detection.corePort, detection.corePort, true)
    gatewayReadyPromise = Promise.resolve(detection.corePort)
  }

  // 7. 服务就绪时输出提示横幅与接入地址
  let printed = false
  let disposed = false
  let timer1: ReturnType<typeof setTimeout> | null = null
  let timer2: ReturnType<typeof setTimeout> | null = null

  try {
    ctx.on?.('dispose', () => {
      disposed = true
      if (timer1) clearTimeout(timer1)
      if (timer2) clearTimeout(timer2)
      if (gatewayServer) {
        clearGatewaySecret(gatewayServer.getServer())
        gatewayServer.close().catch(() => {})
      }
      const webServer = (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined) || ctx.webServer
      if (webServer?.server) {
        clearGatewaySecret(webServer.server)
      }
    })
  } catch {}

  const printReadyBanner = async () => {
    // 生命周期守卫：若上下文已废弃/进入 dispose，放弃回调
    if (disposed || printed) return
    printed = true

    // 等待安全接入代理就绪以获得准确的对外端口（避免端口自增探测竞态）
    try {
      if (gatewayReadyPromise) {
        await Promise.race([
          gatewayReadyPromise,
          new Promise((r) => setTimeout(r, 2000)),
        ])
      }
    } catch {}

    // 等待期间插件可能已被 dispose / 热重载；此时绝不能再 setGatewaySecret / patch / mount
    if (disposed) return

    try {
      syncTrustedHosts()
      const webServer = (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined) || ctx.webServer
      if (webServer?.server) {
        setGatewaySecret(webServer.server, gatewaySecret)
        patchHttpServerWithVirtualizer(webServer.server, gateMiddleware, store, styleStore)
        mountIndexInjections(ctx, styleStore)
      }
      try {
        const conn = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
        if (conn) attachConnectionAuth(conn)
      } catch (e) {
        ctx.logger?.debug?.('[dsh-remote-mobile] 就绪回调获取 connection 失败:', e)
      }

      const tsIp = getLocalTailscaleIp()
      const lanIp = getLocalLanIp()
      const activePort = store.getActivePort()
      const activeMode = store.getActiveMode()
      const corePort = store.getCorePort()
      const coreHost = detection.coreHost
      const opts = store.getOptions()
      const proxyHost = opts.proxyHost ?? '0.0.0.0'
      const proxyStatus = store.getGatewayStatus()

      const versionLabel = pluginVersion ? `v${pluginVersion}` : 'unknown'
      const coreLabel = detection.isLoopback ? '回环' : '对外监听'
      const modeLabel =
        activeMode === 'proxy'
          ? 'proxy（默认）'
          : legacyDirectFallback
            ? 'direct（旧配置回退）'
            : 'direct（显式配置）'

      const divider = '─'.repeat(72)
      console.log(`\n┌${divider}`)
      console.log(
        connectionAuthAttached
          ? `│ [dsh-remote-mobile] ${versionLabel} 官方临时 Token 鉴权已接管，PC/移动端访问无需携带官方token`
          : `│ [dsh-remote-mobile] ${versionLabel} ⚠️ 官方临时 Token 鉴权接管未完成，请检查 DSH 版本或启动日志`
      )
      console.log(`│ DSH 核心: ${detection.rawCoreHost}:${corePort} (${coreLabel})`)
      console.log(`│ 运行模式: ${modeLabel}`)
      if (modeFallbackError) {
        console.log(`│ ⚠️ 安全接入代理配置不可用，已回退 direct 模式: ${modeFallbackError}`)
      }
      if (modeWarning) {
        console.log(`│ ⚠️ ${modeWarning}`)
      }

      if (activeMode === 'proxy') {
        if (proxyStatus.running) {
          console.log(`│ 安全接入代理已激活 (${proxyHost}:${activePort} -> ${coreHost}:${corePort})`)
          console.log(`│ 手机/远程设备请访问安全接入代理地址:`)
          if (lanIp && lanIp !== '127.0.0.1') {
            console.log(`│   • 局域网:     http://${lanIp}:${activePort} (同 Wi-Fi 局域网直连)`)
          }
          if (tsIp) {
            console.log(`│   • 虚拟私网:   http://${tsIp}:${activePort} (Tailscale 私网异地直连)`)
          }
          console.log(`│ 电脑本机浏览器访问控制台:`)
          console.log(`│   • 本机回环:   http://127.0.0.1:${corePort}`)
        } else {
          console.log(`│ ⚠️ 安全接入代理未成功启动: ${proxyStatus.error || '端口占用'}`)
          console.log(`│ 外部手机设备当前暂时无法连接，请检查 ${opts.proxyPort ?? 3081} 端口占用`)
          console.log(`│ 电脑本机浏览器仍可直接访问:`)
          console.log(`│   • 本机回环:   http://127.0.0.1:${corePort}`)
        }
      } else {
        console.log(`│ 直连模式已启用（无独立安全接入代理），支持手机浏览器访问:`)
        console.log(`│   • 本机回环:   http://127.0.0.1:${corePort}`)
        if (lanIp && lanIp !== '127.0.0.1') {
          console.log(`│   • 局域网:     http://${lanIp}:${corePort} (同 Wi-Fi 局域网直连)`)
        }
        if (tsIp) {
          console.log(`│   • 虚拟私网:   http://${tsIp}:${corePort} (Tailscale 私网异地直连)`)
        }
      }

      console.log(`│ 访问与配置说明:`)
      console.log(`│   - 手机/远程设备打开对应地址即可直接访问`)
      console.log(`│   - 在本机打开 Web 界面 ->「设置」->「远程与移动端」进行安全管理:`)
      console.log(`│     可开启免密直连(局域网/Tailscale)、查看 6 位临时配对码或设置长期密码`)
      console.log(`│   - 高级接入参数: settings.json 中的 mode / proxyPort / proxyHost / trustedHosts`)
      console.log(`│     修改后需要重启 DSH`)
      console.log(`│   - 项目文档:   https://github.com/IceApriler/dsh-remote-mobile`)
      console.log(`└${divider}\n`)

      ctx.logger?.info?.(`[dsh-remote-mobile] 移动端远程控制与安全门禁已激活 (运行模式: ${activeMode}, 对外端口: ${activePort})`)
      if (tsIp) {
        ctx.logger?.info?.(`[dsh-remote-mobile] Tailscale 地址: http://${tsIp}:${activePort} (免密直连: ${opts.allowTailscale ? '已开启' : '已关闭'})`)
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
export * from './gateway/detector.js'
export * from './gateway/server.js'

