import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { SessionStore, AUTH_COOKIE_NAME } from '../lib/auth/token.js'
import { StyleSnippetStore } from '../lib/styles/style-snippets.js'
import { createGlobalAuthGate } from '../lib/auth/gate.js'
import { detectServerMode, isLoopbackHost } from '../lib/gateway/detector.js'
import { GatewayServer } from '../lib/gateway/server.js'
import { injectTrustedHosts } from '../lib/bridge/compat.js'

test('DSH 独立安全网关与模式探测测试 (gateway)', async (t) => {
  await t.test('isLoopbackHost 准确识别回环与外网主机', () => {
    assert.equal(isLoopbackHost('127.0.0.1'), true)
    assert.equal(isLoopbackHost('127.0.0.2'), true)
    assert.equal(isLoopbackHost('localhost'), true)
    assert.equal(isLoopbackHost('::1'), true)
    assert.equal(isLoopbackHost(''), true)
    assert.equal(isLoopbackHost(undefined), true)
    assert.equal(isLoopbackHost(null), true)

    assert.equal(isLoopbackHost('0.0.0.0'), false)
    assert.equal(isLoopbackHost('::'), false)
    assert.equal(isLoopbackHost('192.168.1.100'), false)
    assert.equal(isLoopbackHost('100.81.241.49'), false)
    assert.equal(isLoopbackHost('10.0.0.1'), false)
  })

  await t.test('detectServerMode 默认 proxy 与旧配置回退裁决', () => {
    // 1. DSH 0.2.1+ 默认安全状态（仅 127.0.0.1）-> 默认 proxy
    const res1 = detectServerMode({ webServer: { config: { host: '127.0.0.1', port: 3080 } } })
    assert.equal(res1.mode, 'proxy')
    assert.equal(res1.corePort, 3080)
    assert.equal(res1.isLoopback, true)

    // 2. 无 host 属性（缺省）-> 默认 proxy
    const res2 = detectServerMode({ webServer: { port: 3080 } })
    assert.equal(res2.mode, 'proxy')

    // 3. 旧版 DSH 已配置 0.0.0.0 -> 自动回退 direct
    const res3 = detectServerMode({ webServer: { config: { host: '0.0.0.0', port: 3080 } } })
    assert.equal(res3.mode, 'direct')
    assert.equal(res3.isLoopback, false)

    // 4. 用户显式 direct 覆盖
    const res4 = detectServerMode({ webServer: { config: { host: '127.0.0.1' } } }, 'direct')
    assert.equal(res4.mode, 'direct')

    // 5. 显式 proxy 但核心已对外监听 -> 回退 direct
    const res5 = detectServerMode({ webServer: { config: { host: '0.0.0.0' } } }, 'proxy')
    assert.equal(res5.mode, 'direct')

    // 6. 显式 proxy + 具体外部 IP -> 同样回退 direct
    const res6 = detectServerMode({ webServer: { config: { host: '192.168.1.5' } } }, 'proxy')
    assert.equal(res6.mode, 'direct')
  })

  await t.test('GatewayServer 生命周期与 HTTP 代理转发集成测试', async () => {
    // 1. 搭建一个模拟的 DSH 本地核心 Server (127.0.0.1)
    let coreReceivedHeaders = null
    let coreReceivedUrl = null

    const coreServer = http.createServer((req, res) => {
      coreReceivedHeaders = req.headers
      coreReceivedUrl = req.url

      if (req.url === '/redirect-test') {
        res.writeHead(302, {
          Location: `http://127.0.0.1:${corePort}/workspace/test`,
        })
        res.end()
        return
      }

      if (req.url === '/events-stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        })
        res.write('data: hello\n\n')
        res.end()
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ core: true, url: req.url }))
    })

    await new Promise((resolve) => coreServer.listen(0, '127.0.0.1', resolve))
    const corePort = coreServer.address().port

    // 2. 创建 SessionStore 与安全网关
    const store = new SessionStore({
      allowTailscale: true,
      allowLan: false,
      // 测试使用固定的 Tailscale 风格 Host；真实环境该 IP 会出现在本机网卡列表中
      trustedHosts: ['100.81.241.49'],
    })
    const styleStore = new StyleSnippetStore()
    const gateMiddleware = createGlobalAuthGate(store)

    const gateway = new GatewayServer(
      {
        port: 0, // 自动挑选空闲端口进行测试
        host: '127.0.0.1',
        corePort,
        coreHost: '127.0.0.1',
      },
      store,
      gateMiddleware
    )

    const { port: gwPort } = await gateway.start()
    assert.ok(gwPort > 0)
    assert.equal(gateway.getBoundPort(), gwPort)
    assert.equal(gateway.getCorePort(), corePort)

    try {
      // 3. 测试未授权访问受保护路径（模拟非免密外网请求 192.168.x）
      // 使用带 remoteAddress 模拟或直连（127.0.0.1 在网关中因 Socket 是本机也会被 gateMiddleware 检查）
      // 为验证拦截，我们请求一个普通业务接口并带上非本地的 X-Real-IP 验证门禁拦截
      const get = (path, headers = {}) => {
        return new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port: gwPort,
              path,
              method: 'GET',
              headers,
            },
            (res) => {
              let body = ''
              res.on('data', (c) => (body += c))
              res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
            }
          )
          req.on('error', reject)
          req.end()
        })
      }

      // 4. 测试合法授权请求通过网关代理转发到底座
      const { code } = store.generateShortCode()
      const verifyRes = store.verify(code, 'iPhone', '127.0.0.1')
      assert.equal(verifyRes.success, true)
      const validToken = verifyRes.token

      const resp = await get('/api/workspace/list', {
        Cookie: `dsh_mobile_token=${validToken}`,
        Host: `100.81.241.49:${gwPort}`,
      })

      assert.equal(resp.status, 200)
      const data = JSON.parse(resp.body)
      assert.equal(data.core, true)
      assert.equal(data.url, '/api/workspace/list')

      // 验证底座接收到的代理头
      assert.ok(coreReceivedHeaders)
      assert.equal(coreReceivedHeaders['x-forwarded-host'], `127.0.0.1:${corePort}`)
      assert.equal(coreReceivedHeaders['x-original-host'], `100.81.241.49:${gwPort}`)
      assert.ok(coreReceivedHeaders['x-dsh-real-ip'])

      // 5. 测试 302 重定向 Location 头改写（防止手机误跳 127.0.0.1）
      const redirectResp = await get('/redirect-test', {
        Cookie: `dsh_mobile_token=${validToken}`,
        Host: `100.81.241.49:${gwPort}`,
      })
      assert.equal(redirectResp.status, 302)
      // 核心下发的是 127.0.0.1:corePort，网关改写为外部 Host
      assert.equal(redirectResp.headers.location, `http://100.81.241.49:${gwPort}/workspace/test`)

      // 6. 测试 SSE 长连接响应头透传与 x-accel-buffering: no
      const sseResp = await get('/events-stream', {
        Cookie: `dsh_mobile_token=${validToken}`,
        Host: `100.81.241.49:${gwPort}`,
      })
      assert.equal(sseResp.status, 200)
      assert.equal(sseResp.headers['x-accel-buffering'], 'no')
      assert.ok(sseResp.body.includes('data: hello'))
    } finally {
      // 7. 关闭网关与核心服务
      await gateway.close()
      await new Promise((resolve) => coreServer.close(resolve))
    }
  })

  await t.test('GatewayServer 端口占用冲突时自动递增探测', async () => {
    // 预先占用端口
    const busyServer = http.createServer((_req, res) => res.end())
    await new Promise((resolve) => busyServer.listen(0, '127.0.0.1', resolve))
    const busyPort = busyServer.address().port

    const store = new SessionStore()
    const styleStore = new StyleSnippetStore()
    const gateMiddleware = createGlobalAuthGate(store)

    const gateway = new GatewayServer(
      {
        port: busyPort,
        host: '127.0.0.1',
        corePort: 3080,
        autoIncrementPort: true,
      },
      store,
      gateMiddleware
    )

    try {
      const { port } = await gateway.start()
      // 成功自增绑定到了下一个端口
      assert.ok(port > busyPort)
      assert.equal(gateway.getBoundPort(), port)
    } finally {
      await gateway.close()
      await new Promise((resolve) => busyServer.close(resolve))
    }
  })

  await t.test('injectTrustedHosts 向 DSH connection 与 webRuntime 动态注入受信任主机', () => {
    const mockCtx = {
      webRuntime: {
        trustedHosts: ['127.0.0.1'],
      },
      connection: {
        trustedHosts: ['127.0.0.1'],
      },
    }

    injectTrustedHosts(mockCtx, [3080, 3081], ['10.10.0.254:3081'])

    assert.ok(mockCtx.webRuntime.trustedHosts.includes('127.0.0.1:3080'))
    assert.ok(mockCtx.webRuntime.trustedHosts.includes('127.0.0.1:3081'))
    assert.ok(mockCtx.connection.trustedHosts.includes('localhost:3080'))
    assert.ok(mockCtx.connection.trustedHosts.includes('localhost:3081'))
    assert.ok(mockCtx.webRuntime.trustedHosts.includes('10.10.0.254:3081'))
    assert.ok(mockCtx.connection.trustedHosts.includes('10.10.0.254:3081'))
  })

  await t.test('网关在代理 HTTP 请求时虚拟化内部 Host 与 Origin 以绕过生态插件围栏阻断', async () => {
    let capturedHeaders = null
    const mockCoreServer = http.createServer((req, res) => {
      capturedHeaders = req.headers
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    const corePort = await new Promise((resolve) => {
      mockCoreServer.listen(0, '127.0.0.1', () => {
        resolve(mockCoreServer.address().port)
      })
    })

    const store = new SessionStore({
      devicesFile: `/tmp/dsh-gw-test-headers-${Date.now()}.json`,
      initialBypassLan: true,
      trustedHosts: ['10.10.0.254'],
    })
    const styleStore = new StyleSnippetStore({
      snippetsFile: `/tmp/dsh-gw-styles-${Date.now()}.json`,
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

    try {
      const { port: gwPort } = await gateway.start()

      // 该请求模拟“同机反代”从 127 连入但 Host 为外部域名：
      // 不能走 loopback 免认证，需要使用有效 Token 走正常鉴权。
      const { code } = store.generateShortCode()
      const { token } = store.verify(code, 'TestDevice', '127.0.0.1')

      // 发起模拟客户端请求
      await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: gwPort,
            path: '/sidebar/api/settings.get',
            method: 'POST',
            headers: {
              host: `10.10.0.254:${gwPort}`,
              origin: `http://10.10.0.254:${gwPort}`,
              referer: `http://10.10.0.254:${gwPort}/`,
              'sec-fetch-site': 'same-origin',
              Cookie: `${AUTH_COOKIE_NAME}=${token}`,
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

      assert.ok(capturedHeaders)
      // 底座接收到的 Host 与 Origin 已经被虚拟化为内部回环核心
      assert.equal(capturedHeaders.host, `127.0.0.1:${corePort}`)
      assert.equal(capturedHeaders.origin, `http://127.0.0.1:${corePort}`)
      assert.equal(capturedHeaders.referer, `http://127.0.0.1:${corePort}/`)
      assert.equal(capturedHeaders['sec-fetch-site'], 'same-origin')
      // 虚拟化为回环核心以绕过生态插件围栏阻断，同时在 x-original-host 中保留原始 Host
      assert.equal(capturedHeaders['x-forwarded-host'], `127.0.0.1:${corePort}`)
      assert.equal(capturedHeaders['x-original-host'], `10.10.0.254:${gwPort}`)
    } finally {
      await gateway.close()
      await new Promise((resolve) => mockCoreServer.close(resolve))
    }
  })
})
