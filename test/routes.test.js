import test from 'node:test'
import assert from 'node:assert/strict'
import { publicEncrypt, constants } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { SessionStore, AUTH_COOKIE_NAME } from '../lib/auth/token.js'
import { createRoutes } from '../lib/routes/api.js'
import { getPublicKeyPem } from '../lib/auth/crypto.js'
import { StyleSnippetStore } from '../lib/styles/style-snippets.js'

function createMockReqRes({ method = 'GET', url = '/', headers = {}, body = null, socket = {} } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  req.socket = { remoteAddress: '127.0.0.1', ...socket }

  let statusCode = 200
  let responseHeaders = {}
  let responseBody = ''

  const res = new EventEmitter()
  res.writeHead = function(code, hdrs = {}) {
    statusCode = code
    responseHeaders = { ...responseHeaders, ...hdrs }
  }
  res.setHeader = function(key, val) {
    responseHeaders[key] = val
  }
  res.write = function(chunk) {
    if (chunk) responseBody += chunk
    return true
  }
  res.end = function(chunk) {
    if (chunk) responseBody += chunk
    res.emit('finish')
  }
  res.destroy = function() {}

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
  const styleStore = new StyleSnippetStore(`/tmp/dsh-routes-style-snippets-${Date.now()}.json`)
  const routes = createRoutes(store, styleStore)

  function findRoute(method, path) {
    // method 为 undefined 表示合并 GET/POST 处理的路由（/api/remote-mobile/styles）
    return routes.find(r => (r.method === undefined || r.method === method) && r.path === path)
  }

  const styleRoutes = {
    list: routes.find(r => r.path === '/api/remote-mobile/styles'),
    upsert: routes.find(r => r.path === '/api/remote-mobile/styles'),
    toggle: findRoute('POST', '/api/remote-mobile/styles/toggle'),
    del: findRoute('POST', '/api/remote-mobile/styles/delete'),
    reset: findRoute('POST', '/api/remote-mobile/styles/reset'),
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

  await t.test('extractTokenFromRequest 能够正确从 URL ?rm_token= 或 ?auth_token= 参数中提取令牌', () => {
    // 能够从 rm_token 参数提取
    const rmReq = {
      url: '/?rm_token=myTestToken123456',
      headers: {},
    }
    assert.equal(store.extractTokenFromRequest(rmReq), 'myTestToken123456')

    // 能够从 auth_token 参数提取
    const authReq = {
      url: '/?auth_token=myAuthToken654321',
      headers: {},
    }
    assert.equal(store.extractTokenFromRequest(authReq), 'myAuthToken654321')

    // 官方 token 参数已被解耦，不再被误提取为插件移动端凭据
    const officialReq = {
      url: '/?token=officialToken999',
      headers: {},
    }
    assert.equal(store.extractTokenFromRequest(officialReq), null)
  })

  await t.test('GET /api/remote-mobile/events SSE 断连事件清理具有幂等性且不泄漏监听器', async () => {
    const eventsRoute = findRoute('GET', '/api/remote-mobile/events')
    assert.ok(eventsRoute)

    const initialConnectedListeners = store.listenerCount('device-connected')
    const initialSecurityListeners = store.listenerCount('ip-security-updated')

    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/remote-mobile/events' })
    await eventsRoute.handler(req, res)

    // 验证事件监听器已注册
    assert.equal(store.listenerCount('device-connected'), initialConnectedListeners + 1)
    assert.equal(store.listenerCount('ip-security-updated'), initialSecurityListeners + 1)

    // 模拟客户端关闭连接：触发 req close 和 res close
    req.emit('close')
    res.emit?.('close')

    // 验证监听器被正确注销并回退到初始计数
    assert.equal(store.listenerCount('device-connected'), initialConnectedListeners)
    assert.equal(store.listenerCount('ip-security-updated'), initialSecurityListeners)
  })

  await t.test('GET /api/remote-mobile/styles 列出样式片段', async () => {
    assert.ok(styleRoutes.list)
    const { req, res, getResponse } = createMockReqRes()
    await styleRoutes.list.handler(req, res)
    const result = getResponse().json()
    assert.equal(result.success, true)
    assert.ok(Array.isArray(result.snippets))
  })

  await t.test('POST /api/remote-mobile/styles 新增并编辑自定义片段', async () => {
    assert.ok(styleRoutes.upsert)
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: { name: '测试片段', css: '.a { color: red; }', pcEnabled: true, mobileEnabled: true },
    })
    await styleRoutes.upsert.handler(req, res)
    const created = getResponse().json()
    assert.equal(created.success, true)
    assert.ok(created.snippet)
    assert.ok(created.snippet.id.startsWith('custom-'))
    assert.equal(created.snippet.pcEnabled, true)
    assert.equal(created.snippet.mobileEnabled, true)

    // 编辑同一 id
    const { req: req2, res: res2, getResponse: get2 } = createMockReqRes({
      method: 'POST',
      body: { id: created.snippet.id, name: '测试片段v2', css: '.b { color: blue; }', pcEnabled: false, mobileEnabled: true },
    })
    await styleRoutes.upsert.handler(req2, res2)
    const edited = get2().json()
    assert.equal(edited.success, true)
    assert.equal(edited.snippet.id, created.snippet.id)
    assert.equal(edited.snippet.name, '测试片段v2')
    assert.equal(edited.snippet.mobileEnabled, true)
    assert.equal(edited.snippet.pcEnabled, false)

    // 非法载荷返回 400
    const { req: req3, res: res3, getResponse: get3 } = createMockReqRes({
      method: 'POST',
      body: { name: '', css: '' },
    })
    await styleRoutes.upsert.handler(req3, res3)
    assert.equal(get3().status, 400)
  })

  await t.test('POST /api/remote-mobile/styles/toggle 启停自定义片段', async () => {
    assert.ok(styleRoutes.toggle)
    const created = styleStore.upsertCustom({ name: '临时片段', css: '.tmp {}' })
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: { id: created.id, scope: 'mobile', enabled: false },
    })
    await styleRoutes.toggle.handler(req, res)
    assert.equal(getResponse().json().success, true)
    assert.equal(styleStore.get(created.id)?.mobileEnabled, false)
    assert.equal(styleStore.get(created.id)?.pcEnabled, false)
  })

  await t.test('POST /api/remote-mobile/styles/delete 删除自定义片段、reset 恢复启用', async () => {
    assert.ok(styleRoutes.del)
    const created = styleStore.upsertCustom({ name: '待删除', css: '.d {}', pcEnabled: false, mobileEnabled: true })

    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: { id: 'non-existent-id' },
    })
    await styleRoutes.del.handler(req, res)
    assert.equal(getResponse().json().success, false)

    const { req: req2, res: res2, getResponse: get2 } = createMockReqRes({
      method: 'POST',
      body: { id: created.id },
    })
    await styleRoutes.del.handler(req2, res2)
    assert.equal(get2().json().success, true)

    assert.ok(styleRoutes.reset)
    const { req: req3, res: res3, getResponse: get3 } = createMockReqRes({ method: 'POST' })
    await styleRoutes.reset.handler(req3, res3)
    const afterReset = get3().json()
    assert.equal(afterReset.success, true)
  })
})

