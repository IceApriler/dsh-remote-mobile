import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from '../lib/auth/token.js'
import { createRoutes } from '../lib/routes/api.js'
import {
  parseArgs,
  formatDuration,
  formatClock,
  formatCodeReport,
  runCodeCommand,
  runPasswordCommand,
  main,
} from '../lib/cli/index.js'
import {
  isLocalBaseUrl,
  candidatePorts,
  candidateHosts,
  candidateBaseUrls,
  readLocalSettings,
  settingsFilePath,
  writePasswordOffline,
  findEndpoint,
  generatePairingCode,
  setLongTermPassword,
  clearLongTermPassword,
  probeEndpoint,
} from '../lib/cli/client.js'

/** 创建临时目录与其中的 DSH 主目录 */
function createTempHome() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-rm-cli-'))
  return {
    root,
    dshHome: root,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {}
    },
  }
}

/** 用插件真实路由处理器起一个最小 HTTP 服务，模拟运行中的 DSH */
async function startPluginServer() {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-rm-cli-srv-'))
  const store = new SessionStore({ devicesFile: join(tmp, 'devices.json') })
  const routes = createRoutes(store)
  const server = http.createServer(async (req, res) => {
    const pathname = (req.url || '/').split('?')[0]
    const route = routes.find(
      (item) => item.path === pathname && (item.method || 'GET') === (req.method || 'GET'),
    )
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    try {
      await route.handler(req, res)
    } catch (error) {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(error))
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    store,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {}
    },
  }
}

test('命令行参数解析与渲染 (parseArgs / format*)', async (t) => {
  await t.test('解析 code 子命令与常用选项（含 = 形式与短选项）', () => {
    const parsed = parseArgs(['code', '--port=3081', '--json', '--new'])
    assert.equal(parsed.command, 'code')
    assert.equal(parsed.options.port, 3081)
    assert.equal(parsed.options.json, true)
    assert.equal(parsed.options.newCode, true)
    assert.equal(parsed.error, undefined)
  })

  await t.test('缺少子命令时裸参数不隐式当作设置密码（安全护栏，退出码 2）', async () => {
    // 曾经的行为：无子命令 + 位置参数会被当作 password 的明文参数，误敲即改密
    assert.equal(await main(['Abcdef12345']), 2)
    assert.equal(await main(['--json']), 2)
  })

  await t.test('isLocalBaseUrl：回环/本机网卡为真，其它主机为假', () => {
    assert.equal(isLocalBaseUrl('http://127.0.0.1:3081'), true)
    assert.equal(isLocalBaseUrl('http://localhost:3080'), true)
    assert.equal(isLocalBaseUrl('http://[::1]:3081'), true)
    assert.equal(isLocalBaseUrl('http://192.168.1.8:3081', ['192.168.1.8']), true)
    assert.equal(isLocalBaseUrl('http://example.com:3081', ['192.168.1.8']), false)
    // 解析失败按本机处理，避免误报警告
    assert.equal(isLocalBaseUrl('not a url'), true)
  })

  await t.test('解析 password 子命令的位置参数与模式开关', () => {
    const parsed = parseArgs(['password', '--stdin', '--offline', 'MyPass123'])
    assert.equal(parsed.command, 'password')
    assert.equal(parsed.options.stdin, true)
    assert.equal(parsed.options.offline, true)
    assert.deepEqual(parsed.positionals, ['MyPass123'])
  })

  await t.test('--help / --version 优先于子命令', () => {
    assert.equal(parseArgs(['code', '--help']).command, 'help')
    assert.equal(parseArgs(['-V']).command, 'version')
  })

  await t.test('未知选项、缺失取值与重复子命令均返回明确错误', () => {
    assert.match(parseArgs(['code', '--nope']).error || '', /未知选项/)
    assert.match(parseArgs(['code', '--port']).error || '', /需要一个值/)
    assert.match(parseArgs(['code', 'password']).error || '', /只能指定一个子命令/)
    assert.match(parseArgs(['code', '--port', 'abc']).error || '', /1-65535/)
  })

  await t.test('时长与时间格式化便于终端阅读', () => {
    assert.equal(formatDuration(9), '0 秒')
    assert.equal(formatDuration(65_000), '1 分 5 秒')
    assert.equal(formatDuration(5 * 60_000), '5 分 0 秒')
    assert.match(formatClock(Date.now()), /^\d{2}:\d{2}:\d{2}$/)
  })
})

