import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { SessionStore } from '../lib/auth/token.js'
import { patchHttpServerWithVirtualizer, CRYPTO_POLYFILL_SNIPPET } from '../lib/bridge/compat.js'

test('上下文虚拟化与兼容性补丁测试 (compat.ts)', async (t) => {
  await t.test('HTML 响应自动注入 crypto.randomUUID Polyfill 脚本', (t, done) => {
    const mockServer = new EventEmitter()
    const store = new SessionStore({ devicesFile: `/tmp/dsh-compat-test-${Date.now()}.json` })

    // 门禁直接放行
    const gateMiddleware = (req, res, next) => {
      next?.()
      return true
    }

    patchHttpServerWithVirtualizer(mockServer, gateMiddleware, store)

    const req = {
      headers: { host: '192.168.1.100:3080' },
      socket: { remoteAddress: '192.168.1.100' },
    }

    let endCalledWith = ''
    let headersWritten = {}

    const res = {
      writeHead(code, hdrs = {}) {
        headersWritten = { ...headersWritten, ...hdrs }
      },
      setHeader(k, v) {
        headersWritten[k] = v
      },
      getHeader(k) {
        return headersWritten[k]
      },
      end(data) {
        endCalledWith = data ? data.toString('utf8') : ''
        assert.ok(endCalledWith.includes('id="dsh-crypto-polyfill"'))
        assert.ok(endCalledWith.includes('randomUUID'))
        done()
      },
    }

    // 模拟服务端收到请求
    mockServer.emit('request', req, res)

    // 业务层返回包含 <head> 的 HTML
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!DOCTYPE html><html><head><title>DSH</title></head><body>Hello</body></html>')
  })

  await t.test('门禁放行后成功虚拟化 host, origin, sec-fetch-site 并注入真实 IP', (t, done) => {
    const mockServer = new EventEmitter()
    const store = new SessionStore({ devicesFile: `/tmp/dsh-compat-test-${Date.now()}.json` })

    const gateMiddleware = (req, res, next) => {
      next?.()
      return true
    }

    // 注册原始业务监听器
    mockServer.on('request', (req, res) => {
      // 验证虚拟化与真实 IP 保持
      assert.equal(req.headers['x-dsh-real-ip'], '100.81.241.99')
      assert.equal(req.headers['x-real-ip'], '100.81.241.99')
      assert.equal(req.headers['x-forwarded-host'], '100.81.241.99:3080')
      assert.equal(req.headers.host, '127.0.0.1:3080')
      assert.equal(req.headers.origin, 'http://127.0.0.1:3080')
      assert.equal(req.headers['sec-fetch-site'], 'same-origin')
      assert.equal(req.socket.remoteAddress, '127.0.0.1')
      done()
    })

    patchHttpServerWithVirtualizer(mockServer, gateMiddleware, store)

    const req = {
      headers: {
        host: '100.81.241.99:3080',
        origin: 'http://100.81.241.99:3080',
        'sec-fetch-site': 'cross-site',
      },
      socket: { remoteAddress: '100.81.241.99' },
    }
    const res = {
      writeHead() {},
      setHeader() {},
      end() {},
    }

    mockServer.emit('request', req, res)
  })
})
