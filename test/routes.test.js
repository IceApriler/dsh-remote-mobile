import test from 'node:test'
import assert from 'node:assert/strict'
import { publicEncrypt, constants } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { SessionStore, AUTH_COOKIE_NAME } from '../lib/auth/token.js'
import { createRoutes } from '../lib/routes/api.js'
import { getPublicKeyPem } from '../lib/auth/crypto.js'

function createMockReqRes({ method = 'GET', url = '/', headers = {}, body = null, socket = {} } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  req.socket = { remoteAddress: '127.0.0.1', ...socket }

  let statusCode = 200
  let responseHeaders = {}
  let responseBody = ''

  const res = {
    writeHead(code, hdrs = {}) {
      statusCode = code
      responseHeaders = { ...responseHeaders, ...hdrs }
    },
    setHeader(key, val) {
      responseHeaders[key] = val
    },
    end(chunk) {
      if (chunk) responseBody += chunk
      res.emit?.('finish')
    },
    destroy() {},
  }

  process.nextTick(() => {
    if (body !== null) {
      const data = typeof body === 'string' ? body : JSON.stringify(body)
      req.emit('data', Buffer.from(data))
    }
    req.emit('end')
  })

  return {
    req,
    res,
    getResponse: () => ({
      status: statusCode,
      headers: responseHeaders,
      body: responseBody,
      json: () => {
        try { return JSON.parse(responseBody) } catch { return null }
      },
    }),
  }
}