test('配对码报告渲染 (formatCodeReport)', async (t) => {
  const baseStatus = {
    success: true,
    lanIp: '192.168.1.8',
    tailscaleIp: '100.88.0.3',
    proxy: { mode: 'proxy', running: true, activePort: 3081, corePort: 3080 },
  }

  await t.test('包含码值、剩余时间、局域网与 Tailscale 地址以及配对入口', () => {
    const now = Date.now()
    const report = formatCodeReport({
      code: '492731',
      expiresAt: now + 4 * 60_000,
      baseUrl: 'http://127.0.0.1:3081',
      status: baseStatus,
      reused: true,
      now,
    })
    assert.match(report, /配对码 {3}492731/)
    assert.match(report, /4 分 0 秒/)
    assert.match(report, /http:\/\/192\.168\.1\.8:3081\/auth/)
    assert.match(report, /http:\/\/100\.88\.0\.3:3081（Tailscale）/)
    assert.match(report, /未刷新/)
    assert.match(report, /proxy 模式/)
  })

  await t.test('代理未运行与 direct 模式给出对应提示', () => {
    const directReport = formatCodeReport({
      code: '111111',
      expiresAt: Date.now() + 60_000,
      baseUrl: 'http://127.0.0.1:3080',
      status: { success: true, proxy: { mode: 'direct', running: false, corePort: 3080 } },
      reused: false,
    })
    assert.match(directReport, /本次新生成/)
    assert.match(directReport, /direct 模式/)
    assert.match(directReport, /127\.0\.0\.1:3080\/auth/)
  })
})

test('本地配置读取与候选端点推导', async (t) => {
  await t.test('settings.json 中的 proxyPort 排在常见默认端口之前且去重', () => {
    assert.deepEqual(candidatePorts(undefined, { proxyPort: 3081 }), [3081, 3080, 3082, 3083])
    assert.deepEqual(candidatePorts(4000, { proxyPort: 3081 }), [4000, 3081, 3080, 3082, 3083])
  })

  await t.test('候选主机始终包含回环地址，且 --host 优先', () => {
    const hosts = candidateHosts('10.1.2.3')
    assert.equal(hosts[0], '10.1.2.3')
    assert.equal(hosts[1], '127.0.0.1')
    assert.ok(hosts.includes('127.0.0.1'))
  })

  await t.test('--base-url 直接短路探测，不做端口枚举', () => {
    assert.deepEqual(candidateBaseUrls({ baseUrl: 'http://127.0.0.1:3081/' }), ['http://127.0.0.1:3081'])
  })

  await t.test('读取临时 DSH_HOME 下的 settings.json，缺省时为空调', () => {
    const temp = createTempHome()
    try {
      assert.deepEqual(readLocalSettings(temp.dshHome), {})
      mkdirSync(join(temp.dshHome, 'remote-mobile'), { recursive: true })
      writeFileSync(
        settingsFilePath(temp.dshHome),
        JSON.stringify({ proxyPort: 4321, allowLan: true }),
        'utf8',
      )
      const settings = readLocalSettings(temp.dshHome)
      assert.equal(settings.proxyPort, 4321)
      assert.equal(settings.allowLan, true)
    } finally {
      temp.cleanup()
    }
  })
})

