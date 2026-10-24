import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes } from '../lib/routes/api.js'
import { registerWebRoutes } from '../lib/routes/register.js'

function createFakeWebServer() {
  const exact = new Map()
  const prefixes = new Map()

  return {
    exact,
    prefixes,
    register(route) {
      const table = route.kind === 'exact' ? exact : prefixes
      if (table.has(route.path)) {
        throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
      }
      table.set(route.path, route)
      return () => {
        table.delete(route.path)
      }
    },
  }
}

function createFakeCtx(webServer) {
  const cleanups = []

  return {
    webServer,
    effect(effect) {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return cleanup
    },
    dispose() {
      while (cleanups.length > 0) {
        cleanups.pop()()
      }
    },
  }
}

test('DSH 路由契约与生命周期测试', async (t) => {
  const routes = createRoutes({}, {})

  await t.test('18 条路由全部使用 exact 契约', () => {
    assert.equal(routes.length, 18)
    assert.ok(routes.every((route) => route.kind === 'exact'))
  })

  await t.test('第一次激活进入 exact 表，dispose 后路由被撤销', () => {
    const webServer = createFakeWebServer()
    const ctx = createFakeCtx(webServer)

    registerWebRoutes(ctx, routes)

    assert.equal(webServer.exact.size, 18)
    assert.equal(webServer.prefixes.size, 0)

    ctx.dispose()

    assert.equal(webServer.exact.size, 0)
    assert.equal(webServer.prefixes.size, 0)
  })

  await t.test('同一 WebServer 第二次激活不再抛出 duplicate 错误', () => {
    const webServer = createFakeWebServer()
    const firstCtx = createFakeCtx(webServer)

    registerWebRoutes(firstCtx, routes)
    firstCtx.dispose()
    registerWebRoutes(createFakeCtx(webServer), routes)

    assert.equal(webServer.exact.size, 18)
    assert.equal(webServer.prefixes.size, 0)
  })

  await t.test('中途注册失败会回滚本轮已注册路由', () => {
    const webServer = createFakeWebServer()
    const originalRegister = webServer.register
    let callCount = 0

    webServer.register = (route) => {
      callCount += 1
      if (callCount === 2) throw new Error('boom')
      return originalRegister(route)
    }

    assert.throws(
      () => registerWebRoutes(createFakeCtx(webServer), routes),
      /boom/,
    )
    assert.equal(webServer.exact.size, 0)
    assert.equal(webServer.prefixes.size, 0)
  })

  await t.test('没有 ctx.effect 的旧宿主通过 dispose 事件回收路由', () => {
    const webServer = createFakeWebServer()
    const cleanups = []
    const ctx = {
      webServer,
      on(event, callback) {
        if (event === 'dispose') cleanups.push(callback)
      },
    }

    registerWebRoutes(ctx, routes)
    assert.equal(webServer.exact.size, 18)

    cleanups.forEach((cleanup) => cleanup())
    assert.equal(webServer.exact.size, 0)
  })
})
