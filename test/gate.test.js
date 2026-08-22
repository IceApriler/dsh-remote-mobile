import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore, AUTH_COOKIE_NAME } from '../lib/auth/token.js'
import { createGlobalAuthGate, isLoopbackRequest, isPublicPath } from '../lib/auth/gate.js'

test('全局安全门禁中间件测试', async (t) => {
  const store = new SessionStore({
    allowTailscale: false,
    secret: 'adminPass2026',
    devicesFile: `/tmp/dsh-gate-test-${Date.now()}.json`,
  })
  const gate = createGlobalAuthGate(store)

  await t.test('公开路径判定', () => {
    // 仅 /auth、public-key、verify 允许未授权公开访问（安全加固，与原始全公开不同）
    assert.equal(isPublicPath('/auth'), true)
    assert.equal(isPublicPath('/auth?token=123456'), true)
    assert.equal(isPublicPath('/api/remote-mobile/verify'), true)
    assert.equal(isPublicPath('/api/remote-mobile/public-key'), true)
    assert.equal(isPublicPath('/plugins/xxx.js'), true)
    assert.equal(isPublicPath('/assets/yyy.css'), true)
    assert.equal(isPublicPath('/favicon.ico'), true)

    // 敏感/管理类端点必须全部保持非公开，防止未授权绕过获取权限
    const sensitiveEndpoints = [
      '/api/remote-mobile/status',
      '/api/remote-mobile/events',
      '/api/remote-mobile/generate-code',
      '/api/remote-mobile/toggle-bypass',
      '/api/remote-mobile/update-options',
      '/api/remote-mobile/set-secret',
      '/api/remote-mobile/clear-secret',
      '/api/remote-mobile/revoke-device',
      '/api/remote-mobile/revoke-all',
      '/api/remote-mobile/unlock-ip',
      '/api/remote-mobile/clear-ip-stats',
    ]
    for (const endpoint of sensitiveEndpoints) {
      assert.equal(isPublicPath(endpoint), false, `${endpoint} 不应是公开路径`)
    }

    assert.equal(isPublicPath('/'), false)
    assert.equal(isPublicPath('/api/conversation/create'), false)
  })

  await t.test('本机 127.0.0.1 请求无条件放行', () => {
    const req = {
      method: 'GET',
      url: '/api/conversations',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    }
    let passed = false
    gate(req, {}, () => { passed = true })
    assert.equal(passed, true)
  })

  await t.test('未授权的外部 HTML 页面请求被 302 重定向到 /auth', () => {
    const req = {
      method: 'GET',
      url: '/',
      socket: { remoteAddress: '192.168.1.100' },
      headers: { accept: 'text/html,application/xhtml+xml' },
    }
    let redirectedLocation = null
    const res = {
      writeHead(code, headers) {
        if (code === 302) redirectedLocation = headers.Location
      },
      end() {},
    }
    let passed = false
    gate(req, res, () => { passed = true })
    assert.equal(passed, false)
    assert.equal(redirectedLocation, '/auth')
  })

  await t.test('未授权的外部 API 请求被 401 拦截', () => {
    const req = {
      method: 'POST',
      url: '/api/conversation/chat',
      socket: { remoteAddress: '192.168.1.100' },
      headers: { accept: 'application/json' },
    }
    let statusCode = null
    const res = {
      writeHead(code) { statusCode = code },
      end() {},
    }
    let passed = false
    gate(req, res, () => { passed = true })
    assert.equal(passed, false)
    assert.equal(statusCode, 401)
  })

  await t.test('携带合法 Cookie 的已授权设备成功放行', () => {
    const { code } = store.generateShortCode()
    const { token } = store.verify(code, 'iPhone', '100.81.241.55')

    const req = {
      method: 'GET',
      url: '/',
      socket: { remoteAddress: '100.81.241.55' },
      headers: {
        accept: 'text/html',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
    }
    let passed = false
    gate(req, {}, () => { passed = true })
    assert.equal(passed, true)

    // 当设备被下线后，再次请求立即被 302 拦截
    store.revokeDevice(token)
    let secondPassed = false
    let redirected = null
    const res = {
      writeHead(code, headers) {
        if (code === 302) redirected = headers.Location
      },
      end() {},
    }
    gate(req, res, () => { secondPassed = true })
    assert.equal(secondPassed, false)
    assert.equal(redirected, '/auth')
  })

  await t.test('GET /auth 路由正确返回 HTML 页面且包含内联 RSA 公钥', async () => {
    const { createRoutes } = await import('../lib/routes/api.js')
    const routes = createRoutes(store)
    const authRoute = routes.find(r => r.path === '/auth' && r.method === 'GET')
    assert.ok(authRoute)

    let statusCode = null
    let responseHtml = ''
    const req = {
      socket: { remoteAddress: '192.168.1.200' },
      headers: {},
      url: '/auth',
    }
    const res = {
      writeHead(code, headers) {
        statusCode = code
      },
      end(data) {
        responseHtml = data
      },
    }
    await authRoute.handler(req, res)
    assert.equal(statusCode, 200)
    assert.ok(responseHtml.includes('SERVER_RSA_KEY'))
    assert.ok(responseHtml.includes('BEGIN PUBLIC KEY'))
  })

  await t.test('局域网免密直连 (allowLan) 开关放行与拦截测试', () => {
    const lanReq = {
      method: 'POST',
      url: '/api/conversation/chat',
      socket: { remoteAddress: '10.10.1.55' },
      headers: { accept: 'application/json' },
    }

    // 1. allowLan 为 false 时，局域网请求被拦截 (401)
    store.updateOptions({ allowLan: false, allowTailscale: false })
    let passed = false
    let statusCode = null
    const mockRes = {
      writeHead(code) { statusCode = code },
      end() {},
    }
    gate(lanReq, mockRes, () => { passed = true })
    assert.equal(passed, false)
    assert.equal(statusCode, 401)

    // 2. 开启 allowLan: true 后，来自局域网 IP (10.x / 192.168.x) 的请求直接放行
    store.updateOptions({ allowLan: true })
    let lanPassed = false
    gate(lanReq, mockRes, () => { lanPassed = true })
    assert.equal(lanPassed, true)

    // 3. 但非私网 IP (如公网 IP 8.8.8.8) 依然会被 401 拦截
    const publicReq = {
      method: 'POST',
      url: '/api/conversation/chat',
      socket: { remoteAddress: '8.8.8.8' },
      headers: { accept: 'application/json' },
    }
    let pubPassed = false
    let pubStatus = null
    const pubRes = {
      writeHead(code) { pubStatus = code },
      end() {},
    }
    gate(publicReq, pubRes, () => { pubPassed = true })
    assert.equal(pubPassed, false)
    assert.equal(pubStatus, 401)
  })

  await t.test('未认证外部请求访问管理类 API 被安全门禁拦截 (401)', () => {
    store.updateOptions({ allowLan: false, allowTailscale: false })
    const adminReq = {
      method: 'POST',
      url: '/api/remote-mobile/toggle-bypass',
      socket: { remoteAddress: '192.168.1.55' },
      headers: { accept: 'application/json' },
    }
    let passed = false
    let statusCode = null
    const res = {
      writeHead(code) { statusCode = code },
      end() {},
    }
    gate(adminReq, res, () => { passed = true })
    assert.equal(passed, false)
    assert.equal(statusCode, 401)
  })

  await t.test('未认证非 loopback 请求访问全部敏感端点均被拦截，公开端点可访问', () => {
    store.updateOptions({ allowLan: false, allowTailscale: false })
    const sensitiveEndpoints = [
      '/api/remote-mobile/status',
      '/api/remote-mobile/events',
      '/api/remote-mobile/generate-code',
      '/api/remote-mobile/toggle-bypass',
      '/api/remote-mobile/update-options',
      '/api/remote-mobile/set-secret',
      '/api/remote-mobile/clear-secret',
      '/api/remote-mobile/revoke-device',
      '/api/remote-mobile/revoke-all',
      '/api/remote-mobile/unlock-ip',
      '/api/remote-mobile/clear-ip-stats',
      '/api/conversation/create',
    ]
    for (const endpoint of sensitiveEndpoints) {
      const req = {
        method: 'POST',
        url: endpoint,
        socket: { remoteAddress: '100.80.0.1' }, // Tailscale CGNAT 网段但未开启免密
        headers: { accept: 'application/json' },
      }
      let passed = false
      let statusCode = null
      const res = { writeHead(code) { statusCode = code }, end() {} }
      gate(req, res, () => { passed = true })
      assert.equal(passed, false, `${endpoint} 应被拦截`)
      assert.equal(statusCode, 401, `${endpoint} 应返回 401`)
    }

    // 公开端点仍应可从外部未授权访问
    const publicEndpoints = [
      ['GET', '/auth'],
      ['GET', '/api/remote-mobile/public-key'],
      ['POST', '/api/remote-mobile/verify'],
    ]
    for (const [method, endpoint] of publicEndpoints) {
      const req = {
        method,
        url: endpoint,
        socket: { remoteAddress: '100.80.0.1' },
        headers: { accept: 'text/html' },
      }
      let passed = false
      gate(req, {}, () => { passed = true })
      assert.equal(passed, true, `${endpoint} 应公开放行`)
    }
  })
})
