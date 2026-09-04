import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { unlinkSync } from 'node:fs'
import { SessionStore } from '../lib/auth/token.js'
import { takeOverConnectionAuth, isRequestAuthorizedByGate } from '../lib/bridge/compat.js'

test('官方 connection 服务透明接管测试 (takeOverConnectionAuth)', async (t) => {
  const tmpFiles = []
  const createTmpDb = (prefix) => {
    const p = `${tmpdir()}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    tmpFiles.push(p)
    return p
  }

  t.after(() => {
    for (const f of tmpFiles) {
      try { unlinkSync(f) } catch {}
    }
  })

  const tmpDb = createTmpDb('dsh-takeover-test')
  const store = new SessionStore({
    devicesFile: tmpDb,
    allowLan: false,
    allowTailscale: false,
  })

  // 构造模拟的官方 connection 服务对象
  function createMockConnection(launchToken = 'official-launch-token-xyz') {
    return {
      browserAuth: {
        launchToken,
        isAuthenticated(req) {
          return Boolean(req?.headers?.cookie?.includes('dsh-official-session'))
        },
        authorizeIndex(req, res) {
          if (req.url?.includes(`token=${launchToken}`)) {
            res.writeHead(303, { 'Set-Cookie': 'dsh-official-session=1' })
            res.end()
            return false
          }
          if (this.isAuthenticated(req)) return true
          res.writeHead(401)
          res.end('dsh web authentication required')
          return false
        },
      },
      requestRejection(req) {
        return this.browserAuth.isAuthenticated(req) ? undefined : 401
      },
      authorizeIndex(req, res) {
        return this.browserAuth.authorizeIndex(req, res)
      },
    }
  }

  await t.test('未认证外部设备：底层保持原本 401 拦截', () => {
    const conn = createMockConnection()
    takeOverConnectionAuth(conn, store)

    const unauthReq = {
      headers: { host: '10.10.1.13:3080' },
      socket: { remoteAddress: '10.10.1.99' },
      url: '/',
    }

    assert.equal(isRequestAuthorizedByGate(unauthReq, store), false)
    assert.equal(conn.browserAuth.isAuthenticated(unauthReq), false)
    assert.equal(conn.requestRejection(unauthReq), 401)
  })

  await t.test('已配对外部设备（持有长效会话凭证）：即使不带官方 token，官方 connection 全链路放行', () => {
    const conn = createMockConnection()
    takeOverConnectionAuth(conn, store)

    // 在 store 中登记配对设备，获取 365 天会话 token
    const { code } = store.generateShortCode()
    const verifyRes = store.verify(code, 'iPhone Safari', '10.10.1.88')
    assert.ok(verifyRes.success)
    const token = verifyRes.token

    const pairedReq = {
      headers: {
        host: '10.10.1.13:3080',
        cookie: `dsh_mobile_token=${token}`,
      },
      socket: { remoteAddress: '10.10.1.88' },
      url: '/',
    }

    // 1. isRequestAuthorizedByGate 识别为已认证
    assert.equal(isRequestAuthorizedByGate(pairedReq, store), true)

    // 2. browserAuth.isAuthenticated 被透明短路为 true
    assert.equal(conn.browserAuth.isAuthenticated(pairedReq), true)

    // 3. requestRejection 放行（返回 undefined，杜绝 401）
    assert.equal(conn.requestRejection(pairedReq), undefined)

    // 4. authorizeIndex 允许直接下发 HTML，不写 401
    let writtenCode = 0
    const mockRes = {
      writeHead(c) { writtenCode = c },
      end() {},
    }
    const allowIndex = conn.authorizeIndex(pairedReq, mockRes)
    assert.equal(allowIndex, true)
    assert.equal(writtenCode, 0) // 没被写入 401
  })

  await t.test('局域网 LAN 免密直连开启：外部局域网设备免 token 畅通访问', () => {
    const lanStore = new SessionStore({
      devicesFile: createTmpDb('dsh-lan-test'),
      allowLan: true,
    })
    const conn = createMockConnection()
    takeOverConnectionAuth(conn, lanStore)

    const lanReq = {
      headers: { host: '192.168.1.5:3080' },
      socket: { remoteAddress: '192.168.1.50' },
      url: '/',
    }

    assert.equal(isRequestAuthorizedByGate(lanReq, lanStore), true)
    assert.equal(conn.browserAuth.isAuthenticated(lanReq), true)
    assert.equal(conn.requestRejection(lanReq), undefined)
    assert.equal(conn.authorizeIndex(lanReq, {}), true)
  })

  await t.test('Tailscale 免密直连开启：Tailscale 节点免 token 畅通访问', () => {
    const tsStore = new SessionStore({
      devicesFile: createTmpDb('dsh-ts-test'),
      allowTailscale: true,
    })
    const conn = createMockConnection()
    takeOverConnectionAuth(conn, tsStore)

    const tsReq = {
      headers: { host: '100.80.1.2:3080' },
      socket: { remoteAddress: '100.80.1.50' },
      url: '/',
    }

    assert.equal(isRequestAuthorizedByGate(tsReq, tsStore), true)
    assert.equal(conn.browserAuth.isAuthenticated(tsReq), true)
    assert.equal(conn.requestRejection(tsReq), undefined)
    assert.equal(conn.authorizeIndex(tsReq, {}), true)
  })

  await t.test('本机 127.0.0.1 回环无条件放行', () => {
    const conn = createMockConnection()
    takeOverConnectionAuth(conn, store)

    const loopbackReq = {
      headers: { host: '127.0.0.1:3080' },
      socket: { remoteAddress: '127.0.0.1' },
      url: '/',
    }

    assert.equal(isRequestAuthorizedByGate(loopbackReq, store), true)
    assert.equal(conn.browserAuth.isAuthenticated(loopbackReq), true)
    assert.equal(conn.requestRejection(loopbackReq), undefined)
    assert.equal(conn.authorizeIndex(loopbackReq, {}), true)
  })

  await t.test('携带官方有效 launchToken 时依然触发官方原生 token 换取与重定向', () => {
    const conn = createMockConnection('launch-token-abc')
    takeOverConnectionAuth(conn, store)

    let statusCode = 0
    let headersWritten = {}
    const mockRes = {
      writeHead(code, h) {
        statusCode = code
        headersWritten = h
      },
      end() {},
    }

    const tokenReq = {
      headers: { host: '127.0.0.1:3080' },
      socket: { remoteAddress: '127.0.0.1' },
      url: '/?token=launch-token-abc',
    }

    // 走官方原生 token 换 cookie 流程
    const resBool = conn.authorizeIndex(tokenReq, mockRes)
    assert.equal(resBool, false)
    assert.equal(statusCode, 303)
    assert.ok(headersWritten['Set-Cookie']?.includes('dsh-official-session'))
  })

  await t.test('URL 参数提取与官方 token 解耦验证：只提取 rm_token 与 auth_token，不再误提取官方 token', () => {
    // 官方 token 参数不会被提取为移动端插件 session token
    const officialReq = {
      headers: {},
      url: '/?token=official-process-token-12345',
    }
    assert.equal(store.extractTokenFromRequest(officialReq), null)

    // rm_token 能够被正确提取
    const rmTokenReq = {
      headers: {},
      url: '/?rm_token=custom-rm-token-67890',
    }
    assert.equal(store.extractTokenFromRequest(rmTokenReq), 'custom-rm-token-67890')

    // auth_token 能够被正确提取
    const authTokenReq = {
      headers: {},
      url: '/?auth_token=custom-auth-token-abcde',
    }
    assert.equal(store.extractTokenFromRequest(authTokenReq), 'custom-auth-token-abcde')
  })
})
