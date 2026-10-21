import test from 'node:test'
import assert from 'node:assert/strict'
import { publicEncrypt, privateDecrypt, generateKeyPairSync, constants } from 'node:crypto'
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

  await t.test('PKCS#1 v1.5 填充兼容解密', (t) => {
    // Node 20+/OpenSSL 3 出于 CVE-2023-46809（Marvin）安全原因，
    // 已默认禁止 RSA_PKCS1_PADDING 私钥解密。此时插件保留的 legacy fallback
    // 只能尽力而为，不应把运行时不支持当作回归；现代 WebCrypto 主路径使用 OAEP。
    let pkcs1PrivateDecryptSupported = true
    try {
      const pair = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })
      const probe = publicEncrypt(
        { key: pair.publicKey, padding: constants.RSA_PKCS1_PADDING },
        Buffer.from('probe')
      )
      privateDecrypt(
        { key: pair.privateKey, padding: constants.RSA_PKCS1_PADDING },
        probe
      )
    } catch (err) {
      if (String(err?.message || err).includes('RSA_PKCS1_PADDING')) {
        pkcs1PrivateDecryptSupported = false
      } else {
        throw err
      }
    }
    if (!pkcs1PrivateDecryptSupported) {
      t.skip('当前 Node/OpenSSL 已禁用 PKCS#1 v1.5 私钥解密（CVE-2023-46809）')
      return
    }

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
