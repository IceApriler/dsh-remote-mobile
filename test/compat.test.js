import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { SessionStore } from '../lib/auth/token.js'
import { patchHttpServerWithVirtualizer, CRYPTO_POLYFILL_SNIPPET, CLIPBOARD_POLYFILL_SNIPPET, DRAGGABLE_NAV_SNIPPET } from '../lib/bridge/compat.js'
import { getClientIp } from '../lib/auth/tailscale.js'
import { StyleSnippetStore } from '../lib/styles/style-snippets.js'

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
        assert.ok(endCalledWith.includes('id="dsh-clipboard-polyfill"'))
        assert.ok(endCalledWith.includes('navigator.clipboard'))
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

  await t.test('回环 socket 不做 Host/Origin/sec-fetch-site 洗白（保留原始同源信号）', (t, done) => {
    const mockServer = new EventEmitter()
    const store = new SessionStore({ devicesFile: `/tmp/dsh-compat-loopback-${Date.now()}.json` })
    const gateMiddleware = (req, res, next) => { next?.(); return true }

    let checked = false
    mockServer.on('request', (req) => {
      if (checked) return
      checked = true
      // 回环请求（含 DNS-Rebinding 形态的恶意 Host）必须原样保留，供下游自身的同源与 Rebinding 校验使用
      assert.equal(req.headers.host, 'evil.com:3080')
      assert.equal(req.headers.origin, 'http://evil.com:3080')
      assert.equal(req.headers['sec-fetch-site'], 'cross-site')
      // 内部真实 IP 记录头仍然无条件写入（路由层 getRealClientIp 依赖）
      assert.equal(req.headers['x-dsh-real-ip'], '127.0.0.1')
      assert.equal(req.headers['x-real-ip'], '127.0.0.1')
      done()
    })

    patchHttpServerWithVirtualizer(mockServer, gateMiddleware, store)

    const req = {
      headers: {
        host: 'evil.com:3080',
        origin: 'http://evil.com:3080',
        'sec-fetch-site': 'cross-site',
      },
      socket: { remoteAddress: '127.0.0.1' },
    }
    const res = {
      writeHead() {},
      setHeader() {},
      end() {},
    }

    mockServer.emit('request', req, res)
  })

  await t.test('回环下 localhost / [::1] Host 变体归一化为 127.0.0.1，sec-fetch-site 保留', (t, done) => {
    const mockServer = new EventEmitter()
    const store = new SessionStore({ devicesFile: `/tmp/dsh-compat-loopback2-${Date.now()}.json` })
    const gateMiddleware = (req, res, next) => { next?.(); return true }

    let checked = false
    mockServer.on('request', (req) => {
      if (checked) return
      checked = true
      assert.equal(req.headers.host, '127.0.0.1:3080')
      assert.equal(req.headers.origin, 'http://127.0.0.1:3080')
      // 同源信号不被洗白：浏览器原始 sec-fetch-site 原样透传
      assert.equal(req.headers['sec-fetch-site'], 'same-origin')
      done()
    })

    patchHttpServerWithVirtualizer(mockServer, gateMiddleware, store)

    const req = {
      headers: {
        host: 'localhost:3080',
        origin: 'http://localhost:3080',
        'sec-fetch-site': 'same-origin',
      },
      socket: { remoteAddress: '::1' },
    }
    const res = {
      writeHead() {},
      setHeader() {},
      end() {},
    }

    mockServer.emit('request', req, res)
  })

  await t.test('移动端请求注入 data-dsh-mobile 标记与样式片段，桌面端不注入', (t, done) => {
    const mockServer = new EventEmitter()
    const store = new SessionStore({ devicesFile: `/tmp/dsh-compat-style-1787460740359.json` })
    const styleStore = new StyleSnippetStore(`/tmp/dsh-compat-style-snippets-1787460740359.json`)

    const gateMiddleware = (req, res, next) => {
      next?.()
      return true
    }
    patchHttpServerWithVirtualizer(mockServer, gateMiddleware, store, styleStore)

    let mobileChecked = false
    let desktopChecked = false

    const finishBoth = () => {
      if (mobileChecked && desktopChecked) done()
    }

    const runCase = (ua, assertFn) => {
      let headersWritten = {}
      const req = {
        headers: { host: '192.168.1.100:3080', 'user-agent': ua },
        socket: { remoteAddress: '192.168.1.100' },
      }
      const res = {
        writeHead(code, hdrs = {}) { headersWritten = { ...headersWritten, ...hdrs } },
        setHeader(k, v) { headersWritten[k] = v },
        getHeader(k) { return headersWritten[k] },
        end(data) {
          assertFn(data ? data.toString('utf8') : '')
        },
      }
      mockServer.emit('request', req, res)
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end('<!DOCTYPE html><html lang="zh"><head><title>DSH</title></head><body>x</body></html>')
    }

    styleStore.upsertCustom({ name: '测试片段', css: 'body { background: red; }', pcEnabled: false, mobileEnabled: true })

    runCase('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', (html) => {
      assert.ok(html.includes('data-dsh-mobile="1"'))
      assert.ok(html.includes('id="dsh-remote-mobile-style-snippets"'))
      assert.ok(html.includes('id="dsh-draggable-nav"'))
      assert.ok(html.includes('@media (max-width: 900px)')) // 移动端启用片段为窄屏块
      assert.ok(html.includes('body { background: red; }'))
      mobileChecked = true
      finishBoth()
    })

    runCase('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36', (html) => {
      // UA 标记仍仅移动端：精确检查 <html> 标签属性（预设 CSS 选择器文本中合法地包含 data-dsh-mobile 字样）
      assert.ok(!/<html[^>]*data-dsh-mobile/.test(html))
      assert.ok(html.includes('id="dsh-remote-mobile-style-snippets"')) // 样式注入与 UA 无关
      assert.ok(html.includes('@media (max-width: 900px)')) // 窄屏块在桌面也注入 → PC 拉小窗口生效
      assert.ok(html.includes('body { background: red; }')) // 自定义片段 CSS 已进入（媒体查询块内）
      assert.ok(html.includes('id="dsh-draggable-nav"')) // 拖拽脚本全端注入（仅折叠时工作）
      assert.ok(html.includes('id="dsh-crypto-polyfill"'))
      assert.ok(html.includes('id="dsh-clipboard-polyfill"')) // 非安全上下文 clipboard polyfill 全端注入
      desktopChecked = true
      finishBoth()
    })
  })

  await t.test('注入 HTML 时移除尚未发送的显式 Content-Length 防截断', (t, done) => {
    const mockServer = new EventEmitter()
    const store = new SessionStore({ devicesFile: `/tmp/dsh-compat-cl-1787464351648.json` })
    const gateMiddleware = (req, res, next) => {
      next?.()
      return true
    }
    patchHttpServerWithVirtualizer(mockServer, gateMiddleware, store)

    const headersWritten = {}
    const req = {
      headers: { host: '127.0.0.1:3080' },
      socket: { remoteAddress: '127.0.0.1' },
    }
    const res = {
      setHeader(k, v) { headersWritten[k] = v },
      getHeader(k) { return headersWritten[k] },
      removeHeader(k) {
        const lower = String(k).toLowerCase()
        for (const key of Object.keys(headersWritten)) {
          if (key.toLowerCase() === lower) delete headersWritten[key]
        }
      },
      end(data) {
        const html = data ? data.toString('utf8') : ''
        assert.ok(html.includes('id="dsh-crypto-polyfill"'))
        assert.ok(html.includes('id="dsh-clipboard-polyfill"'))
        // 注入后显式 Content-Length 应被移除，避免 ERR_CONTENT_LENGTH_MISMATCH
        assert.ok(!('content-length' in headersWritten))
        assert.ok(!('Content-Length' in headersWritten))
        done()
      },
    }

    mockServer.emit('request', req, res)
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('content-length', '123')
    res.end('<!DOCTYPE html><html><head><title>DSH</title></head><body>x</body></html>')
  })

  await t.test('socket 虚拟化后经 __dsh_real_remote_address__ 保留真实客户端 IP', (t, done) => {
    const mockServer = new EventEmitter()
    const store = new SessionStore({ devicesFile: `/tmp/dsh-compat-test-${Date.now()}.json` })

    // 门禁放行，且执行真实 IP 记录（步骤 0）与 socket 虚拟化
    const gateMiddleware = (req, res, next) => {
      next?.()
      return true
    }

    let assertDoneOnce = false
    mockServer.on('request', (req, res) => {
      if (assertDoneOnce) return
      assertDoneOnce = true

      // 首次请求：真实 remoteAddress 应先被记录到 socket 上
      assert.equal(req.socket.__dsh_real_remote_address__, '192.168.3.34')

      // 虚拟化后 socket.remoteAddress 已变为 127.0.0.1
      assert.equal(req.socket.remoteAddress, '127.0.0.1')

      // 但 getClientIp 应优先读取 __dsh_real_remote_address__ 返回真实 IP
      assert.equal(getClientIp(req), '192.168.3.34')

      // 模拟该连接上第二次（keep-alive 复用）请求：真实 IP 必须仍然保留
      const req2 = { headers: req.headers, socket: req.socket, url: '/auth' }
      assert.equal(getClientIp(req2), '192.168.3.34')
      done()
    })

    patchHttpServerWithVirtualizer(mockServer, gateMiddleware, store)

    // 构造 socket，使其 remoteAddress 可被 defineProperty 覆盖
    const socket = { remoteAddress: '192.168.3.34' }
    const req = {
      headers: { host: '100.81.241.99:3080' },
      socket,
    }
    const res = {
      writeHead() {},
      setHeader() {},
      end() {},
    }

    mockServer.emit('request', req, res)
  })

  await t.test('防误收起守卫：点击项目名称（条目主体）后不程序化收起抽屉', () => {
    // 回归守卫：点击侧边栏条目任意部位（含项目名称主体，不只按钮/箭头）都应被记录，
    // 使选中高亮后浮现的展开/收起箭头与新增/更多操作图标有停留操作时间。
    assert.ok(DRAGGABLE_NAV_SNIPPET.includes('var lastEntryTapAt = 0'))
    assert.ok(DRAGGABLE_NAV_SNIPPET.includes('lastEntryTapAt = Date.now()'))
    assert.ok(!DRAGGABLE_NAV_SNIPPET.includes('lastSecondaryTapAt'))
    assert.ok(DRAGGABLE_NAV_SNIPPET.includes('isSidebarToggle && Date.now() - lastEntryTapAt < 900'))
    // 条目主体匹配：仍然限定在侧边栏内的 treeitem / sidebar-entry
    assert.ok(DRAGGABLE_NAV_SNIPPET.includes('[role="treeitem"], [data-dsh-part="sidebar-entry"]'))
    // 收起行为仍被守卫吞掉（真实用户点击收起按钮走浏览器合成事件，不受影响）
    assert.ok(DRAGGABLE_NAV_SNIPPET.includes('收起侧边栏|Collapse sidebar|Open sidebar'))
  })
})
