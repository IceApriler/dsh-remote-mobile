import test from 'node:test'
import assert from 'node:assert/strict'
import { isTailscaleIp, isLanIp, getClientIp, getLocalLanIp } from '../lib/auth/tailscale.js'

test('Tailscale IP 与网络判定测试', async (t) => {
  await t.test('Tailscale CGNAT 网段 (100.64.0.0/10) 判定', () => {
    assert.equal(isTailscaleIp('100.81.241.49'), true)
    assert.equal(isTailscaleIp('100.64.0.1'), true)
    assert.equal(isTailscaleIp('100.127.255.254'), true)

    // 非 Tailscale IP
    assert.equal(isTailscaleIp('100.63.255.255'), false)
    assert.equal(isTailscaleIp('100.128.0.1'), false)
    assert.equal(isTailscaleIp('192.168.1.100'), false)
    assert.equal(isTailscaleIp('10.10.1.13'), false)
    assert.equal(isTailscaleIp('127.0.0.1'), false)
  })

  await t.test('局域网私有 IP (RFC 1918 规范: 10.x / 172.16-31.x / 192.168.x) 判定', () => {
    assert.equal(isLanIp('10.10.1.13'), true)
    assert.equal(isLanIp('10.0.0.1'), true)
    assert.equal(isLanIp('192.168.1.100'), true)
    assert.equal(isLanIp('172.16.0.5'), true)
    assert.equal(isLanIp('172.31.255.255'), true)

    // 非局域网 IP
    assert.equal(isLanIp('127.0.0.1'), false)
    assert.equal(isLanIp('100.81.241.49'), false)
    assert.equal(isLanIp('8.8.8.8'), false)
    assert.equal(isLanIp('172.32.0.1'), false)
  })

  await t.test('客户端真实 IP 提取（基于 Socket，忽略不可信伪造头并规范 IPv6-mapped）', () => {
    const mockReq1 = { socket: { remoteAddress: '100.81.241.50' }, headers: {} }
    assert.equal(getClientIp(mockReq1), '100.81.241.50')

    // 拒绝 X-Forwarded-For 伪造，始终取真实连接地址
    const mockReq2 = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '100.81.241.52, 127.0.0.1' },
    }
    assert.equal(getClientIp(mockReq2), '127.0.0.1')

    const mockReq3 = {
      socket: { remoteAddress: '::ffff:127.0.0.1' },
      headers: {},
    }
    assert.equal(getClientIp(mockReq3), '127.0.0.1')
  })
})
