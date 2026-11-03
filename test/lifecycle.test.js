import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { apply } from '../lib/index.js'
import { GatewayServer } from '../lib/gateway/server.js'

test('插件生命周期与优雅退出 Teardown 测试 (lifecycle)', async (t) => {
  await t.test('宿主提供 ctx.effect 时，必须注册 gateway-lifecycle 清理函数', async () => {
    let registeredEffectName = null
    let registeredCleanup = null
    let disposeListener = null

    const mockServer = new EventEmitter()

    const mockCtx = {
      effect: (cb, name) => {
        registeredEffectName = name
        registeredCleanup = cb()
      },
      on: (event, handler) => {
        if (event === 'dispose') {
          disposeListener = handler
        }
      },
      get: (key) => {
        if (key === 'webServer') {
          return {
            server: mockServer,
            config: { host: '127.0.0.1', port: 3080 },
          }
        }
        return undefined
      },
      logger: {
        info: () => {},
        debug: () => {},
        error: () => {},
      },
      webServer: {
        server: mockServer,
        config: { host: '127.0.0.1', port: 3080 },
      },
    }

    // 调用插件入口（direct 模式避免真实启动 socket 监听以兼容受限测试环境）
    apply(mockCtx, { mode: 'direct' })

    // 1. 验证 ctx.effect 正确注册了名称和清理函数
    assert.equal(registeredEffectName, 'dsh-remote-mobile:gateway-lifecycle')
    assert.equal(typeof registeredCleanup, 'function')

    // 2. 验证 ctx.on('dispose') 同样注册了清理函数作为兜底
    assert.equal(typeof disposeListener, 'function')

    // 3. 验证幂等性：同时触发 effect cleanup 与 dispose 不报错且幂等
    assert.doesNotThrow(() => {
      registeredCleanup()
      disposeListener()
    })
  })

  await t.test('GatewayServer.close() 在未监听或已停止时安全幂等返回', async () => {
    const store = {
      getOptions: () => ({}),
      getActivePort: () => 3081,
      getActiveMode: () => 'proxy',
    }
    const gateway = new GatewayServer(
      { port: 3081, host: '127.0.0.1', corePort: 3080, coreHost: '127.0.0.1' },
      store,
      () => {},
      null
    )

    // 未启动时直接 close
    await gateway.close()
    assert.equal(gateway.getStatus(), 'stopped')

    // 二次 close 依然安全
    await gateway.close()
    assert.equal(gateway.getStatus(), 'stopped')
  })

  await t.test('GatewayServer.close() 调用 server.closeAllConnections 并包含超时兜底', async () => {
    const store = {
      getOptions: () => ({}),
      getActivePort: () => 3081,
      getActiveMode: () => 'proxy',
    }
    const gateway = new GatewayServer(
      { port: 3081, host: '127.0.0.1', corePort: 3080, coreHost: '127.0.0.1' },
      store,
      () => {},
      null
    )

    let closeAllCalled = false
    let closeIdleCalled = false
    let serverCloseCalled = false

    // 构造带假 server 的 GatewayServer 实例测试 close 逻辑
    const mockHttpServer = {
      closeAllConnections: () => {
        closeAllCalled = true
      },
      closeIdleConnections: () => {
        closeIdleCalled = true
      },
      close: (cb) => {
        serverCloseCalled = true
        // 模拟正常异步回调
        setImmediate(cb)
      },
    }

    gateway['server'] = mockHttpServer
    gateway['status'] = 'running'

    await gateway.close()

    assert.equal(closeAllCalled, true)
    assert.equal(closeIdleCalled, true)
    assert.equal(serverCloseCalled, true)
    assert.equal(gateway.getStatus(), 'stopped')
    assert.equal(gateway.getServer(), null)
  })

  await t.test('GatewayServer.close() 当底座 server.close 挂起时能通过超时兜底退出', async () => {
    const store = {
      getOptions: () => ({}),
      getActivePort: () => 3081,
      getActiveMode: () => 'proxy',
    }
    const gateway = new GatewayServer(
      { port: 3081, host: '127.0.0.1', corePort: 3080, coreHost: '127.0.0.1' },
      store,
      () => {},
      null
    )

    // 模拟一个永不回调 close 的挂死 server
    const hangingServer = {
      close: () => {
        // 故意不调用回调，测试超时兜底
      },
    }

    gateway['server'] = hangingServer
    gateway['status'] = 'running'

    const startTime = Date.now()
    await gateway.close()
    const elapsed = Date.now() - startTime

    // 应该在约 2000ms 超时后 resolve，而不是永远卡死
    assert.ok(elapsed >= 1900 && elapsed < 3500, `预期等待约 2000ms 超时兜底，实际耗时 ${elapsed}ms`)
    assert.equal(gateway.getStatus(), 'stopped')
    assert.equal(gateway.getServer(), null)
  })
})
