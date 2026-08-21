import test from 'node:test'
import assert from 'node:assert/strict'
import { publicEncrypt, constants } from 'node:crypto'
import { getPublicKeyPem, decryptWithPrivateKey } from '../lib/auth/crypto.js'

test('RSA 密钥与加解密测试', async (t) => {
  const pubPem = getPublicKeyPem()

  await t.test('公钥格式符合 PKCS#8 SPKI 标准', () => {
    assert.ok(pubPem.startsWith('-----BEGIN PUBLIC KEY-----'))
    assert.ok(pubPem.includes('-----END PUBLIC KEY-----'))
  })

  await t.test('RSA-OAEP-SHA256 加密与解密互通（Web Crypto 规范）', () => {
    const plain = '684920'
    const enc = publicEncrypt(
      {
        key: pubPem,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(plain)
    )
    const b64 = enc.toString('base64')
    const decrypted = decryptWithPrivateKey(b64)
    assert.equal(decrypted, plain)
  })

  await t.test('RSA-OAEP-SHA1 填充兼容解密', () => {
    const plain = 'dsh-admin-2026'
    const enc = publicEncrypt(
      {
        key: pubPem,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha1',
      },
      Buffer.from(plain)
    )
    const decrypted = decryptWithPrivateKey(enc.toString('base64'))
    assert.equal(decrypted, plain)
  })

  await t.test('PKCS#1 v1.5 填充兼容解密', () => {
    const plain = 'legacy-pass-123'
    const enc = publicEncrypt(
      {
        key: pubPem,
        padding: constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(plain)
    )
    const decrypted = decryptWithPrivateKey(enc.toString('base64'))
    assert.equal(decrypted, plain)
  })

  await t.test('畸形密文或空密文安全返回空字符串，不崩溃', () => {
    assert.equal(decryptWithPrivateKey(''), '')
    assert.equal(decryptWithPrivateKey('not-a-valid-base64!!!'), '')
    assert.equal(decryptWithPrivateKey('dGVzdA=='), '')
  })
})
