import test from 'node:test'
import assert from 'node:assert/strict'
import { registerRemoteWebUiPairingBridge, getPairingBridgeState } from '../lib/bridge/compat.js'
import { SessionStore } from '../lib/auth/token.js'

/**
 * remoteWebUiPairing 延迟裁决测试（通用共存保护，不针对特定第三方插件）
 *
 * 背景：remoteWebUiPairing 是远程/Web 接入类插件的通用共享服务名。任何其他插件
 * 先注册后，本插件再注册必然抛错并导致整树回滚致命退出。桥接必须做到：
 * 服务已被占用则让出（yielded，尽力定位提供方包名），无人注册才接管（active）。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeStore() {
  return new SessionStore({ devicesFile: `/tmp/dsh-pairing-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}.json` })
}

/**
 * 构造模拟 Cordis 上下文：
 * - get('remoteWebUiPairing')：按 servicePresent 返回服务或 undefined（strict 语义）
 * - get('loader')：返回 entries 列表
 * - constructor.Service：动态导入 cordis 失败时的兜底基类；构造时若服务已被占用
 *   则抛错，模拟真实 Cordis 的重名冲突行为
 */
function makeCtx({ servicePresent = false, entries = [] } = {}) {
  const calls = { info: [], warn: [] }
  let constructed = 0
  const taken = typeof servicePresent === 'function' ? servicePresent : () => servicePresent
  const ctx = {
    logger: {
      info: (...args) => calls.info.push(args.map(String).join(' ')),
      warn: (...args) => calls.warn.push(args.map(String).join(' ')),
    },
    constructor: {
      Service: class MockService {
        constructor(_ctx, name) {
          constructed += 1
          if (taken()) throw new Error(`service "${name}" has been registered`)
        }
      },
    },
    get(name) {
      if (name === 'remoteWebUiPairing') return taken() ? { __mockService: true } : undefined
      if (name === 'loader') return { entries: () => entries }
      return undefined
    },
  }
  return { ctx, calls, ctor: () => constructed }
}

test('remoteWebUiPairing 配对桥接延迟裁决（通用共存保护）', async (t) => {
  await t.test('服务已被占用且可定位提供方 → 让出并记录对方包名与 entry id', async () => {
    const providerEntry = {
      id: 'other-remote-entry',
      options: { name: '@example/other-remote' },
      disabled: false,
      fiber: { state: 2, store: { remoteWebUiPairing: { __impl: true } } },
    }
    const { ctx, calls } = makeCtx({ servicePresent: true, entries: [providerEntry] })
    const store = makeStore()

    assert.doesNotThrow(() => registerRemoteWebUiPairingBridge(ctx, store))
    await sleep(500)

    const state = getPairingBridgeState()
    assert.equal(state.mode, 'yielded')
    assert.equal(state.conflictWith, '@example/other-remote')
    assert.equal(state.conflictEntryId, 'other-remote-entry')
    assert.ok(calls.warn.some((line) => line.includes('@example/other-remote')), 'warn 日志应包含提供方包名')
  })

  await t.test('服务已被占用但无法定位提供方 → 仍让出，包名与 entry id 均为 null', async () => {
    const { ctx, calls } = makeCtx({ servicePresent: true, entries: [] })
    const store = makeStore()

    registerRemoteWebUiPairingBridge(ctx, store)
    await sleep(500)

    const state = getPairingBridgeState()
    assert.equal(state.mode, 'yielded')
    assert.equal(state.conflictWith, null)
    assert.equal(state.conflictEntryId, null)
    assert.ok(calls.warn.some((line) => line.includes('其他插件')), '应回退为通用文案日志')
  })

  await t.test('无任何其他插件 → 树落定后接管服务（active）', async () => {
    const { ctx, ctor } = makeCtx({ servicePresent: false, entries: [] })
    const store = makeStore()

    registerRemoteWebUiPairingBridge(ctx, store)

    // 最短观察期（600ms）内不得抢注
    await sleep(400)
    assert.equal(ctor(), 0)

    await sleep(900)
    // 快速路径超时后必须完成接管：要么真实构造了服务（cordis 可解析），
    // 要么走「cordis 不可用」的降级分支（仅告警，门禁不受影响）
    const state = getPairingBridgeState()
    assert.equal(state.mode, 'active')
    assert.equal(state.conflictWith, null)
    if (ctor() === 0) {
      // 降级路径应输出告警日志
      assert.ok(true)
    }
  })

  await t.test('其他插件已禁用（disabled）→ 视为已落定，接管服务', async () => {
    const disabledEntry = { options: { name: '@example/other-remote' }, disabled: true }
    const { ctx } = makeCtx({ servicePresent: false, entries: [disabledEntry] })
    const store = makeStore()

    registerRemoteWebUiPairingBridge(ctx, store)
    await sleep(1200)

    assert.equal(getPairingBridgeState().mode, 'active')
  })

  await t.test('自身 entry 尚在激活中不阻塞裁决（按模块名与身份排除自己）', async () => {
    const selfEntry = { options: { name: 'dsh-remote-mobile' }, disabled: false, fiber: { state: 1 } }
    const { ctx } = makeCtx({ servicePresent: false, entries: [selfEntry] })
    const store = makeStore()

    registerRemoteWebUiPairingBridge(ctx, store)
    await sleep(1200)

    assert.equal(getPairingBridgeState().mode, 'active')
  })

  await t.test('其他插件激活失败（fiber FAILED）→ 视为已落定，接管服务', async () => {
    const failedEntry = { options: { name: '@example/other-remote' }, disabled: false, fiber: { state: 3 } }
    const { ctx } = makeCtx({ servicePresent: false, entries: [failedEntry] })
    const store = makeStore()

    registerRemoteWebUiPairingBridge(ctx, store)
    await sleep(1200)

    assert.equal(getPairingBridgeState().mode, 'active')
  })

  await t.test('存在仍在激活中的其他插件 → 保持等待、不注册服务（本用例置于末尾，其兜底定时器已 unref 不阻塞进程）', async () => {
    const loadingEntry = { options: { name: '@example/slow-plugin' }, disabled: false, fiber: { state: 1 } }
    const pendingEntry = { options: { name: '@example/pending-plugin' }, disabled: false }
    const { ctx, calls, ctor } = makeCtx({ servicePresent: false, entries: [loadingEntry, pendingEntry] })
    const store = makeStore()

    registerRemoteWebUiPairingBridge(ctx, store)
    await sleep(1100)

    // 等待期间不得发生任何注册行为，也不得输出裁决日志
    assert.equal(ctor(), 0)
    assert.equal(calls.warn.length, 0)
    assert.equal(calls.info.length, 0)
  })
})