test('离线写入长期密码 (writePasswordOffline)', async (t) => {
  await t.test('无 settings.json 时创建文件并写入 scrypt 哈希，而非明文', () => {
    const temp = createTempHome()
    try {
      const result = writePasswordOffline(temp.dshHome, 'Abcdef12')
      assert.equal(result.ok, true)
      assert.equal(existsSync(result.path), true)
      const raw = JSON.parse(readFileSync(result.path, 'utf8'))
      assert.ok(typeof raw.secretHash === 'string' && raw.secretHash.length > 20)
      assert.ok(!JSON.stringify(raw).includes('Abcdef12'), '配置文件中不得出现明文密码')
      // 配置格式只保存哈希：既有的明文字段不会被写出（避免明文落盘）
      assert.equal(raw.secret, undefined)
    } finally {
      temp.cleanup()
    }
  })

  await t.test('保留文件内既有配置（allowLan / proxyPort / trustedHosts）', () => {
    const temp = createTempHome()
    try {
      mkdirSync(join(temp.dshHome, 'remote-mobile'), { recursive: true })
      writeFileSync(
        settingsFilePath(temp.dshHome),
        JSON.stringify({ allowLan: true, proxyPort: 4321, trustedHosts: ['app.example'] }),
        'utf8',
      )
      const result = writePasswordOffline(temp.dshHome, 'Abcdef12')
      assert.equal(result.ok, true)
      const raw = JSON.parse(readFileSync(result.path, 'utf8'))
      assert.equal(raw.allowLan, true)
      assert.equal(raw.proxyPort, 4321)
      assert.deepEqual(raw.trustedHosts, ['app.example'])
      assert.ok(raw.secretHash)
    } finally {
      temp.cleanup()
    }
  })

  await t.test('传空串表示清除密码', () => {
    const temp = createTempHome()
    try {
      writePasswordOffline(temp.dshHome, 'Abcdef12')
      const cleared = writePasswordOffline(temp.dshHome, '')
      assert.equal(cleared.ok, true)
      const raw = JSON.parse(readFileSync(cleared.path, 'utf8'))
      assert.equal(raw.secretHash, '')
    } finally {
      temp.cleanup()
    }
  })
})

test('与运行中的 DSH 交互（真实路由处理器 + 回环 HTTP）', async (t) => {
  const server = await startPluginServer()
  t.after(async () => {
    await server.close()
  })

  await t.test('探针能识别本插件服务，并拒绝非本插件的响应', async () => {
    const status = await probeEndpoint(server.baseUrl, { timeoutMs: 2000 })
    assert.ok(status)
    assert.equal(status.success, true)
    assert.ok(status.proxy)

    const other = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve))
    const otherPort = other.address().port
    const miss = await probeEndpoint(`http://127.0.0.1:${otherPort}`, { timeoutMs: 2000 })
    assert.equal(miss, null)
    await new Promise((resolve) => other.close(resolve))
  })

  await t.test('生成配对码后 /status 可窥视到同一个码（不刷新）', async () => {
    const generated = await generatePairingCode(server.baseUrl, { timeoutMs: 2000 })
    assert.equal(generated.ok, true)
    assert.match(String(generated.code), /^\d{6}$/)

    const endpoint = await findEndpoint({ baseUrl: server.baseUrl, timeoutMs: 2000 })
    assert.ok(endpoint)
    assert.equal(endpoint.status.pairingCode?.code, generated.code)

    // 再次窥视仍是同一个码
    const again = await findEndpoint({ baseUrl: server.baseUrl, timeoutMs: 2000 })
    assert.equal(again.status.pairingCode?.code, generated.code)
  })

  await t.test('通过 API 设置长期密码后 hasSecret 为真，清除后恢复为假', async () => {
    const before = await probeEndpoint(server.baseUrl, { timeoutMs: 2000 })
    assert.equal(Boolean(before.hasSecret), false)

    const set = await setLongTermPassword(server.baseUrl, 'Abcdef12', { timeoutMs: 2000 })
    assert.equal(set.ok, true)

    const after = await probeEndpoint(server.baseUrl, { timeoutMs: 2000 })
    assert.equal(after.hasSecret, true)

    const cleared = await clearLongTermPassword(server.baseUrl, { timeoutMs: 2000 })
    assert.equal(cleared.ok, true)
    const final = await probeEndpoint(server.baseUrl, { timeoutMs: 2000 })
    assert.equal(Boolean(final.hasSecret), false)
  })

  await t.test('弱密码被服务端拒绝并返回原因', async () => {
    const weak = await setLongTermPassword(server.baseUrl, '123456', { timeoutMs: 2000 })
    assert.equal(weak.ok, false)
    assert.ok(weak.error && weak.error.length > 0)
  })

  await t.test('runCodeCommand 文本输出包含配对码与配对入口', async () => {
    const chunks = []
    const code = await runCodeCommand({
      options: { baseUrl: server.baseUrl, timeoutMs: 2000 },
      stdout: (text) => chunks.push(text),
      stderr: (text) => chunks.push(text),
    })
    assert.equal(code, 0)
    const output = chunks.join('')
    assert.match(output, /配对码 {3}\d{6}/)
    assert.match(output, /\/auth/)
  })

  await t.test('runCodeCommand --json 输出机器可读结构', async () => {
    const chunks = []
    const exitCode = await runCodeCommand({
      options: { baseUrl: server.baseUrl, timeoutMs: 2000, json: true },
      stdout: (text) => chunks.push(text),
      stderr: (text) => chunks.push(text),
    })
    assert.equal(exitCode, 0)
    const payload = JSON.parse(chunks.join(''))
    assert.equal(payload.ok, true)
    assert.match(payload.code, /^\d{6}$/)
    assert.ok(payload.accessUrls.auth.endsWith('/auth'))
    // 测试桩没有真正启动安全接入代理，服务端上报 direct；CLI 必须如实透传并据此选端口
    assert.ok(payload.mode === 'proxy' || payload.mode === 'direct')
    assert.ok(Number.isInteger(payload.port) && payload.port > 0)
  })

  await t.test('runCodeCommand 无法连接时返回退出码 1 并给出排查建议', async () => {
    const chunks = []
    const exitCode = await runCodeCommand({
      options: { baseUrl: 'http://127.0.0.1:1', timeoutMs: 300 },
      stdout: (text) => chunks.push(text),
      stderr: (text) => chunks.push(text),
    })
    assert.equal(exitCode, 1)
    assert.match(chunks.join(''), /未找到正在运行的 DSH/)
  })

  await t.test('runPasswordCommand 走服务端即时生效路径', async () => {
    const chunks = []
    const exitCode = await runPasswordCommand({
      options: { baseUrl: server.baseUrl, timeoutMs: 2000 },
      secret: 'Abcdef12',
      stdout: (text) => chunks.push(text),
      stderr: (text) => chunks.push(text),
    })
    assert.equal(exitCode, 0)
    assert.match(chunks.join(''), /立即生效/)
    const status = await probeEndpoint(server.baseUrl, { timeoutMs: 2000 })
    assert.equal(status.hasSecret, true)
  })

  await t.test('runPasswordCommand 弱密码提前拦截且不发送请求', async () => {
    const chunks = []
    const exitCode = await runPasswordCommand({
      options: { baseUrl: server.baseUrl, timeoutMs: 2000 },
      secret: '123456',
      stdout: (text) => chunks.push(text),
      stderr: (text) => chunks.push(text),
    })
    assert.equal(exitCode, 1)
    assert.match(chunks.join(''), /密码强度不足/)
  })
})

