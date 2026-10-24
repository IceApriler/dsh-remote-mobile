import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDirectLink, resolveAccessPort } from '../src/client/utils/access.js'

test('对外访问端口解析', async (t) => {
  await t.test('优先使用 proxy.activePort', () => {
    assert.equal(resolveAccessPort({ proxy: { activePort: 3081 } }), 3081)
    assert.equal(resolveAccessPort({ proxy: { activePort: '3082' } }), 3082)
  })

  await t.test('端口缺失或非法时返回 null，不使用页面端口兜底', () => {
    assert.equal(resolveAccessPort({}), null)
    assert.equal(resolveAccessPort({ proxy: null }), null)
    assert.equal(resolveAccessPort({ proxy: {} }), null)
    assert.equal(resolveAccessPort({ proxy: { activePort: 0 } }), null)
    assert.equal(resolveAccessPort({ proxy: { activePort: -1 } }), null)
    assert.equal(resolveAccessPort({ proxy: { activePort: 65536 } }), null)
    assert.equal(resolveAccessPort({ proxy: { activePort: 'not-a-port' } }), null)
  })
})

test('直达链接使用解析后的对外端口', () => {
  assert.equal(
    buildDirectLink('192.168.1.5', 3081, 'ABC123'),
    'http://192.168.1.5:3081/auth?token=ABC123',
  )
  assert.equal(
    buildDirectLink('100.64.0.1', 3082, ''),
    'http://100.64.0.1:3082/auth?token=',
  )
})
