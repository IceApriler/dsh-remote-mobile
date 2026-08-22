import { generateKeyPairSync, privateDecrypt, constants, randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'

export const RSA_KEY_FILE = `${homedir()}/.dsh/remote-mobile/rsa-keys.json`

interface KeyPair {
  publicKey: string
  privateKey: string
}

let keyPair: KeyPair | null = null

function loadOrCreateKeyPair(): KeyPair | null {
  try {
    if (existsSync(RSA_KEY_FILE)) {
      const content = readFileSync(RSA_KEY_FILE, 'utf8')
      const data = JSON.parse(content)
      if (data && data.publicKey && data.privateKey) {
        return data
      }
    }
  } catch {}

  try {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    })

    try {
      mkdirSync(dirname(RSA_KEY_FILE), { recursive: true })
      writeFileSync(RSA_KEY_FILE, JSON.stringify(pair, null, 2), { encoding: 'utf8', mode: 0o600 })
    } catch {}

    return pair
  } catch {
    return null
  }
}

function getKeyPair(): KeyPair | null {
  if (keyPair) return keyPair
  keyPair = loadOrCreateKeyPair()
  return keyPair
}

/**
 * 获取服务端的持久化 RSA 公钥 (PEM 格式)
 */
export function getPublicKeyPem(): string {
  const pair = getKeyPair()
  return pair ? pair.publicKey : ''
}

/**
 * 使用 RSA 私钥解密客户端发来的 Base64 密文 (多填充算法自适应兼容)
 */
export function decryptWithPrivateKey(encryptedBase64: string): string {
  if (!encryptedBase64) return ''
  const pair = getKeyPair()
  if (!pair || !pair.privateKey) return ''

  try {
    const buffer = Buffer.from(encryptedBase64, 'base64')
    // 2048 位 RSA 密文标准长度必须为 256 字节
    if (buffer.length !== 256) return ''

    // 1. 优先尝试 RSA-OAEP SHA-256 (Web Crypto 规范标准)
    try {
      const decrypted = privateDecrypt(
        {
          key: pair.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        buffer
      )
      return decrypted.toString('utf8')
    } catch {}

    // 2. 尝试 RSA-OAEP SHA-1 兼容模式
    try {
      const decrypted = privateDecrypt(
        {
          key: pair.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha1',
        },
        buffer
      )
      return decrypted.toString('utf8')
    } catch {}

    // 3. 尝试 PKCS#1 v1.5 填充兼容模式
    try {
      const decrypted = privateDecrypt(
        {
          key: pair.privateKey,
          padding: constants.RSA_PKCS1_PADDING,
        },
        buffer
      )
      return decrypted.toString('utf8')
    } catch {}
  } catch {}

  return ''
}

/**
 * 校验长期密码强度：必须 >= 6 位且包含字母与数字
 */
export function validateSecretStrength(secret: string): { valid: boolean; reason?: string } {
  const trimmed = (secret || '').trim()
  if (!trimmed) return { valid: true } // 允许留空（不设置长期密码）
  if (trimmed.length < 6) {
    return { valid: false, reason: '密码长度不能少于 6 位' }
  }
  const hasLetter = /[A-Za-z]/.test(trimmed)
  const hasDigit = /\d/.test(trimmed)
  if (!hasLetter || !hasDigit) {
    return { valid: false, reason: '密码必须同时包含字母和数字组合' }
  }
  return { valid: true }
}

/**
 * 将明文密码转换为加盐哈希（采用 scrypt 慢哈希算法，杜绝彩虹表与 GPU 暴力破解）
 */
export function hashSecret(plainSecret: string): string {
  if (!plainSecret) return ''
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(plainSecret, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

/**
 * 比对明文密码与存储的加盐哈希（恒定时间比对，抵御时序侧信道攻击）
 */
export function verifySecretHash(plainSecret: string, storedHashOrPlain: string): boolean {
  if (!storedHashOrPlain || !plainSecret) return false

  if (storedHashOrPlain.startsWith('scrypt:')) {
    const parts = storedHashOrPlain.split(':')
    if (parts.length !== 3) return false
    const salt = parts[1]
    const expectedHash = parts[2]
    const actualHash = scryptSync(plainSecret, salt, 64).toString('hex')
    if (actualHash.length !== expectedHash.length) return false
    return timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'))
  }

  // 兼容老版本 sha256 存储
  if (storedHashOrPlain.startsWith('sha256:')) {
    const parts = storedHashOrPlain.split(':')
    if (parts.length !== 3) return false
    const salt = parts[1]
    const expectedHash = parts[2]
    const actualHash = createHash('sha256').update(plainSecret + ':' + salt).digest('hex')
    if (actualHash.length !== expectedHash.length) return false
    return timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'))
  }

  return false
}
