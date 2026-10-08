import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveForwardedPrefix, resolveRedirectPath } from '../lib/auth/prefix.js'

test('反向代理路径前缀解析与重定向路径安全构造测试 (prefix.ts)', async (t) => {
  await t.test('resolveForwardedPrefix 能够正确解析合规前缀并去除末尾斜杠', () => {
    assert.equal(resolveForwardedPrefix('/app/dsh'), '/app/dsh')
    assert.equal(resolveForwardedPrefix('/app/dsh/'), '/app/dsh')
    assert.equal(resolveForwardedPrefix('/my-gateway/nested/sub/'), '/my-gateway/nested/sub')
    assert.equal(resolveForwardedPrefix('  /app/dsh  '), '/app/dsh')
  })

  await t.test('resolveForwardedPrefix 边界与非字符串输入安全返回空字符串', () => {
    assert.equal(resolveForwardedPrefix(''), '')
    assert.equal(resolveForwardedPrefix('/'), '')
    assert.equal(resolveForwardedPrefix('///'), '')
    assert.equal(resolveForwardedPrefix(null), '')
    assert.equal(resolveForwardedPrefix(undefined), '')
    assert.equal(resolveForwardedPrefix(123), '')
  })

  await t.test('resolveForwardedPrefix 严格防御开放重定向与协议注入', () => {
    // 防御协议相对 URL (如 //evil.com)
    assert.equal(resolveForwardedPrefix('//evil.com'), '')
    assert.equal(resolveForwardedPrefix('///evil.com'), '')
    // 防御反斜杠与控制字符（WHATWG URL 规范化绕过防御）
    assert.equal(resolveForwardedPrefix('/\\evil.com'), '')
    assert.equal(resolveForwardedPrefix('/\t/evil.com'), '')
    assert.equal(resolveForwardedPrefix('/app\r\n/dsh'), '')
    assert.equal(resolveForwardedPrefix('/app\x00/dsh'), '')
    // 防御携带绝对协议
    assert.equal(resolveForwardedPrefix('http://evil.com'), '')
    assert.equal(resolveForwardedPrefix('https://evil.com/app'), '')
    assert.equal(resolveForwardedPrefix('javascript:alert(1)'), '')
    // 防御不以 / 开头的非相对路径
    assert.equal(resolveForwardedPrefix('app/dsh'), '')
  })

  await t.test('resolveRedirectPath 在存在合法前缀时正确拼接目标路径', () => {
    const headers = { 'x-forwarded-prefix': '/app/dsh' }
    assert.equal(resolveRedirectPath(headers, '/auth'), '/app/dsh/auth')
    assert.equal(resolveRedirectPath(headers, 'auth'), '/app/dsh/auth')
    assert.equal(resolveRedirectPath(headers, '/'), '/app/dsh/')
    assert.equal(resolveRedirectPath(headers, ''), '/app/dsh/')
  })

  await t.test('resolveRedirectPath 在无合法前缀或恶意前缀时退回安全根相对路径', () => {
    assert.equal(resolveRedirectPath({}, '/auth'), '/auth')
    assert.equal(resolveRedirectPath(undefined, '/'), '/')
    assert.equal(resolveRedirectPath({ 'x-forwarded-prefix': '//evil.com' }, '/auth'), '/auth')
    assert.equal(resolveRedirectPath({ 'x-forwarded-prefix': 'https://evil.com' }, '/'), '/')
  })

  await t.test('resolveRedirectPath 兼容数组格式的请求头', () => {
    const headers = { 'x-forwarded-prefix': ['/custom/gateway/'] }
    assert.equal(resolveRedirectPath(headers, '/auth'), '/custom/gateway/auth')
    assert.equal(resolveRedirectPath(headers, '/'), '/custom/gateway/')
  })
})
