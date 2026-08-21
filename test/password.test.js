import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSecretStrength, hashSecret, verifySecretHash } from '../lib/auth/crypto.js'

test('密码复杂度校验规则', async (t) => {
  await t.test('允许留空（表示不设置长期密码）', () => {
    assert.deepEqual(validateSecretStrength(''), { valid: true })
    assert.deepEqual(validateSecretStrength('   '), { valid: true })
  })

  await t.test('拒绝少于 6 位的密码', () => {
    const res1 = validateSecretStrength('12345')
    assert.equal(res1.valid, false)
    assert.match(res1.reason, /不能少于 6 位/)

    const res2 = validateSecretStrength('ab1')
    assert.equal(res2.valid, false)
    assert.match(res2.reason, /不能少于 6 位/)
  })

  await t.test('拒绝纯数字或纯字母的弱密码', () => {
    const res1 = validateSecretStrength('12345678')
    assert.equal(res1.valid, false)
    assert.match(res1.reason, /字母和数字组合/)

    const res2 = validateSecretStrength('abcdefgh')
    assert.equal(res2.valid, false)
    assert.match(res2.reason, /字母和数字组合/)
  })

  await t.test('接受合规的 6 位以上字母与数字组合密码（含特殊字符）', () => {
    assert.deepEqual(validateSecretStrength('dsh19933'), { valid: true })
    assert.deepEqual(validateSecretStrength('dsh2026'), { valid: true })
    assert.deepEqual(validateSecretStrength('pass12'), { valid: true })
    assert.deepEqual(validateSecretStrength('  admin8888  '), { valid: true })
    assert.deepEqual(validateSecretStrength('Pass@2026!'), { valid: true })
    assert.deepEqual(validateSecretStrength('dsh#9999_xyz'), { valid: true })
  })

  await t.test('加盐哈希落盘与安全比对 (scrypt)', () => {
    const plain = 'dsh19933'
    const hashed = hashSecret(plain)
    assert.ok(hashed.startsWith('scrypt:'))
    assert.notEqual(hashed, plain) // 绝不存储明文
    assert.equal(verifySecretHash(plain, hashed), true)
    assert.equal(verifySecretHash('wrongPass123', hashed), false)
  })

  await t.test('兼容比对老版本 sha256 加盐哈希格式', () => {
    import('node:crypto').then(({ createHash }) => {
      const plain = 'legacyPass2026'
      const salt = 'a1b2c3d4e5f60718'
      const expectedHash = createHash('sha256').update(plain + ':' + salt).digest('hex')
      const legacyHashed = `sha256:${salt}:${expectedHash}`

      // 验证老版本 sha256 格式能正确识别并比对成功
      assert.equal(verifySecretHash(plain, legacyHashed), true)
      assert.equal(verifySecretHash('wrongPass', legacyHashed), false)
    })
  })

  await t.test('畸形或不合规哈希字符串比对安全防御（拒绝降级）', () => {
    assert.equal(verifySecretHash('anypass', ''), false)
    assert.equal(verifySecretHash('', 'scrypt:salt:hash'), false)
    assert.equal(verifySecretHash('plainText', 'plainText'), false)
    assert.equal(verifySecretHash('test', 'md5:123456:abcdef'), false)
    assert.equal(verifySecretHash('test', 'scrypt:incomplete'), false)
    assert.equal(verifySecretHash('test', 'sha256:incomplete'), false)
  })
})
