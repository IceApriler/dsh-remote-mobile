import test from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, existsSync } from 'node:fs'
import { SessionStore, parseDeviceName } from '../lib/auth/token.js'

const TEST_FILE = `/tmp/dsh-test-devices-${Date.now()}.json`

test('SessionStore 与设备会话生命周期测试', async (t) => {
  t.after(() => {
    if (existsSync(TEST_FILE)) rmSync(TEST_FILE, { force: true })
  })

  const store = new SessionStore({
    allowTailscale: false,
    secret: 'mysecret2026',
    devicesFile: TEST_FILE,
  })

  await t.test('6 位配对码生成与验证', () => {
    const { code, token, expiresAt } = store.generateShortCode()
    assert.match(code, /^\d{6}$/)
    assert.ok(expiresAt > Date.now())

    // 错误配对码验证失败
    const fail = store.verify('000000', 'iPhone User-Agent')
    assert.equal(fail.success, false)

    // 正确配对码验证成功，派发 Session Token
    const ok = store.verify(code, 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', '100.81.241.50')
    assert.equal(ok.success, true)
    assert.ok(ok.token)

    // 验证成功后，配对码被一次性消费销毁，二次使用立即失效
    const secondTry = store.verify(code, 'Another Agent')
    assert.equal(secondTry.success, false)

    // 已授权 Token 能够通过 validateToken 校验
    assert.equal(store.validateToken(ok.token), true)
  })

  await t.test('长期密码验证与派发 Token', () => {
    const ok = store.verify('mysecret2026', 'Mozilla/5.0 (Linux; Android 13; SM-S918B) Chrome/112.0.0.0 Mobile Safari/537.36', '100.81.241.51')
    assert.equal(ok.success, true)
    assert.ok(ok.token)
    assert.equal(store.validateToken(ok.token), true)
  })

  await t.test('清空长期密码 (clearSecret) 并持久化', () => {
    store.updateOptions({ secret: '', secretHash: '' })
    assert.equal(store.hasSecret(), false)

    // 新实例恢复确认密码已被清空
    const storeCleared = new SessionStore({ devicesFile: TEST_FILE })
    assert.equal(storeCleared.hasSecret(), false)

    // 重新设置新密码
    store.updateOptions({ secret: 'mysecret2026' })
    assert.equal(store.hasSecret(), true)
  })

  await t.test('User-Agent 智能设备名解析', () => {
    assert.equal(parseDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Safari/604.1'), '📱 iPhone (Safari)')
    assert.equal(parseDeviceName('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/151.0 Mobile Safari/537.36'), '🤖 Android 手机 (Chrome)')
    assert.equal(parseDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36'), '💻 Mac (Chrome)')
  })

  await t.test('设备持久化落盘与新实例恢复', () => {
    const list = store.getSessionsList()
    assert.equal(list.count, 2)

    // 从磁盘恢复到新的 Store 实例
    const store2 = new SessionStore({ devicesFile: TEST_FILE })
    const list2 = store2.getSessionsList()
    assert.equal(list2.count, 2)
    assert.equal(list2.devices[0].deviceName.includes('Android') || list2.devices[0].deviceName.includes('iPhone'), true)
  })

  await t.test('单设备撤销 (revokeDevice) 与一键清空 (revokeAllSessions)', () => {
    const list = store.getSessionsList()
    const targetToken = list.devices[0].token

    // 单设备撤销
    const revoked = store.revokeDevice(targetToken)
    assert.equal(revoked, true)
    assert.equal(store.validateToken(targetToken), false)
    assert.equal(store.getSessionsList().count, 1)

    // 一键清空所有设备
    store.revokeAllSessions()
    assert.equal(store.getSessionsList().count, 0)
  })

  await t.test('EventEmitter 事件流广播与重连上线检测 (device-connected & device-online)', () => {
    const eventStore = new SessionStore({
      devicesFile: `/tmp/dsh-events-test-${Date.now()}.json`,
      secret: 'pass123456',
    })

    let connectedEvent = null
    let onlineEvent = null
    let revokedEvent = null

    eventStore.on('device-connected', (d) => { connectedEvent = d })
    eventStore.on('device-online', (d) => { onlineEvent = d })
    eventStore.on('device-revoked', (d) => { revokedEvent = d })

    // 1. 配对接入触发 device-connected
    const res = eventStore.verify('pass123456', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Safari/604.1', '100.81.241.99')
    assert.equal(res.success, true)
    assert.ok(connectedEvent)
    assert.equal(connectedEvent.ip, '100.81.241.99')

    // 2. 立即 validateToken（未超时），不重复触发 onlineEvent
    eventStore.validateToken(res.token, '100.81.241.99')
    assert.equal(onlineEvent, null)

    // 3. 模拟 10 分钟后设备重新发起访问，触发 device-online
    const session = eventStore.sessions.get(res.token)
    session.lastSeenAt = Date.now() - 10 * 60 * 1000
    eventStore.validateToken(res.token, '100.81.241.99')
    assert.ok(onlineEvent)
    assert.equal(onlineEvent.token, res.token)

    // 4. 撤销触发 device-revoked
    eventStore.revokeDevice(res.token)
    assert.ok(revokedEvent)
    assert.equal(revokedEvent.token, res.token)
  })

  await t.test('防暴力破解限流：连续 5 次失败自动锁定 IP 15 分钟与管理员手动解锁', () => {
    const rateStore = new SessionStore({
      devicesFile: `/tmp/dsh-rate-test-${Date.now()}.json`,
      secret: 'securePass2026',
      maxFailedAttempts: 5,
      lockDurationMs: 15 * 60 * 1000,
    })

    const attackerIp = '10.10.1.199'

    // 1. 记录打开页面计数
    const v1 = rateStore.recordAuthVisit(attackerIp)
    assert.equal(v1.allowed, true)
    const v2 = rateStore.recordAuthVisit(attackerIp)
    assert.equal(v2.allowed, true)

    // 2. 前 4 次尝试错误密码，不会触发锁定
    for (let i = 1; i <= 4; i++) {
      const res = rateStore.verify('wrong_code', 'Mozilla/5.0', attackerIp)
      assert.equal(res.success, false)
      assert.equal(res.locked, undefined)
    }

    // 3. 第 5 次尝试错误密码，立即触发 IP 锁定
    const res5 = rateStore.verify('wrong_code', 'Mozilla/5.0', attackerIp)
    assert.equal(res5.success, false)
    assert.equal(res5.locked, true)
    assert.ok(res5.reason?.includes('锁定'))

    // 4. 处于锁定期间，即使输入正确密码也被直接拦截拒绝
    const resDuringLock = rateStore.verify('securePass2026', 'Mozilla/5.0', attackerIp)
    assert.equal(resDuringLock.success, false)
    assert.equal(resDuringLock.locked, true)

    // 5. 锁定期间打开 /auth 页面也受限
    const vLocked = rateStore.recordAuthVisit(attackerIp)
    assert.equal(vLocked.allowed, false)

    // 6. 检查安全审计统计
    const stats = rateStore.getIpSecurityStats()
    const attackerStat = stats.find(s => s.ip === attackerIp)
    assert.ok(attackerStat)
    assert.equal(attackerStat.failedAttempts, 5)
    assert.equal(attackerStat.authVisits, 3)
    assert.ok(attackerStat.lockedUntil > Date.now())

    // 7. 管理员一键解除锁定
    const unlocked = rateStore.unlockIp(attackerIp)
    assert.equal(unlocked, true)

    // 8. 解除锁定后，输入正确密码成功通过
    const resAfterUnlock = rateStore.verify('securePass2026', 'Mozilla/5.0', attackerIp)
    assert.equal(resAfterUnlock.success, true)
    assert.ok(resAfterUnlock.token)
  })

  await t.test('IP 访问与防暴破计数持久化落盘与重启恢复 (Persistence)', () => {
    const testFile = `/tmp/dsh-ip-persist-test-${Date.now()}.json`
    const store1 = new SessionStore({
      devicesFile: testFile,
      secret: 'mySecret2026',
      maxFailedAttempts: 5,
    })

    const targetIp = '10.10.1.88'
    store1.recordAuthVisit(targetIp)
    store1.recordAuthVisit(targetIp)
    store1.verify('wrong_pass', 'Mozilla/5.0', targetIp)

    // 模拟重启：新建 store2 实例读取同一个持久化文件
    const store2 = new SessionStore({
      devicesFile: testFile,
      secret: 'mySecret2026',
    })

    const restoredStats = store2.getIpSecurityStats()
    const targetStat = restoredStats.find(s => s.ip === targetIp)
    assert.ok(targetStat)
    assert.equal(targetStat.authVisits, 2)
    assert.equal(targetStat.failedAttempts, 1)
    assert.equal(targetStat.totalAttempts, 1)
  })

  await t.test('免密直连设备自动归因与登记 (Tailscale & LAN Bypass)', () => {
    const testFile = `/tmp/dsh-bypass-test-${Date.now()}.json`
    const store = new SessionStore({ devicesFile: testFile })

    const bypassIp = '100.64.0.55'
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    const session = store.registerBypassDevice(bypassIp, ua, 'Tailscale')

    assert.ok(session)
    assert.equal(session.ip, bypassIp)
    assert.equal(session.deviceName, '📱 iPhone (Safari)')
    assert.equal(session.authType, '⚡ Tailscale 免密直连')
    assert.equal(session.isBypass, true)

    const list = store.getSessionsList()
    const dev = list.devices.find(d => d.ip === bypassIp)
    assert.ok(dev)
    assert.equal(dev.isBypass, true)
    assert.equal(dev.authType, '⚡ Tailscale 免密直连')

    const stats = store.getIpSecurityStats()
    const ipStat = stats.find(s => s.ip === bypassIp)
    assert.ok(ipStat)
    assert.equal(ipStat.authType, '⚡ Tailscale 免密直连')
  })

  await t.test('关闭免密直连后自动清理临时免密设备并重置审计为待认证', () => {
    const testFile = `/tmp/dsh-bypass-close-test-${Date.now()}.json`
    const store = new SessionStore({ devicesFile: testFile, allowTailscale: true })

    const bypassIp = '100.64.0.77'
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    store.registerBypassDevice(bypassIp, ua, 'Tailscale')

    // 1. 验证设备存在且归因为免密直连
    assert.equal(store.getSessionsList().count, 1)
    let ipStat = store.getIpSecurityStats().find(s => s.ip === bypassIp)
    assert.equal(ipStat.authType, '⚡ Tailscale 免密直连')

    // 2. 管理员关闭 Tailscale 免密直连
    store.updateOptions({ allowTailscale: false })

    // 3. 验证免密设备已被自动清理
    assert.equal(store.getSessionsList().count, 0)

    // 4. 验证 IP 安全审计状态已自动重置为 ⚪ 待认证
    ipStat = store.getIpSecurityStats().find(s => s.ip === bypassIp)
    assert.equal(ipStat.authType, '⚪ 待认证')

    // 5. 模拟手机退回 /auth 登录页访问
    store.recordAuthVisit(bypassIp, ua)
    ipStat = store.getIpSecurityStats().find(s => s.ip === bypassIp)
    assert.equal(ipStat.authType, '⚪ 待认证')
    assert.equal(store.getSessionsList().count, 0)
  })

  await t.test('Settings 双向绑定与 Mutator 同步触发', () => {
    const store = new SessionStore({
      devicesFile: `/tmp/dsh-settings-mutator-${Date.now()}.json`,
      allowTailscale: false,
      allowLan: false,
    })
    let receivedPatch = null
    store.setSettingsMutator((patch) => {
      receivedPatch = patch
    })

    store.updateOptions({ allowTailscale: true, maxFailedAttempts: 8 })
    assert.deepEqual(receivedPatch, { allowTailscale: true, maxFailedAttempts: 8 })
    assert.equal(store.getOptions().allowTailscale, true)
    assert.equal(store.getOptions().maxFailedAttempts, 8)
  })

  await t.test('Session Token 365 天服务端过期自动清理', () => {
    const expireStore = new SessionStore({
      devicesFile: `/tmp/dsh-expire-test-${Date.now()}.json`,
      secret: 'pass2026',
    })
    const ok = expireStore.verify('pass2026', 'iPhone', '100.81.241.10')
    assert.equal(ok.success, true)
    const token = ok.token

    // 正常时间验证通过
    assert.equal(expireStore.validateToken(token), true)

    // 人工篡改 session.createdAt 为 366 天前 (超过 365 天)
    const session = expireStore.sessions.get(token)
    session.createdAt = Date.now() - (366 * 24 * 60 * 60 * 1000)

    // 验证 validateToken 判定失效并主动从 sessions 中清理
    assert.equal(expireStore.validateToken(token), false)
    assert.equal(expireStore.sessions.has(token), false)
  })

  await t.test('单 IP 每分钟高频打开 /auth 页面限频拦截 (maxVisitsPerMinute)', () => {
    const visitStore = new SessionStore({
      devicesFile: `/tmp/dsh-visit-test-${Date.now()}.json`,
      maxVisitsPerMinute: 10, // 设置为 10 次以便于测试
    })

    const testIp = '10.10.1.66'
    // 前 10 次访问正常放行
    for (let i = 1; i <= 10; i++) {
      const res = visitStore.recordAuthVisit(testIp)
      assert.equal(res.allowed, true)
    }

    // 第 11 次访问被 429 限频拦截
    const blocked = visitStore.recordAuthVisit(testIp)
    assert.equal(blocked.allowed, false)
    assert.match(blocked.reason, /过于频繁/)
  })

  await t.test('settings.yaml 命名空间安全写回与持久化 (writeBackToSettingsYaml)', async () => {
    const { writeFileSync, readFileSync, rmSync } = await import('node:fs')
    const { writeBackToSettingsYaml } = await import('../lib/auth/token.js')
    const tempYaml = `/tmp/dsh-temp-settings-${Date.now()}.yaml`

    // 初始化一个模拟 settings.yaml 文件
    const initialContent = [
      'ui-onboarding:',
      '  welcomeNoticeVersion: 2026-08-13.1',
      'pet:',
      '  visible: true',
      'locale:',
      '  preference: zh',
    ].join('\n')
    writeFileSync(tempYaml, initialContent, 'utf8')

    // 1. 首次追加 dsh-remote-mobile 命名空间
    const ok1 = writeBackToSettingsYaml({
      allowTailscale: true,
      allowLan: false,
      secretHash: 'scrypt:salt123:hash456',
      maxFailedAttempts: 8,
      lockDurationMs: 1200000,
      maxVisitsPerMinute: 80,
    }, tempYaml)
    assert.equal(ok1, true)

    let content = readFileSync(tempYaml, 'utf8')
    assert.ok(content.includes('dsh-remote-mobile:'))
    assert.ok(content.includes('allowTailscale: true'))
    assert.ok(content.includes('maxFailedAttempts: 8'))
    assert.ok(content.includes('maxVisitsPerMinute: 80'))
    assert.ok(content.includes('locale:\n  preference: zh')) // 原其他顶级配置完好无损

    // 2. 覆盖更新已存在的 dsh-remote-mobile 配置
    const ok2 = writeBackToSettingsYaml({
      allowTailscale: false,
      allowLan: true,
      secretHash: '',
      maxFailedAttempts: 10,
      lockDurationMs: 600000,
      maxVisitsPerMinute: 100,
    }, tempYaml)
    assert.equal(ok2, true)

    content = readFileSync(tempYaml, 'utf8')
    assert.ok(content.includes('allowTailscale: false'))
    assert.ok(content.includes('allowLan: true'))
    // 3. 测试 readFromSettingsYaml 精准读取解析
    const { readFromSettingsYaml } = await import('../lib/auth/token.js')
    const parsed = readFromSettingsYaml(tempYaml)
    assert.equal(parsed.allowTailscale, false)
    assert.equal(parsed.allowLan, true)
    assert.equal(parsed.maxFailedAttempts, 10)
    assert.equal(parsed.maxVisitsPerMinute, 100)
    assert.equal(parsed.lockDurationMs, 600000)

    rmSync(tempYaml, { force: true })
  })
})


