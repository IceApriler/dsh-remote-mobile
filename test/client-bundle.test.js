import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const bundle = readFileSync(resolve(__dirname, '../lib/client.js'), 'utf8')

test('客户端 Bundle 实时刷新链路完整性测试', async (t) => {
  await t.test('useEffect 不得在 locale 订阅处提前 return，SSE 监听与轮询必须注册', () => {
    const localeEffect = bundle;
    // 1. 不得存在提前返回 unsub 的写法（早退会跳过 addEventListener / pollTimer）
    assert.ok(
      !/typeof unsub === 'function'\s*\)\s*return\s+unsub/.test(bundle),
      'bundle 中不应出现 return unsub 早退',
    )
    // 2. locale 卸载函数必须被收集进清理数组
    assert.match(bundle, /localeUnsubs\.push\(unsub\)/)
    // 3. 设备事件监听必须注册
    assert.match(localeEffect, /addEventListener\(['"]dsh-device-updated['"],\s*handleDeviceUpdate\)/)
    // 4. 3 秒轮询必须启动
    assert.ok(localeEffect.includes('setInterval'))
    assert.match(localeEffect, /refreshStatusOnly\(\)/)
    // 5. cleanup 中必须同时清理 localStorage 数组、监听器与轮询
    assert.ok(localeEffect.includes('clearInterval(pollTimer)'))
    assert.match(localeEffect, /removeEventListener\(['"]dsh-device-updated['"]/)
    assert.ok(localeEffect.includes('localeUnsubs.length'))
  })

  await t.test('SSE 长连接与事件派发链路完整', () => {
    assert.ok(bundle.includes('new EventSource("/api/remote-mobile/events")'))
    assert.ok(bundle.includes('window.__DSH_REMOTE_MOBILE_SSE_LISTENER__'))
    assert.ok(bundle.includes('dispatchEvent(new CustomEvent("dsh-device-updated"'))
    assert.ok(bundle.includes('device-connected'))
    assert.ok(bundle.includes('ip-security-updated'))
  })

  await t.test('状态乐观更新与设备列表渲染字段完整', () => {
    assert.ok(bundle.includes('devicesCount'))
    assert.ok(bundle.includes('ipSecurityStats'))
    assert.ok(bundle.includes('refreshStatusOnly'))
    assert.ok(bundle.includes('fetchStatus'))
  })
})