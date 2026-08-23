import type { IncomingMessage, ServerResponse } from 'node:http'
import { AUTH_COOKIE_NAME, readGlobalLocale, type SessionStore } from '../auth/token.js'
import { getLocalTailscaleIp, getLocalLanIp, getAllNetworkIps, getClientIp, isTailscaleIp, isLanIp } from '../auth/tailscale.js'
import { getPublicKeyPem, decryptWithPrivateKey, validateSecretStrength, RSA_KEY_FILE } from '../auth/crypto.js'
import { getLoginPageHtml } from './login-page.js'
import type { StyleSnippetStore } from '../styles/style-snippets.js'

function jsonResponse(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  })
  res.end(JSON.stringify(data))
}

function getRealClientIp(req: IncomingMessage): string {
  const real = req.headers['x-dsh-real-ip']
  if (typeof real === 'string' && real) return real
  return getClientIp(req)
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: any) => {
      body += chunk
      if (body.length > 1e5) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

export function createRoutes(store: SessionStore, styleStore?: StyleSnippetStore) {
  return [
    // 0. RSA 公钥获取接口 (RSA-OAEP-SHA256)
    {
      method: 'GET',
      path: '/api/remote-mobile/public-key',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        jsonResponse(res, 200, {
          success: true,
          publicKey: getPublicKeyPem(),
          algorithm: 'RSA-OAEP-SHA256',
        })
      },
    },

    // 1. 状态查询接口 (返回 Tailscale IP、局域网 LAN IP 与 IP 防暴破安全统计)
    {
      method: 'GET',
      path: '/api/remote-mobile/status',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const opts = store.getOptions()
        const tsIp = getLocalTailscaleIp()
        const lanIp = getLocalLanIp()
        const ips = getAllNetworkIps()
        const sessionStats = store.getSessionsList()
        const ipSecurityStats = store.getIpSecurityStats()

        jsonResponse(res, 200, {
          success: true,
          locale: readGlobalLocale(),
          tailscaleIp: tsIp,
          lanIp,
          networkIps: ips,
          allowTailscale: opts.allowTailscale,
          allowLan: opts.allowLan,
          hasSecret: Boolean(opts.secretHash || opts.secret),
          maxVisitsPerMinute: opts.maxVisitsPerMinute,
          maxFailedAttempts: opts.maxFailedAttempts,
          lockDurationMs: opts.lockDurationMs,
          devicesCount: sessionStats.count,
          devices: sessionStats.devices,
          ipSecurityStats,
          persistPath: store.persistPath,
          rsaKeyPath: RSA_KEY_FILE,
          publicKey: getPublicKeyPem(),
        })
      },
    },

    // 2. 生成 6 位短期配对码
    {
      method: 'POST',
      path: '/api/remote-mobile/generate-code',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        const info = store.generateShortCode()
        jsonResponse(res, 200, {
          success: true,
          code: info.code,
          expiresAt: info.expiresAt,
        })
      },
    },

    // 3. 手机端验证与换取长效 Cookie (支持 RSA-OAEP 密文解密 + 防暴力破解 429 拦截)
    {
      method: 'POST',
      path: '/api/remote-mobile/verify',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const body = await parseJsonBody(req)
        let credential = ''

        if (body.encryptedCredential) {
          const decrypted = decryptWithPrivateKey(body.encryptedCredential)
          credential = (decrypted || body.credential || '').trim()
        } else if (body.credential) {
          credential = String(body.credential).trim()
        }

        const ua = req.headers['user-agent']
        const ip = getRealClientIp(req)

        const result = store.verify(credential, ua, ip)
        if (result.success && result.token) {
          const maxAge = 365 * 24 * 60 * 60
          const cookieVal = `${AUTH_COOKIE_NAME}=${result.token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`

          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Set-Cookie': cookieVal,
          })
          res.end(JSON.stringify({ success: true, token: result.token }))
        } else if (result.locked) {
          jsonResponse(res, 429, {
            success: false,
            locked: true,
            remainingSeconds: result.remainingSeconds,
            reason: result.reason || '连续尝试错误过多，IP已被安全锁定',
          })
        } else {
          jsonResponse(res, 401, { success: false, reason: result.reason || '验证失败' })
        }
      },
    },

    // 3.1 手动解除某个 IP 的防暴破锁定
    {
      method: 'POST',
      path: '/api/remote-mobile/unlock-ip',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const body = await parseJsonBody(req)
        const ip = (body.ip || '').trim()
        const ok = store.unlockIp(ip)
        jsonResponse(res, 200, { success: ok, ip })
      },
    },

    // 3.2 一键清空所有 IP 访问与安全审计日志
    {
      method: 'POST',
      path: '/api/remote-mobile/clear-ip-stats',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        store.clearAllIpSecurityStats()
        jsonResponse(res, 200, { success: true })
      },
    },

    // 4. 切换 Tailscale / 局域网免密直连开关
    {
      method: 'POST',
      path: '/api/remote-mobile/toggle-bypass',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const body = await parseJsonBody(req)
        const updates: Partial<{ allowTailscale: boolean; allowLan: boolean }> = {}

        if (typeof body.allowTailscale === 'boolean') {
          updates.allowTailscale = body.allowTailscale
        }
        if (typeof body.allowLan === 'boolean') {
          updates.allowLan = body.allowLan
        }
        if (typeof body.enabled === 'boolean') {
          updates.allowTailscale = body.enabled
        }

        store.updateOptions(updates)
        const opts = store.getOptions()
        jsonResponse(res, 200, {
          success: true,
          allowTailscale: opts.allowTailscale,
          allowLan: opts.allowLan,
        })
      },
    },
    {
      method: 'POST',
      path: '/api/remote-mobile/update-options',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const body = await parseJsonBody(req)
        const updates: Partial<{
          allowTailscale: boolean
          allowLan: boolean
          maxVisitsPerMinute: number
          maxFailedAttempts: number
          lockDurationMs: number
        }> = {}

        if (typeof body.allowTailscale === 'boolean') {
          updates.allowTailscale = body.allowTailscale
        }
        if (typeof body.allowLan === 'boolean') {
          updates.allowLan = body.allowLan
        }
        if (typeof body.enabled === 'boolean') {
          updates.allowTailscale = body.enabled
        }
        if (typeof body.maxVisitsPerMinute === 'number' && body.maxVisitsPerMinute > 0) {
          updates.maxVisitsPerMinute = Math.floor(body.maxVisitsPerMinute)
        }
        if (typeof body.maxFailedAttempts === 'number' && body.maxFailedAttempts > 0) {
          updates.maxFailedAttempts = Math.floor(body.maxFailedAttempts)
        }
        if (typeof body.lockDurationMs === 'number' && body.lockDurationMs > 0) {
          updates.lockDurationMs = Math.floor(body.lockDurationMs)
        }

        store.updateOptions(updates)
        const opts = store.getOptions()
        jsonResponse(res, 200, {
          success: true,
          allowTailscale: opts.allowTailscale,
          allowLan: opts.allowLan,
          maxVisitsPerMinute: opts.maxVisitsPerMinute,
          maxFailedAttempts: opts.maxFailedAttempts,
          lockDurationMs: opts.lockDurationMs,
        })
      },
    },

    // 5. 设置并持久化长期访问密码 (支持 RSA 密文 + 6位以上字母数字复杂度校验)
    {
      method: 'POST',
      path: '/api/remote-mobile/set-secret',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const body = await parseJsonBody(req)
        let secret = ''

        if (body.encryptedSecret) {
          secret = decryptWithPrivateKey(body.encryptedSecret).trim()
        } else if (typeof body.secret === 'string') {
          secret = body.secret.trim()
        }

        // 校验密码复杂度
        const check = validateSecretStrength(secret)
        if (!check.valid) {
          return jsonResponse(res, 400, {
            success: false,
            reason: check.reason || '密码不满足强度要求',
          })
        }

        store.updateOptions({ secret })
        jsonResponse(res, 200, { success: true, hasSecret: Boolean(secret) })
      },
    },

    // 5.1 清除长期访问密码
    {
      method: 'POST',
      path: '/api/remote-mobile/clear-secret',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        store.updateOptions({ secret: '', secretHash: '' })
        jsonResponse(res, 200, { success: true, hasSecret: false })
      },
    },

    // 6. 撤销单个设备授权
    {
      method: 'POST',
      path: '/api/remote-mobile/revoke-device',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const body = await parseJsonBody(req)
        const token = body.token || ''
        const ok = store.revokeDevice(token)
        jsonResponse(res, 200, { success: ok })
      },
    },

    // 7. 一键撤销所有设备
    {
      method: 'POST',
      path: '/api/remote-mobile/revoke-all',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        store.revokeAllSessions()
        jsonResponse(res, 200, { success: true })
      },
    },

    // 8. 独立手机登录引导页面（已授权或 Tailscale/局域网免密设备访问时自动 302 跳转回工作区，支持 IP 访问计数与限频）
    {
      method: 'GET',
      path: '/auth',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const clientIp = getRealClientIp(req)
        const opts = store.getOptions()
        const isTs = isTailscaleIp(clientIp)
        const isLan = isLanIp(clientIp)
        const token = store.extractTokenFromRequest(req)
        const ua = req.headers['user-agent'] || ''
        const hasValidToken = token ? store.validateToken(token, clientIp) : false

        // 如果开启了免密直连（Tailscale 或 局域网）或者已持有有效 Token，直接放行直跳根目录
        if ((opts.allowTailscale && isTs) || (opts.allowLan && isLan) || hasValidToken) {
          res.writeHead(302, { Location: '/' })
          return res.end()
        }

        // 记录 IP 访问计数并进行防高频刷量限频与设备型号解析
        const visitCheck = store.recordAuthVisit(clientIp, ua)
        if (!visitCheck.allowed) {
          res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' })
          return res.end(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>安全限制 - DSH</title>
            <style>body{background:#0f172a;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;text-align:center;}
            .card{background:rgba(255,255,255,0.06);border:1px solid rgba(239,68,68,0.4);border-radius:16px;padding:28px 20px;max-width:380px;box-shadow:0 8px 32px rgba(0,0,0,0.4);}
            h2{color:#ef4444;margin:0 0 10px 0;font-size:20px;}p{color:#94a3b8;font-size:14px;line-height:1.6;margin:0;}</style>
            </head>
            <body><div class="card"><h2>⚠️ 访问限制 (429)</h2><p>${visitCheck.reason || '当前 IP 请求过于频繁或已被临时锁定，请稍后刷新重试。'}</p></div></body>
            </html>
          `)
        }

        const acceptLang = req.headers['accept-language'] || ''
        const reqLocale = acceptLang.toLowerCase().startsWith('en') ? 'en' : readGlobalLocale()
        const html = getLoginPageHtml(undefined, reqLocale)
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        })
        res.end(html)
      },
    },

    // 9. SSE 实时事件监听通道 (Server-Sent Events 0延时推送，彻底告别轮询)
    {
      method: 'GET',
      path: '/api/remote-mobile/events',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        res.write(': connected\n\n')

        const onConnected = (device: any) => {
          res.write(`data: ${JSON.stringify({ type: 'device-connected', device })}\n\n`)
        }
        const onOnline = (device: any) => {
          res.write(`data: ${JSON.stringify({ type: 'device-online', device })}\n\n`)
        }
        const onRevoked = (data: any) => {
          res.write(`data: ${JSON.stringify({ type: 'device-revoked', data })}\n\n`)
        }
        const onSecurityUpdated = (data: any) => {
          res.write(`data: ${JSON.stringify({ type: 'ip-security-updated', ...data })}\n\n`)
        }
        const onSecurityAlert = (data: any) => {
          res.write(`data: ${JSON.stringify({ type: 'ip-security-alert', ...data })}\n\n`)
        }

        store.on('device-connected', onConnected)
        store.on('device-online', onOnline)
        store.on('device-revoked', onRevoked)
        store.on('ip-security-updated', onSecurityUpdated)
        store.on('ip-security-alert', onSecurityAlert)

        // 心跳定时器 (每 25 秒维持连接)
        const keepAlive = setInterval(() => {
          res.write(': ping\n\n')
        }, 25000)
        if (typeof (keepAlive as any).unref === 'function') {
          ;(keepAlive as any).unref()
        }

        let cleaned = false
        const cleanup = () => {
          if (cleaned) return
          cleaned = true
          clearInterval(keepAlive)
          store.off('device-connected', onConnected)
          store.off('device-online', onOnline)
          store.off('device-revoked', onRevoked)
          store.off('ip-security-updated', onSecurityUpdated)
          store.off('ip-security-alert', onSecurityAlert)
        }

        req.on('close', cleanup)
        res.on('close', cleanup)
      },
    },

    // 10. 移动端样式片段（样式小插件）管理 API（合并 GET 与 POST 处理，避免 webserver.register 重复 path 冲突）
    {
      path: '/api/remote-mobile/styles',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!styleStore) {
          return jsonResponse(res, 404, { success: false, reason: 'style snippets module unavailable' })
        }

        // POST: 新增或修改自定义片段（pcEnabled/mobileEnabled 双端开关，缺省移动端开、PC 关）
        if (req.method === 'POST') {
          const body = await parseJsonBody(req)
          try {
            const snippet = styleStore.upsertCustom({
              id: typeof body.id === 'string' ? body.id : undefined,
              name: typeof body.name === 'string' ? body.name : '',
              description: typeof body.description === 'string' ? body.description : undefined,
              css: typeof body.css === 'string' ? body.css : '',
              pcEnabled: typeof body.pcEnabled === 'boolean' ? body.pcEnabled : false,
              mobileEnabled: typeof body.mobileEnabled === 'boolean' ? body.mobileEnabled : true,
            })
            return jsonResponse(res, 200, { success: true, snippet })
          } catch (e: any) {
            return jsonResponse(res, 400, {
              success: false,
              reason: e?.message || 'invalid style snippet payload',
            })
          }
        }

        // 默认 GET: 列出全部样式片段（内置预设名称按请求语言本地化）
        const accept = req.headers['accept-language'] || ''
        const lang = accept.toLowerCase().startsWith('en') ? 'en' : readGlobalLocale()
        jsonResponse(res, 200, {
          success: true,
          snippets: styleStore.list(lang),
          persistPath: styleStore.persistPath,
        })
      },
    },
    {
      method: 'POST',
      path: '/api/remote-mobile/styles/toggle',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!styleStore) {
          return jsonResponse(res, 404, { success: false, reason: 'style snippets module unavailable' })
        }
        const body = await parseJsonBody(req)
        const scope = body.scope === 'pc' ? 'pc' : 'mobile'
        const ok = styleStore.setEnabled(String(body.id || ''), scope, Boolean(body.enabled))
        jsonResponse(res, ok ? 200 : 400, { success: ok, reason: ok ? undefined : 'style snippet not found' })
      },
    },
    {
      method: 'POST',
      path: '/api/remote-mobile/styles/delete',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!styleStore) {
          return jsonResponse(res, 404, { success: false, reason: 'style snippets module unavailable' })
        }
        const body = await parseJsonBody(req)
        const ok = styleStore.removeCustom(String(body.id || ''))
        jsonResponse(res, ok ? 200 : 400, { success: ok, reason: ok ? undefined : 'custom snippet not found' })
      },
    },
    {
      method: 'POST',
      path: '/api/remote-mobile/styles/reset',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        if (!styleStore) {
          return jsonResponse(res, 404, { success: false, reason: 'style snippets module unavailable' })
        }
        styleStore.resetEnabled()
        jsonResponse(res, 200, { success: true, snippets: styleStore.list() })
      },
    },
  ]
}
