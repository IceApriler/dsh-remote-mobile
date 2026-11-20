import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { unlinkSync } from 'node:fs'
import { SessionStore } from '../lib/auth/token.js'
import { bindConnectionAuth, takeOverConnectionAuth } from '../lib/bridge/compat.js'

/**
 * connection 服务「迟到就绪」绑定测试
 *
 * 背景：官方 connection 插件的 apply 是异步的（内部要 await 凭据服务与
 * BrowserAuth.create 落盘签名密钥），服务注册时间晚于第三方插件的 apply。
 * 旧实现只认「取一次 + 一条 ctx.inject」，任何一条通道失效都会导致永久失手，
 * 最终表现为官方 401 未被接管（/connect 401、手机登录后连不上）。
 */

function createStore() {
  const files = []
  const path = `${tmpdir()}/dsh-binding-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  files.push(path)
  const store = new SessionStore({ devicesFile: path, allowLan: false, allowTailscale: false })
  return {
    store,
    cleanup: () => {
      for (const f of files) {
        try {
          unlinkSync(f)
        } catch {}
      }
    },
  }
}

function createConnection() {
  return {
    browserAuth: {
      launchToken: 'launch-token',
      isAuthenticated: () => false,
      authenticateApi: () => undefined,
    },
    requestRejection: () => 401,
    authorizeIndex: () => false,
    authorizeConnect: () => {},
    trustedHosts: [],
  }
}

/** 构造最小可用的 Cordis ctx 桩：只实现本插件使用的 get / root / on / inject */
function createContext() {
  const listeners = new Map()
  const injected = []
  const offCalls = []
  let connection

  const ctx = {
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    get(name) {
      if (name === 'connection') return connection
      return undefined
    },
    on(event, handler, options) {
      listeners.set(event, { handler, options })
      return () => {
        offCalls.push(event)
        listeners.delete(event)
      }
    },
    inject(deps, cb) {
      injected.push({ deps, cb })
    },
    // 测试辅助
    __provide(value) {
      connection = value
    },
    __emit(event, ...args) {
      const entry = listeners.get(event)
      if (entry) entry.handler(...args)
    },
    __listeners: listeners,
    __injected: injected,
    __offCalls: offCalls,
  }
  ctx.root = ctx
  return ctx
}

test('connection 迟到就绪绑定测试 (bindConnectionAuth)', async (t) => {
  await t.test('服务尚未注册时不接管，且注册了注入 / 事件 / 轮询三条兜底通道', () => {
    const { store, cleanup } = createStore()
    const ctx = createContext()

    const binding = bindConnectionAuth(ctx, store, { retryIntervalMs: 20, retryWindowMs: 200 })
    try {
      assert.equal(binding.isAttached(), false)
      // 通道 2：动态注入
      assert.ok(
        ctx.__injected.some((item) => Array.isArray(item.deps) && item.deps.includes('connection')),
      )
      // 通道 3：internal 服务事件（必须带 global，否则跨插件收不到）
      assert.equal(ctx.__listeners.has('internal/service'), true)
      assert.equal(ctx.__listeners.get('internal/service').options?.global, true)
    } finally {
      binding.dispose()
      cleanup()
    }
  })

  await t.test('服务通过 internal/service 事件迟到注册时立即接管', () => {
    const { store, cleanup } = createStore()
    const ctx = createContext()
    const connection = createConnection()

    const binding = bindConnectionAuth(ctx, store, { retryIntervalMs: 20, retryWindowMs: 200 })
    try {
      assert.equal(binding.isAttached(), false)
      ctx.__provide(connection)
      ctx.__emit('internal/service', 'connection', connection)

      assert.equal(binding.isAttached(), true)
      assert.equal(connection.__dsh_rm_auth_takeover__, true)
    } finally {
      binding.dispose()
      cleanup()
    }
  })

  await t.test('服务在注入回调就绪时接管（ctx.inject 通道）', () => {
    const { store, cleanup } = createStore()
    const ctx = createContext()
    const connection = createConnection()

    const binding = bindConnectionAuth(ctx, store, { retryIntervalMs: 20, retryWindowMs: 200 })
    try {
      const entry = ctx.__injected.find((item) => item.deps.includes('connection'))
      ctx.__provide(connection)
      entry.cb(ctx)

      assert.equal(binding.isAttached(), true)
      assert.equal(connection.__dsh_rm_auth_takeover__, true)
    } finally {
      binding.dispose()
      cleanup()
    }
  })

  await t.test('注入与事件都失效时，有界轮询仍能兜底接管', async () => {
    const { store, cleanup } = createStore()
    const ctx = createContext()
    const connection = createConnection()
    // 模拟异常宿主：ctx.inject 抛错、internal 事件永不派发
    ctx.inject = () => {
      throw new Error('inject unavailable')
    }

    const binding = bindConnectionAuth(ctx, store, { retryIntervalMs: 15, retryWindowMs: 300 })
    try {
      assert.equal(binding.isAttached(), false)
      ctx.__provide(connection)
      await new Promise((resolve) => setTimeout(resolve, 80))

      assert.equal(binding.isAttached(), true)
      assert.equal(connection.__dsh_rm_auth_takeover__, true)
    } finally {
      binding.dispose()
      cleanup()
    }
  })

  await t.test('dispose 解绑事件监听并停止轮询，之后不再接管', async () => {
    const { store, cleanup } = createStore()
    const ctx = createContext()

    const binding = bindConnectionAuth(ctx, store, { retryIntervalMs: 15, retryWindowMs: 300 })
    binding.dispose()

    assert.deepEqual(ctx.__offCalls.includes('internal/service'), true)
    assert.equal(ctx.__listeners.has('internal/service'), false)

    const connection = createConnection()
    ctx.__provide(connection)
    await new Promise((resolve) => setTimeout(resolve, 60))

    assert.equal(binding.isAttached(), false)
    assert.equal(connection.__dsh_rm_auth_takeover__, undefined)
    cleanup()
  })

  await t.test('接管幂等：重复触发不会二次包装 browserAuth', () => {
    const { store, cleanup } = createStore()
    const connection = createConnection()

    takeOverConnectionAuth(connection, store)
    const firstWrap = connection.browserAuth.isAuthenticated
    takeOverConnectionAuth(connection, store)

    assert.equal(connection.browserAuth.isAuthenticated, firstWrap)
    cleanup()
  })
})