test('runPasswordCommand 离线兜底写入配置', async (t) => {
  await t.test('--offline 不探测服务，直接写入 settings.json 并提示生效时机', async () => {
    const temp = createTempHome()
    try {
      const chunks = []
      const exitCode = await runPasswordCommand({
        options: { dshHome: temp.dshHome, offline: true },
        secret: 'Abcdef12',
        stdout: (text) => chunks.push(text),
        stderr: (text) => chunks.push(text),
      })
      assert.equal(exitCode, 0)
      const output = chunks.join('')
      assert.match(output, /下次启动 dsh web 时生效/)
      const raw = JSON.parse(readFileSync(settingsFilePath(temp.dshHome), 'utf8'))
      assert.ok(raw.secretHash)
    } finally {
      temp.cleanup()
    }
  })

  await t.test('服务不可达时自动回退到离线写入并给出警告', async () => {
    const temp = createTempHome()
    try {
      const chunks = []
      const exitCode = await runPasswordCommand({
        options: { dshHome: temp.dshHome, baseUrl: 'http://127.0.0.1:1', timeoutMs: 300 },
        secret: 'Abcdef12',
        stdout: (text) => chunks.push(text),
        stderr: (text) => chunks.push(text),
      })
      assert.equal(exitCode, 0)
      assert.match(chunks.join(''), /未连接到运行中的 DSH/)
      assert.ok(readLocalSettings(temp.dshHome).secretHash)
    } finally {
      temp.cleanup()
    }
  })

  await t.test('--clear 离线清除密码', async () => {
    const temp = createTempHome()
    try {
      writePasswordOffline(temp.dshHome, 'Abcdef12')
      const chunks = []
      const exitCode = await runPasswordCommand({
        options: { dshHome: temp.dshHome, offline: true, clear: true },
        stdout: (text) => chunks.push(text),
        stderr: (text) => chunks.push(text),
      })
      assert.equal(exitCode, 0)
      assert.equal(readLocalSettings(temp.dshHome).secretHash, undefined)
    } finally {
      temp.cleanup()
    }
  })
})
