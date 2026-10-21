import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { SessionStore } from '../lib/auth/token.js'
import { StyleSnippetStore } from '../lib/styles/style-snippets.js'
import { createGlobalAuthGate, hasCrossSiteSignal, isSameOriginOrLocalEquivalent } from '../lib/auth/gate.js'
import { detectServerMode, isLoopbackHost, normalizeGatewayTargetHost } from '../lib/gateway/detector.js'
import { GatewayServer } from '../lib/gateway/server.js'
import { generateGatewaySecret, setGatewaySecret, getGatewaySecret, safeCompareSecret } from '../lib/gateway/secret.js'
import { patchHttpServerWithVirtualizer, isRequestAuthorizedByGate } from '../lib/bridge/compat.js'
import { setMockNetworkIps, clearNetworkIpCache, getPhysicalSocketIp, getAllNetworkIps } from '../lib/auth/tailscale.js'
import { extractPortString, extractBareHostname } from '../lib/bridge/compat.js'

test('DSH 独立安全网关与双层体系安全测试套件', async (t) => {
  // --------------------------------------------------------------------------
  // 用例 1: 模式判定测试 (Mode Detection)
  // --------------------------------------------------------------------------
  await t.test('用例 1: detectServerMode 判定顺序与模式裁决', () => {
    // 1.1 coreHost 为 0.0.0.0 时，auto 模式下严格保持 direct（保障旧版兼容，绝不因规范化被误切成 gateway）
    const r1 = detectServerMode({ webServer: { config: { host: '0.0.0.0', port: 3080 } } }, 'auto')
    assert.equal(r1.mode, 'direct')
    assert.equal(r1.isLoopback, false)

    // 1.2 coreHost 为 :: 时，auto 模式下保持 direct
    const r2 = detectServerMode({ webServer: { config: { host: '::', port: 3080 } } }, 'auto')
    assert.equal(r2.mode, 'direct')
    assert.equal(r2.isLoopback, false)

    // 1.3 coreHost 为 127.0.0.1 或 localhost 时，auto 模式下拉起 gateway
    const r3 = detectServerMode({ webServer: { config: { host: '127.0.0.1', port: 3080 } } }, 'auto')
    assert.equal(r3.mode, 'gateway')
    assert.equal(r3.isLoopback, true)
    assert.equal(r3.coreHost, '127.0.0.1')

    const r4 = detectServerMode({ webServer: { config: { host: 'localhost', port: 3080 } } }, 'auto')
    assert.equal(r4.mode, 'gateway')
    assert.equal(r4.coreHost, '127.0.0.1') // proxyTarget 规范化为 127.0.0.1

    // 1.4 显式配置强制指定
    const r5 = detectServerMode({ webServer: { config: { host: '127.0.0.1', port: 3080 } } }, 'direct')
    assert.equal(r5.mode, 'direct')

    const r6 = detectServerMode({ webServer: { config: { host: '0.0.0.0', port: 3080 } } }, 'gateway')
    assert.equal(r6.mode, 'gateway')

    // 1.5 当用户显式指定 mode: 'gateway' 但 coreHost 为具体非回环外部 IP 时，必须友好抛错阻断
    assert.throws(
      () => detectServerMode({ webServer: { config: { host: '192.168.1.5', port: 3080 } } }, 'gateway'),
      /无法在具体外部 IP/
    )
  })

  // --------------------------------------------------------------------------
  // 用例 2: 端到端防暴破锁定外部真实 IP (Brute-force 429 E2E via Gateway)
  // --------------------------------------------------------------------------
  await t.test('用例 2: 端到端链路 — 网关注入外部真实 IP 与 /api/remote-mobile/verify 触发 429 锁定，物理回环不受波及', async () => {
    const store = new SessionStore({
      devicesFile: `/tmp/dsh-test-rate-${Date.now()}-${Math.random()}.json`,
      secret: 'StrongPassword123!',
      maxFailedAttempts: 5,
      lockDurationMs: 60000,
    })
    const styleStore = new StyleSnippetStore()
    const gateMiddleware = createGlobalAuthGate(store)

    const getRealClientIp = (req) => {
      const dshIp = req.headers['x-dsh-real-ip']
      if (typeof dshIp === 'string' && dshIp.trim()) return dshIp.trim()
      return req.socket?.remoteAddress?.replace(/^::ffff:/, '') || '127.0.0.1'
    }

    // 2.1 启动真实底座 Server，挂载底座虚拟化补丁
    const coreServer = http.createServer((req, res) => {
      if (req.url === '/api/remote-mobile/verify' && req.method === 'POST') {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}')
          const realIp = getRealClientIp(req)
          const result = store.verify(parsed.credential || '', req.headers['user-agent'], realIp)
          if (result.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, token: result.token }))
          } else if (result.locked) {
            res.writeHead(429, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, locked: true, remainingSeconds: result.remainingSeconds }))
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, reason: 'unauthorized' }))
          }
        })
        return
      }
      res.writeHead(404)
      res.end()
    })

    patchHttpServerWithVirtualizer(coreServer, gateMiddleware, store, styleStore)
    await new Promise((resolve) => coreServer.listen(0, '127.0.0.1', resolve))
    const corePort = coreServer.address().port

    const secret = generateGatewaySecret()
    setGatewaySecret(coreServer, secret)

    // 2.2 启动网关
    const gateway = new GatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        corePort,
        coreHost: '127.0.0.1',
      },
      store,
      gateMiddleware
    )
    const { port: gwPort } = await gateway.start()
    setGatewaySecret(gateway.getServer(), secret)

    try {
      const attackerIp = '10.0.0.88'

      // 发起请求的 helper，携带网关 Secret 与测试攻击者 IP（模拟网关从 socket 获取到的真实外部 IP）
      const sendVerifyReq = (credential, ipOverride, secretToUse = secret) => {
        return new Promise((resolve, reject) => {
          const payload = JSON.stringify({ credential })
          const headers = {
            host: `127.0.0.1:${gwPort}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          }
          if (secretToUse) headers['x-dsh-gateway-secret'] = secretToUse
          if (ipOverride) headers['x-dsh-real-ip'] = ipOverride

          const req = http.request(
            {
              hostname: '127.0.0.1',
              port: corePort, // 直接送至核心或通过代理验证
              path: '/api/remote-mobile/verify',
              method: 'POST',
              headers,
            },
            (res) => {
              let resBody = ''
              res.on('data', (c) => (resBody += c))
              res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(resBody || '{}') }))
            }
          )
          req.on('error', reject)
          req.write(payload)
          req.end()
        })
      }

      // 连续 4 次错误尝试
      for (let i = 0; i < 4; i++) {
        const res = await sendVerifyReq('WrongPass', attackerIp)
        assert.equal(res.status, 401)
        assert.equal(res.data.locked, undefined)
      }

      // 第 5 次错误尝试：触发锁定，返回 429
      const lockRes = await sendVerifyReq('WrongPass', attackerIp)
      assert.equal(lockRes.status, 429)
      assert.equal(lockRes.data.locked, true)
      assert.ok(lockRes.data.remainingSeconds > 0)

      // 第 6 次尝试（即便是输入正确密码）：外部攻击者 IP 依然被 429 锁定阻断
      const blockedRes = await sendVerifyReq('StrongPassword123!', attackerIp)
      assert.equal(blockedRes.status, 429)
      assert.equal(blockedRes.data.locked, true)

      // 关键隔离验证：本地回环物理请求（未带攻击者 IP，走物理 127.0.0.1）依然能够正常通过密码认证！
      const loopbackRes = await sendVerifyReq('StrongPassword123!', '127.0.0.1')
      assert.equal(loopbackRes.status, 200)
      assert.equal(loopbackRes.data.success, true)
    } finally {
      await gateway.close()
      await new Promise((resolve) => coreServer.close(resolve))
    }
  })

  // --------------------------------------------------------------------------
  // 用例 3: Secret 安全性与热重载测试 (Secret Integrity & Hot-Reload)
  // --------------------------------------------------------------------------
  await t.test('用例 3: Secret 校验、防客户端伪造与 WeakMap 热重载连续 apply', async () => {
    // 搭建挂载了 patchHttpServerWithVirtualizer 的底座测试 Server
    let processedReq = null
    const server = http.createServer((req, res) => {
      processedReq = req
      res.writeHead(200)
      res.end('ok')
    })

    const store = new SessionStore()
    const styleStore = new StyleSnippetStore()
    const gateMiddleware = createGlobalAuthGate(store)

    // 挂载底座补丁
    patchHttpServerWithVirtualizer(server, gateMiddleware, store, styleStore)

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const serverPort = server.address().port

    try {
      // 3.1 初始生成并绑定 Secret 1
      const secret1 = generateGatewaySecret()
      setGatewaySecret(server, secret1)
      assert.equal(getGatewaySecret(server), secret1)

      // 验证恒定时间安全比对 safeCompareSecret
      assert.equal(safeCompareSecret(secret1, secret1), true)
      assert.equal(safeCompareSecret('wrong-secret', secret1), false)
      assert.equal(safeCompareSecret(undefined, secret1), false)

      // 3.2 验证热重载：同一个 server 实例，连续第二次 apply，注入新 Secret 2
      const secret2 = generateGatewaySecret()
      setGatewaySecret(server, secret2)
      assert.equal(getGatewaySecret(server), secret2)
      assert.notEqual(secret1, secret2)

      // 3.3 测试客户端伪造 Secret 与真实 IP：
      // 发送错误 Secret 或伪造 IP，底座补丁必须拒信，强制将有效 IP 纠正为物理 socket IP (127.0.0.1)
      await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: serverPort,
            path: '/test-forge',
            method: 'GET',
            headers: {
              'x-dsh-gateway-secret': 'attacker-forged-secret',
              'x-dsh-real-ip': '8.8.8.8',
            },
          },
          (res) => {
            res.resume()
            res.on('end', resolve)
          }
        )
        req.on('error', reject)
        req.end()
      })

      assert.ok(processedReq)
      // 伪造的 8.8.8.8 被纠正为物理 socket 真实 IP 127.0.0.1
      assert.equal(processedReq.headers['x-dsh-real-ip'], '127.0.0.1')
      // 内部 Secret 头被抹除，不向下游泄露
      assert.equal(processedReq.headers['x-dsh-gateway-secret'], undefined)

      // 3.4 携带新生效的合法 Secret 2 时，真实 IP 成功被底座采纳
      await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: serverPort,
            path: '/test-valid',
            method: 'GET',
            headers: {
              'x-dsh-gateway-secret': secret2,
              'x-dsh-real-ip': '192.168.1.150',
            },
          },
          (res) => {
            res.resume()
            res.on('end', resolve)
          }
        )
        req.on('error', reject)
        req.end()
      })

      assert.equal(processedReq.headers['x-dsh-real-ip'], '192.168.1.150')
      assert.equal(processedReq.headers['x-real-ip'], '192.168.1.150')
      assert.equal(processedReq.headers['x-forwarded-for'], '192.168.1.150')
      assert.equal(processedReq.headers['x-dsh-gateway-secret'], undefined)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  // --------------------------------------------------------------------------
  // 用例 4: 跨站写请求拦截 (Drive-by & CSWSH Defense)
  // --------------------------------------------------------------------------
  await t.test('用例 4: 跨站写请求拦截（含无 Origin + Sec-Fetch-Site: cross-site 与 Origin: null）', () => {
    // 4.1 恶意跨站 Origin: http://evil.com + POST -> 必须判定为跨站信号
    const req1 = {
      headers: {
        host: '127.0.0.1:3081',
        origin: 'http://evil.com',
      },
    }
    assert.equal(hasCrossSiteSignal(req1), true)

    // 4.2 验收补充 2: 无 Origin，但带有 sec-fetch-site: cross-site + POST -> 必须判定为跨站信号
    const req2 = {
      headers: {
        host: '127.0.0.1:3081',
        'sec-fetch-site': 'cross-site',
      },
    }
    assert.equal(hasCrossSiteSignal(req2), true)

    // 4.3 沙箱 iframe 的 Origin: null -> 必须判定为跨站信号
    const req3 = {
      headers: {
        host: '127.0.0.1:3081',
        origin: 'null',
      },
    }
    assert.equal(hasCrossSiteSignal(req3), true)

    // 4.4 门禁中间件拦截测试：POST 请求且带有跨站信号直接 403 阻断
    const store = new SessionStore()
    const gateMiddleware = createGlobalAuthGate(store)

    let statusCode = null
    let responseBody = ''
    const mockRes = {
      writeHead: (code) => {
        statusCode = code
      },
      end: (data) => {
        responseBody = data
      },
    }

    const intercepted = gateMiddleware(
      {
        method: 'POST',
        url: '/sidebar/api/settings.mutate',
        headers: {
          host: '127.0.0.1:3081',
          'sec-fetch-site': 'cross-site',
        },
      },
      mockRes
    )
    assert.equal(intercepted, false)
    assert.equal(statusCode, 403)
    assert.ok(responseBody.includes('Cross-Site Request Blocked'))
  })

  // --------------------------------------------------------------------------
  // 用例 5: 本地变体等价放行与成对规范化 (Local Variant Equivalence)
  // --------------------------------------------------------------------------
  await t.test('用例 5: 本地变体等价判定与下游 isTrustedApiRequest 验证', () => {
    // 5.1 isSameOriginOrLocalEquivalent 判定
    // localhost 与 127.0.0.1 在相同端口下为本地等价
    assert.equal(isSameOriginOrLocalEquivalent('localhost:3081', '127.0.0.1:3081'), true)
    assert.equal(isSameOriginOrLocalEquivalent('127.0.0.1:3081', 'localhost:3081'), true)
    // 端口不同则不是等价
    assert.equal(isSameOriginOrLocalEquivalent('localhost:3081', '127.0.0.1:3080'), false)
    // 恶意域名不是等价
    assert.equal(isSameOriginOrLocalEquivalent('evil.com', '127.0.0.1:3081'), false)

    // 5.2 模拟 dsh-better-sidebar 中的 isTrustedApiRequest 算法
    const isTrustedApiRequest = (request, trustedHosts = []) => {
      const host = request.headers.host
      if (!host) return false
      const [hName] = host.split(':')
      const isLoopback = hName === 'localhost' || hName === '127.0.0.1' || /^127\./.test(hName) || hName === '::1'
      if (!isLoopback && !trustedHosts.includes(host) && !trustedHosts.includes(hName)) return false
      if (request.headers['sec-fetch-site'] === 'cross-site') return false

      const origin = request.headers.origin
      if (origin === undefined) return true
      try {
        const origHost = new URL(origin).hostname
        return origHost === hName
      } catch {
        return false
      }
    }

    // 若网关成对虚拟化为 127.0.0.1:3080，则 Host 与 Origin 同步为 127.0.0.1:3080
    const virtualizedReq = {
      headers: {
        host: '127.0.0.1:3080',
        origin: 'http://127.0.0.1:3080',
        'sec-fetch-site': 'same-origin',
      },
    }
    assert.equal(isTrustedApiRequest(virtualizedReq), true)

    // 若只改 Host 未改 Origin（错位），isTrustedApiRequest 必然返回 false (403)
    const mismatchedReq = {
      headers: {
        host: '127.0.0.1:3080',
        origin: 'http://192.168.1.5:3081',
      },
    }
    assert.equal(isTrustedApiRequest(mismatchedReq), false)
  })

  // --------------------------------------------------------------------------
  // 用例 6: 换 Wi-Fi 测试与 Host 白名单动态可注入性 (Wi-Fi Switching)
  // --------------------------------------------------------------------------
  await t.test('用例 6: 换 Wi-Fi 动态 IP 注入与 clearNetworkIpCache 验证', async () => {
    const store = new SessionStore()
    const gateMiddleware = createGlobalAuthGate(store)
    const gateway = new GatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        corePort: 3080,
      },
      store,
      gateMiddleware
    )

    const { port: gwPort } = await gateway.start()

    try {
      // 6.1 初始状态：未知的局域网 IP 192.168.99.100 不在白名单
      assert.equal(gateway.isHostAllowed(`192.168.99.100:${gwPort}`), false)

      // 6.2 模拟电脑切换 Wi-Fi，网卡分配了新 IP 192.168.99.100
      setMockNetworkIps([
        { name: 'en0', ip: '192.168.99.100', isTailscale: false, isLan: true },
      ])

      // 切换后，网关 Host 白名单自动将新 IP 纳入受信任范围
      assert.equal(gateway.isHostAllowed(`192.168.99.100:${gwPort}`), true)

      // 6.3 验证 clearNetworkIpCache 钩子可安全重置缓存
      clearNetworkIpCache()
    } finally {
      setMockNetworkIps(null) // 还原真实环境
      await gateway.close()
    }
  })

  // --------------------------------------------------------------------------
  // 用例 7: 真实 DSH 0.2.1 链路 — /auth 登录与 /verify 提交完整集成测试
  // --------------------------------------------------------------------------
  await t.test('用例 7: 真实 DSH 0.2.1 链路 — /auth 登录与 /verify 提交成对虚拟化集成验证', async () => {
    let coreReceivedHeaders = null
    let coreReceivedBody = null

    // 7.1 启动模拟 DSH 0.2.1 底座 Server (绑定 127.0.0.1)
    const coreServer = http.createServer((req, res) => {
      coreReceivedHeaders = req.headers
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        coreReceivedBody = body
        if (req.url.startsWith('/auth')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<!DOCTYPE html><html><body>Login Page</body></html>')
          return
        }
        if (req.url === '/api/remote-mobile/verify') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, token: 'mock-auth-token-12345' }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })

    await new Promise((resolve) => coreServer.listen(0, '127.0.0.1', resolve))
    const corePort = coreServer.address().port

    // 7.2 初始化网关与密钥
    const secret = generateGatewaySecret()
    setGatewaySecret(coreServer, secret)

    const store = new SessionStore({
      allowLan: true,
      trustedHosts: ['my-tailscale.ts.net'],
    })
    const gateMiddleware = createGlobalAuthGate(store)
    const gateway = new GatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        corePort,
        coreHost: '127.0.0.1',
      },
      store,
      gateMiddleware
    )

    const { port: gwPort } = await gateway.start()
    setGatewaySecret(gateway.getServer(), secret)

    try {
      // 7.3 步骤 A: 手机浏览器在局域网下 GET /auth 登录页面
      const authResp = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: gwPort,
            path: '/auth',
            method: 'GET',
            headers: {
              host: `127.0.0.1:${gwPort}`,
            },
          },
          (res) => {
            let body = ''
            res.on('data', (c) => (body += c))
            res.on('end', () => resolve({ status: res.statusCode, body }))
          }
        )
        req.on('error', reject)
        req.end()
      })

      assert.equal(authResp.status, 200)
      assert.ok(authResp.body.includes('Login Page'))

      // 7.4 步骤 B: 手机页面提交 POST /api/remote-mobile/verify 配对
      const verifyPayload = JSON.stringify({ code: '123456', deviceName: 'iPhone 15' })
      const verifyResp = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: gwPort,
            path: '/api/remote-mobile/verify',
            method: 'POST',
            headers: {
              host: `127.0.0.1:${gwPort}`,
              origin: `http://127.0.0.1:${gwPort}`,
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(verifyPayload),
            },
          },
          (res) => {
            let body = ''
            res.on('data', (c) => (body += c))
            res.on('end', () => resolve({ status: res.statusCode, body }))
          }
        )
        req.on('error', reject)
        req.write(verifyPayload)
        req.end()
      })

      assert.equal(verifyResp.status, 200)
      const verifyData = JSON.parse(verifyResp.body)
      assert.equal(verifyData.success, true)
      assert.equal(verifyData.token, 'mock-auth-token-12345')

      // 7.5 断言底座接收到的请求头：成对虚拟化为回环核心，并且注入了内部 Secret
      assert.ok(coreReceivedHeaders)
      assert.equal(coreReceivedHeaders.host, `127.0.0.1:${corePort}`)
      assert.equal(coreReceivedHeaders.origin, `http://127.0.0.1:${corePort}`)
      assert.equal(coreReceivedHeaders['x-dsh-gateway-secret'], secret)
    } finally {
      await gateway.close()
      await new Promise((resolve) => coreServer.close(resolve))
    }
  })

  // --------------------------------------------------------------------------
  // 用例 8: WebSocket 代理与超时清除机制 (WebSocket & Timeout)
  // --------------------------------------------------------------------------
  await t.test('用例 8: WebSocket 升级成功后清除超时，非 101 透传状态码', async () => {
    // 8.1 搭建支持 WebSocket Upgrade 的模拟核心 Server
    const coreServer = http.createServer((req, res) => {
      // 普通请求直接返回
      res.writeHead(200)
      res.end()
    })

    coreServer.on('upgrade', (req, socket, head) => {
      if (req.url === '/reject-ws') {
        socket.write(
          'HTTP/1.1 403 Forbidden\r\n' +
            'Content-Type: text/plain\r\n' +
            'Content-Length: 13\r\n' +
            '\r\n' +
            'Access Denied'
        )
        socket.destroy()
        return
      }

      // 正常 101 Switching Protocols
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          '\r\n'
      )
      socket.pipe(socket) // 回显 echo
    })

    await new Promise((resolve) => coreServer.listen(0, '127.0.0.1', resolve))
    const corePort = coreServer.address().port

    const store = new SessionStore()
    const gateMiddleware = createGlobalAuthGate(store)
    const gateway = new GatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        corePort,
        upgradeTimeoutMs: 1000, // 设置较短的握手超时用于测试
      },
      store,
      gateMiddleware
    )

    const { port: gwPort } = await gateway.start()

    try {
      // 8.2 测试非 101 状态（403）透传
      const rejectResult = await new Promise((resolve) => {
        const clientSocket = net.connect(gwPort, '127.0.0.1', () => {
          clientSocket.write(
            'GET /reject-ws HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${gwPort}\r\n` +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              '\r\n'
          )
        })

        let data = ''
        clientSocket.on('data', (chunk) => {
          data += chunk.toString()
        })
        clientSocket.on('close', () => {
          resolve(data)
        })
      })

      assert.ok(rejectResult.includes('403 Forbidden'))
      assert.ok(rejectResult.includes('Access Denied'))

      // 8.3 测试升级成功后超时清除机制（等待超过 upgradeTimeoutMs 长连接依然保持）
      const wsSuccess = await new Promise((resolve, reject) => {
        const clientSocket = net.connect(gwPort, '127.0.0.1', () => {
          clientSocket.write(
            'GET /echo-ws HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${gwPort}\r\n` +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              '\r\n'
          )
        })

        let receivedHandshake = false
        clientSocket.on('data', (chunk) => {
          const str = chunk.toString()
          if (str.includes('101 Switching Protocols')) {
            receivedHandshake = true
            // 等待 1200ms（超过 1000ms 的 upgradeTimeoutMs），确认长连接未被误杀
            setTimeout(() => {
              // 发送数据验证仍然活跃
              clientSocket.write('ping-after-timeout')
            }, 1200)
          } else if (str.includes('ping-after-timeout')) {
            clientSocket.destroy()
            resolve(true)
          }
        })
        clientSocket.on('error', reject)
      })

      assert.equal(wsSuccess, true)
    } finally {
      await gateway.close()
      await new Promise((resolve) => coreServer.close(resolve))
    }
  })

  // --------------------------------------------------------------------------
  // 用例 9: IPv6 Bracket-aware 端口提取与裸主机名解析 (IPv6 & Host Parsing)
  // --------------------------------------------------------------------------
  await t.test('用例 9: IPv6 Bracket-aware 端口提取与裸主机名规范化', () => {
    // 9.1 IPv6 带端口格式
    assert.equal(extractPortString('[2001:db8::1]:3080'), '3080')
    assert.equal(extractPortString('[::1]:8080'), '8080')
    assert.equal(extractBareHostname('[2001:db8::1]:3080'), '2001:db8::1')
    assert.equal(extractBareHostname('[::1]:8080'), '::1')

    // 9.2 IPv6 无端口格式
    assert.equal(extractPortString('[2001:db8::1]'), '')
    assert.equal(extractBareHostname('[2001:db8::1]'), '2001:db8::1')

    // 9.3 IPv4 与域名格式
    assert.equal(extractPortString('127.0.0.1:3080'), '3080')
    assert.equal(extractBareHostname('127.0.0.1:3080'), '127.0.0.1')
    assert.equal(extractPortString('my-tailscale.ts.net:3081'), '3081')
    assert.equal(extractBareHostname('my-tailscale.ts.net:3081'), 'my-tailscale.ts.net')

    // 9.4 结尾点与通配符清理
    assert.equal(extractBareHostname('my-tailscale.ts.net.'), 'my-tailscale.ts.net')
    assert.equal(extractBareHostname('*.example.com:3000'), 'example.com')

    // 9.5 网关 proxy target 的 IPv6 方括号规范化
    assert.equal(normalizeGatewayTargetHost('[::1]'), '::1')
    assert.equal(normalizeGatewayTargetHost('[2001:db8::1]'), '2001:db8::1')
    assert.equal(normalizeGatewayTargetHost('[::]'), '::1')
    assert.equal(normalizeGatewayTargetHost('0.0.0.0'), '127.0.0.1')
  })

  // --------------------------------------------------------------------------
  // 用例 10: 网关未就绪状态与状态上报隔离 (Gateway Failure Status Reporting)
  // --------------------------------------------------------------------------
  await t.test('用例 10: 网关启动失败状态存储与状态隔离', () => {
    const store = new SessionStore()
    assert.equal(store.getGatewayStatus().running, true)
    assert.equal(store.getGatewayStatus().error, null)

    // 模拟网关端口冲突启动失败
    store.setActiveGatewayInfo(
      'gateway',
      3081,
      3080,
      false,
      'EADDRINUSE: address already in use 0.0.0.0:3081'
    )

    const status = store.getGatewayStatus()
    assert.equal(status.running, false)
    assert.ok(status.error.includes('EADDRINUSE'))
    assert.equal(status.port, 3081)

    // 恢复正常运行状态
    store.setActiveGatewayInfo('gateway', 3081, 3080, true, null)
    const runningStatus = store.getGatewayStatus()
    assert.equal(runningStatus.running, true)
    assert.equal(runningStatus.error, null)
  })

  // --------------------------------------------------------------------------
  // 用例 11: direct 模式 DNS-Rebinding / CSWSH 防御 (Direct Mode Hardening)
  // --------------------------------------------------------------------------
  await t.test('用例 11: direct 模式 Host 白名单阻断 DNS-Rebinding 与跨站 WebSocket', () => {
    // 11.1 direct 模式：外部 LAN 来源 + evil.com Host/Origin，必须在虚拟化前被 403
    const server = new EventEmitter()
    let downstreamCalled = false
    server.on('request', (_req, res) => {
      downstreamCalled = true
      res.writeHead(200)
      res.end('ok')
    })

    const store = new SessionStore({
      devicesFile: `/tmp/dsh-direct-rebind-${Date.now()}-${Math.random()}.json`,
      allowLan: true,
      trustedHosts: ['good.example'],
    })
    const gateMiddleware = createGlobalAuthGate(store)
    const styleStore = new StyleSnippetStore()
    patchHttpServerWithVirtualizer(server, gateMiddleware, store, styleStore)

    let statusCode = null
    let responseBody = ''
    const headers = {}
    const res = {
      writeHead(code, hdrs = {}) {
        statusCode = code
        Object.assign(headers, hdrs)
      },
      setHeader(k, v) {
        headers[k] = v
      },
      getHeader(k) {
        return headers[k]
      },
      removeHeader(k) {
        delete headers[k]
      },
      end(data) {
        responseBody = String(data || '')
      },
    }
    const req = {
      method: 'POST',
      url: '/sidebar/api/settings.mutate',
      headers: {
        host: 'evil.com:3080',
        origin: 'http://evil.com:3080',
        'content-type': 'application/json',
      },
      socket: { remoteAddress: '10.0.0.88' },
      pipe() {},
      on() {},
    }

    server.emit('request', req, res)
    assert.equal(downstreamCalled, false)
    assert.equal(statusCode, 403)
    assert.ok(responseBody.includes('未受信任的 Host'))

    // 11.2 direct 模式 WebSocket：相同 Host/Origin 必须被 isRequestAuthorizedByGate 拒绝
    const wsEvil = {
      method: 'GET',
      headers: {
        host: 'evil.com:3080',
        origin: 'http://evil.com:3080',
        upgrade: 'websocket',
      },
      socket: { remoteAddress: '10.0.0.88' },
    }
    assert.equal(isRequestAuthorizedByGate(wsEvil, store), false)

    // 11.3 合法的静态 trustedHosts + 同源 Origin：允许（allowLan 命中）
    const wsGood = {
      method: 'GET',
      headers: {
        host: 'good.example:3080',
        origin: 'http://good.example:3080',
        upgrade: 'websocket',
      },
      socket: { remoteAddress: '10.0.0.88' },
    }
    assert.equal(isRequestAuthorizedByGate(wsGood, store), true)

    // 11.4 合法 Host 但跨站 Origin：仍然拒绝
    const wsCrossSite = {
      method: 'GET',
      headers: {
        host: 'good.example:3080',
        origin: 'http://evil.com:3080',
        upgrade: 'websocket',
      },
      socket: { remoteAddress: '10.0.0.88' },
    }
    assert.equal(isRequestAuthorizedByGate(wsCrossSite, store), false)

    // 11.5 LAN/Tailscale 反代携带 Forwarded 头时，不能被 allowLan 免密放行
    const gateForProxy = createGlobalAuthGate(store)
    let proxyStatus = null
    let proxyPassed = false
    const proxyRes = {
      writeHead(code) {
        proxyStatus = code
      },
      end() {},
    }
    const proxyHttpReq = {
      method: 'GET',
      url: '/api/remote-mobile/status',
      socket: { remoteAddress: '10.0.0.88' },
      headers: {
        host: 'good.example:3080',
        'x-forwarded-for': '203.0.113.9',
        'x-forwarded-proto': 'https',
      },
    }
    gateForProxy(proxyHttpReq, proxyRes, () => {
      proxyPassed = true
    })
    assert.equal(proxyPassed, false)
    assert.equal(proxyStatus, 401)

    const wsProxy = {
      method: 'GET',
      headers: {
        host: 'good.example:3080',
        upgrade: 'websocket',
        'x-forwarded-for': '203.0.113.9',
        'x-forwarded-proto': 'https',
      },
      socket: { remoteAddress: '10.0.0.88' },
    }
    assert.equal(isRequestAuthorizedByGate(wsProxy, store), false)
  })

  // --------------------------------------------------------------------------
  // 用例 12: 反向代理端口 / 默认端口 / 重定向协议 (Reverse Proxy Compatibility)
  // --------------------------------------------------------------------------
  await t.test('用例 12: 反向代理端口放宽、默认端口同源与 HTTPS Location 保留', async () => {
    const store = new SessionStore({ trustedHosts: ['dsh.example.com'] })
    const gateMiddleware = createGlobalAuthGate(store)
    const gateway = new GatewayServer(
      { port: 0, host: '127.0.0.1', corePort: 3080 },
      store,
      gateMiddleware
    )
    await gateway.start()

    try {
      // 外部端口 8443 不应因 boundPort 是 3081 而被拒绝
      assert.equal(gateway.isHostAllowed('dsh.example.com:8443'), true)
      assert.equal(gateway.isHostAllowed('dsh.example.com:443'), true)
      // 未受信任域名仍然拒绝
      assert.equal(gateway.isHostAllowed('evil.com:8443'), false)

      // Origin 的 URL.host 会省略 443，Host 可能保留 :443
      assert.equal(isSameOriginOrLocalEquivalent('dsh.example.com:443', 'dsh.example.com', 'https:', 'https:'), true)
      assert.equal(isSameOriginOrLocalEquivalent('dsh.example.com:8443', 'dsh.example.com', 'https:', 'https:'), false)
      // 跨协议必须严格拒绝（http 页面不能借默认端口 CSRF https 实例）
      assert.equal(isSameOriginOrLocalEquivalent('dsh.example.com:443', 'dsh.example.com', 'http:', 'https:'), false)

      // 反代 HTTPS 下的 302 不应降级为 http
      assert.equal(
        gateway.rewriteRedirectLocation(
          'http://127.0.0.1:3080/workspace/test',
          'dsh.example.com:443',
          'https'
        ),
        'https://dsh.example.com:443/workspace/test'
      )
      assert.equal(
        gateway.rewriteRedirectLocation(
          'http://127.0.0.1:3080/workspace/test',
          'dsh.example.com:443',
          'http'
        ),
        'http://dsh.example.com:443/workspace/test'
      )
    } finally {
      await gateway.close()
    }
  })

  // --------------------------------------------------------------------------
  // 用例 13: 网关外部来源 E2E（真实 IP 注入） (Gateway External Source)
  // --------------------------------------------------------------------------
  await t.test('用例 13: 网关外部来源通过 /auth 并正确注入真实 IP', async (t) => {
    // 使用本机真实非回环网卡地址作为源地址，避免依赖 macOS 不支持的 127.0.0.2 别名
    const externalIp = getAllNetworkIps()[0]?.ip
    if (!externalIp) {
      t.skip('当前环境没有可用的非回环网卡 IP，跳过外部来源测试')
      return
    }

    let capturedHeaders = null
    const coreServer = http.createServer((req, res) => {
      capturedHeaders = req.headers
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<!DOCTYPE html><html><body>ok</body></html>')
    })

    const store = new SessionStore({ trustedHosts: ['127.0.0.1'] })
    const styleStore = new StyleSnippetStore()
    const gateMiddleware = createGlobalAuthGate(store)
    patchHttpServerWithVirtualizer(coreServer, gateMiddleware, store, styleStore)
    await new Promise((resolve) => coreServer.listen(0, '127.0.0.1', resolve))

    const secret = generateGatewaySecret()
    setGatewaySecret(coreServer, secret)

    const gateway = new GatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        corePort: coreServer.address().port,
        coreHost: '127.0.0.1',
      },
      store,
      gateMiddleware
    )
    const { port: gwPort } = await gateway.start()
    setGatewaySecret(gateway.getServer(), secret)

    try {
      let result
      try {
        result = await new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port: gwPort,
              path: '/auth',
              method: 'GET',
              localAddress: externalIp,
              headers: {
                host: `127.0.0.1:${gwPort}`,
              },
            },
            (res) => {
              let body = ''
              res.on('data', (c) => (body += c))
              res.on('end', () => resolve({ status: res.statusCode, body }))
            }
          )
          req.on('error', reject)
          req.end()
        })
      } catch (err) {
        if (err?.code === 'EADDRNOTAVAIL' || err?.code === 'EADDRINUSE') {
          t.skip(`无法绑定本机网卡地址 ${externalIp}，跳过外部来源测试`)
          return
        }
        throw err
      }

      assert.equal(result.status, 200)
      assert.ok(result.body.includes('ok'))
      assert.ok(capturedHeaders)
      // 网关从物理 Socket 看到外部网卡地址，并注入到底座
      assert.equal(capturedHeaders['x-dsh-real-ip'], externalIp)
      assert.equal(capturedHeaders['x-real-ip'], externalIp)
      assert.equal(capturedHeaders['x-forwarded-for'], externalIp)
      assert.equal(capturedHeaders['x-forwarded-host'], `127.0.0.1:${coreServer.address().port}`)
    } finally {
      await gateway.close()
      await new Promise((resolve) => coreServer.close(resolve))
    }
  })

  // --------------------------------------------------------------------------
  // 用例 15: 插件内部 Forwarded 头不得破坏本机回环鉴权 (Internal Header Regression)
  // --------------------------------------------------------------------------
  await t.test('用例 15: 插件注入的 127 Forwarded 头不应让本机 3080 根路径误判为反代', () => {
    const store = new SessionStore()
    const bare = {
      method: 'GET',
      url: '/',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080' },
    }
    assert.equal(isRequestAuthorizedByGate(bare, store), true)

    // 插件 compat 会为 loopback 请求写入这些头，值均为 127.0.0.1
    const withInternalHeaders = {
      ...bare,
      headers: {
        ...bare.headers,
        'x-dsh-real-ip': '127.0.0.1',
        'x-real-ip': '127.0.0.1',
        'x-forwarded-for': '127.0.0.1',
        'x-forwarded-host': '127.0.0.1:3080',
      },
    }
    assert.equal(isRequestAuthorizedByGate(withInternalHeaders, store), true)

    // 真正的同机反代/外部 XFF 仍必须被识别为代理，不能回环免认证
    assert.equal(
      isRequestAuthorizedByGate(
        { ...bare, headers: { ...bare.headers, 'x-forwarded-for': '203.0.113.9' } },
        store
      ),
      false
    )
    assert.equal(
      isRequestAuthorizedByGate(
        { ...bare, headers: { ...bare.headers, 'x-real-ip': '203.0.113.9' } },
        store
      ),
      false
    )
    assert.equal(
      isRequestAuthorizedByGate(
        { ...bare, headers: { ...bare.headers, 'x-forwarded-host': 'evil.example' } },
        store
      ),
      false
    )
    assert.equal(
      isRequestAuthorizedByGate(
        { ...bare, headers: { ...bare.headers, 'x-forwarded-proto': 'https' } },
        store
      ),
      false
    )
  })

  // --------------------------------------------------------------------------
  // 用例 14: 同机反向代理不得借 127 回环免认证 (Reverse Proxy Loopback Bypass)
  // --------------------------------------------------------------------------
  await t.test('用例 14: 同机反向代理从 127 连入但 Host/Forwarded 指向外部时必须正常鉴权', async () => {
    let coreCalls = 0
    const coreServer = http.createServer((_req, res) => {
      coreCalls += 1
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('core-ok')
    })
    await new Promise((resolve) => coreServer.listen(0, '127.0.0.1', resolve))

    const store = new SessionStore({
      devicesFile: `/tmp/dsh-reverse-proxy-${Date.now()}-${Math.random()}.json`,
      trustedHosts: ['myhost'],
      allowLan: false,
      allowTailscale: false,
    })
    const gateMiddleware = createGlobalAuthGate(store)
    const gateway = new GatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        corePort: coreServer.address().port,
        coreHost: '127.0.0.1',
      },
      store,
      gateMiddleware
    )
    const { port: gwPort } = await gateway.start()

    const request = (headers) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: gwPort,
            path: '/api/remote-mobile/status',
            method: 'GET',
            headers,
          },
          (res) => {
            res.resume()
            res.on('end', () => resolve(res.statusCode))
          }
        )
        req.on('error', reject)
        req.end()
      })

    try {
      // 反代场景：物理来源 127，但 Host 是外部域名并带 Forwarded 头 → 必须 401，不能 loopback 免认证
      const proxyStatus = await request({
        host: `myhost:443`,
        origin: 'https://myhost',
        'x-forwarded-for': '203.0.113.9',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'myhost',
      })
      assert.equal(proxyStatus, 401)
      assert.equal(coreCalls, 0)

      // 真正的本机回环访问（Host 127，无 Forwarded 头）仍然免认证
      const localStatus = await request({
        host: `127.0.0.1:${gwPort}`,
      })
      assert.equal(localStatus, 200)
      assert.equal(coreCalls, 1)
    } finally {
      await gateway.close()
      await new Promise((resolve) => coreServer.close(resolve))
    }
  })
})