test('API 路由处理器功能与安全集成测试 (api.ts)', async (t) => {
  const store = new SessionStore({
    devicesFile: `/tmp/dsh-routes-test-${Date.now()}.json`,
    secret: 'AdminPass2026',
    maxFailedAttempts: 5,
  })
  const routes = createRoutes(store)

  function findRoute(method, path) {
    return routes.find(r => r.method === method && r.path === path)
  }

  await t.test('GET /api/remote-mobile/public-key 返回标准 RSA 公钥', async () => {
    const route = findRoute('GET', '/api/remote-mobile/public-key')
    assert.ok(route)
    const { req, res, getResponse } = createMockReqRes()
    await route.handler(req, res)
    const result = getResponse().json()
    assert.equal(result.success, true)
    assert.equal(result.algorithm, 'RSA-OAEP-SHA256')
    assert.ok(result.publicKey.includes('BEGIN PUBLIC KEY'))
  })

  await t.test('GET /api/remote-mobile/status 返回完整状态与安全审计数据', async () => {
    const route = findRoute('GET', '/api/remote-mobile/status')
    assert.ok(route)
    const { req, res, getResponse } = createMockReqRes()
    await route.handler(req, res)
    const result = getResponse().json()
    assert.equal(result.success, true)
    assert.equal(result.hasSecret, true)
    assert.ok(Array.isArray(result.devices))
    assert.ok(Array.isArray(result.ipSecurityStats))
    assert.ok(result.persistPath)
    assert.ok(result.publicKey)
  })

  await t.test('POST /api/remote-mobile/verify 使用 RSA 密文成功验证并派发 Set-Cookie', async () => {
    const route = findRoute('POST', '/api/remote-mobile/verify')
    assert.ok(route)

    const pubKey = getPublicKeyPem()
    const encSecret = publicEncrypt(
      {
        key: pubKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from('AdminPass2026')
    ).toString('base64')

    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: { encryptedCredential: encSecret },
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        'x-dsh-real-ip': '100.81.241.88',
      },
    })

    await route.handler(req, res)
    const resp = getResponse()
    assert.equal(resp.status, 200)
    const json = resp.json()
    assert.equal(json.success, true)
    assert.ok(json.token)
    assert.ok(resp.headers['Set-Cookie']?.includes(AUTH_COOKIE_NAME))
    assert.ok(resp.headers['Set-Cookie']?.includes('HttpOnly'))
  })

  await t.test('POST /api/remote-mobile/verify 经虚拟化后仍能基于 x-dsh-real-ip 准确防爆破并触发 429', async () => {
    const route = findRoute('POST', '/api/remote-mobile/verify')
    const attackerIp = '10.10.1.77'

    // 前 4 次错误，返回 401
    for (let i = 1; i <= 4; i++) {
      const { req, res, getResponse } = createMockReqRes({
        method: 'POST',
        body: { credential: 'wrong_password_123' },
        headers: {
          'user-agent': 'Mozilla/5.0 (Android)',
          'x-dsh-real-ip': attackerIp,
        },
        socket: { remoteAddress: '127.0.0.1' }, // 模拟已经过虚拟化为 127.0.0.1
      })
      await route.handler(req, res)
      assert.equal(getResponse().status, 401)
    }

    // 第 5 次错误，触发 429 锁定
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: { credential: 'wrong_password_123' },
      headers: {
        'user-agent': 'Mozilla/5.0 (Android)',
        'x-dsh-real-ip': attackerIp,
      },
      socket: { remoteAddress: '127.0.0.1' },
    })
    await route.handler(req, res)
    const resp5 = getResponse()
    assert.equal(resp5.status, 429)
    const json5 = resp5.json()
    assert.equal(json5.locked, true)
    assert.ok(json5.remainingSeconds > 0)

    // 验证 attackerIp 的防爆破统计被精准记录
    const ipStat = store.getIpSecurityStats().find(s => s.ip === attackerIp)
    assert.ok(ipStat)
    assert.equal(ipStat.failedAttempts, 5)
  })

  await t.test('POST /api/remote-mobile/unlock-ip 成功解锁指定 IP', async () => {
    const unlockRoute = findRoute('POST', '/api/remote-mobile/unlock-ip')
    assert.ok(unlockRoute)

    const targetIp = '10.10.1.77'
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: { ip: targetIp },
    })
    await unlockRoute.handler(req, res)
    const json = getResponse().json()
    assert.equal(json.success, true)
    assert.equal(store.isIpLocked(targetIp).locked, false)
  })

  await t.test('POST /api/remote-mobile/set-secret 密码强度校验与加密落盘', async () => {
    const route = findRoute('POST', '/api/remote-mobile/set-secret')
    assert.ok(route)

    // 1. 弱密码被拒绝 (400)
    const { req: weakReq, res: weakRes, getResponse: getWeakResp } = createMockReqRes({
      method: 'POST',
      body: { secret: '12345' },
    })
    await route.handler(weakReq, weakRes)
    assert.equal(getWeakResp().status, 400)

    // 2. 合规密码成功保存 (200)
    const { req: okReq, res: okRes, getResponse: getOkResp } = createMockReqRes({
      method: 'POST',
      body: { secret: 'StrongPass2026!' },
    })
    await route.handler(okReq, okRes)
    assert.equal(getOkResp().status, 200)
    assert.equal(store.hasSecret(), true)
  })

  await t.test('POST /api/remote-mobile/toggle-bypass 切换免密直连开关', async () => {
    const route = findRoute('POST', '/api/remote-mobile/toggle-bypass')
    assert.ok(route)

    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: { allowTailscale: true, allowLan: true },
    })
    await route.handler(req, res)
    assert.equal(getResponse().status, 200)
    assert.equal(store.getOptions().allowTailscale, true)
    assert.equal(store.getOptions().allowLan, true)
  })

  await t.test('POST /api/remote-mobile/update-options 动态更新高级安全策略参数', async () => {
    const route = findRoute('POST', '/api/remote-mobile/update-options')
    assert.ok(route)

    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: {
        maxVisitsPerMinute: 80,
        maxFailedAttempts: 8,
        lockDurationMs: 1200000,
      },
    })
    await route.handler(req, res)
    const result = getResponse().json()
    assert.equal(result.success, true)
    assert.equal(result.maxVisitsPerMinute, 80)
    assert.equal(result.maxFailedAttempts, 8)
    assert.equal(result.lockDurationMs, 1200000)

    assert.equal(store.getOptions().maxVisitsPerMinute, 80)
    assert.equal(store.getOptions().maxFailedAttempts, 8)
    assert.equal(store.getOptions().lockDurationMs, 1200000)
  })
})
