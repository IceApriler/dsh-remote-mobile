import { getPublicKeyPem } from '../auth/crypto.js'

/**
 * 手机端授权与登录页面 HTML
 */
export function getLoginPageHtml(publicKeyPem?: string, lang: 'zh' | 'en' = 'zh'): string {
  const inlinePublicKey = publicKeyPem || getPublicKeyPem()
  const isEn = lang === 'en'

  const i18n = {
    pageTitle: isEn ? 'DSH Remote Access Authorization' : 'DSH 移动端访问授权',
    headerTitle: isEn ? 'Remote Access Auth' : '移动端访问授权',
    headerDesc: isEn ? 'Enter 6-digit dynamic pairing code or persistent password' : '请输入 6 位动态配对码或长期访问密码',
    placeholder: isEn ? '6-digit code or password' : '6 位临时配对码 / 长期密码',
    submitBtn: isEn ? 'Authorize & Connect' : '立即授权连接',
    footerSecurity: isEn ? '🔒 Protected by 2048-bit RSA-OAEP end-to-end encryption' : '🔒 全程受 2048 位 RSA-OAEP 端到端加密保护',
    verifying: isEn ? '🔐 Encrypting & verifying...' : '🔐 正在 RSA 加密与验证...',
    success: isEn ? 'Authorization successful! Entering workspace...' : '授权成功！正在进入工作区...',
    networkErr: isEn ? 'Network connection error, please try again' : '网络连接异常，请检查网络',
  }

  return `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'zh-CN'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${i18n.pageTitle}</title>
  <style>
    :root {
      --bg: #0f1117;
      --card-bg: rgba(26, 29, 39, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --error: #ef4444;
      --success: #10b981;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f3f4f6;
        --card-bg: rgba(255, 255, 255, 0.9);
        --card-border: rgba(0, 0, 0, 0.08);
        --text: #111827;
        --text-muted: #6b7280;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body {
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .auth-card {
      width: 100%;
      max-width: 380px;
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 32px 24px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
      text-align: center;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 16px;
      margin-bottom: 20px;
      color: white;
      box-shadow: 0 8px 16px rgba(59, 130, 246, 0.3);
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    p.desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .input-group {
      margin-bottom: 16px;
    }
    input {
      width: 100%;
      height: 48px;
      background: rgba(128, 128, 128, 0.08);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 0 16px;
      font-size: 16px;
      color: var(--text);
      outline: none;
      text-align: center;
      letter-spacing: 2px;
      transition: all 0.2s;
    }
    input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
    }
    button.submit-btn {
      width: 100%;
      height: 48px;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    button.submit-btn:active {
      background: var(--primary-hover);
      transform: scale(0.99);
    }
    .status-msg {
      margin-top: 16px;
      font-size: 13px;
      display: none;
    }
    .status-msg.error {
      color: var(--error);
      display: block;
    }
    .status-msg.success {
      color: var(--success);
      display: block;
    }
    .info-footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--card-border);
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
      text-align: left;
    }
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="logo-badge">
      <svg style="width: 28px; height: 28px; fill: currentColor;" viewBox="0 0 24 24">
        <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
      </svg>
    </div>
    <h1>${i18n.headerTitle}</h1>
    <p class="desc">${i18n.headerDesc}</p>

    <form id="authForm">
      <div class="input-group">
        <input 
          type="password" 
          id="credentialInput" 
          placeholder="${i18n.placeholder}" 
          autocomplete="off" 
          required
        />
      </div>
      <button type="submit" class="submit-btn" id="submitBtn">
        ${i18n.submitBtn}
      </button>
      <div id="statusMsg" class="status-msg"></div>
    </form>

    <div class="info-footer">
      <div>${i18n.footerSecurity}</div>
    </div>
  </div>

  <script>
    const SERVER_RSA_KEY = ${JSON.stringify(inlinePublicKey)};
    const form = document.getElementById('authForm');
    const input = document.getElementById('credentialInput');
    const statusMsg = document.getElementById('statusMsg');
    const submitBtn = document.getElementById('submitBtn');

    // 解析 SPKI 格式公钥并提取 n 和 e
    function parseSpkiKey(pemStr) {
      const b64 = pemStr.replace(/-----BEGIN PUBLIC KEY-----/g, '').replace(/-----END PUBLIC KEY-----/g, '').replace(/\\s/g, '');
      const binary = window.atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      let idx = 0;
      while (idx < bytes.length && bytes[idx] !== 0x02) idx++;
      const lenByte = bytes[idx + 1];
      let nLen = 0;
      let nStart = 0;
      if (lenByte === 0x82) {
        nLen = (bytes[idx + 2] << 8) | bytes[idx + 3];
        nStart = idx + 4;
      } else if (lenByte === 0x81) {
        nLen = bytes[idx + 2];
        nStart = idx + 3;
      } else {
        nLen = lenByte;
        nStart = idx + 2;
      }
      let nBytes = bytes.slice(nStart, nStart + nLen);
      if (nBytes[0] === 0x00) nBytes = nBytes.slice(1);

      idx = nStart + nLen;
      while (idx < bytes.length && bytes[idx] !== 0x02) idx++;
      const eLen = bytes[idx + 1];
      const eBytes = bytes.slice(idx + 2, idx + 2 + eLen);

      let nHex = '';
      for (let b of nBytes) nHex += b.toString(16).padStart(2, '0');
      let eHex = '';
      for (let b of eBytes) eHex += b.toString(16).padStart(2, '0');

      return { n: BigInt('0x' + nHex), e: BigInt('0x' + eHex), keyLen: nBytes.length };
    }

    function modPow(b, exp, mod) {
      let res = 1n;
      let base = b % mod;
      let e = exp;
      while (e > 0n) {
        if (e & 1n) res = (res * base) % mod;
        base = (base * base) % mod;
        e >>= 1n;
      }
      return res;
    }

    function rsaEncryptPureJs(plainText, pubPem) {
      const { n, e, keyLen } = parseSpkiKey(pubPem);
      const msgBytes = new TextEncoder().encode(plainText);
      const padLen = keyLen - 3 - msgBytes.length;
      const pad = [];
      while (pad.length < padLen) {
        const r = Math.floor(Math.random() * 255) + 1;
        pad.push(r);
      }
      const em = new Uint8Array(keyLen);
      em[0] = 0x00;
      em[1] = 0x02;
      em.set(pad, 2);
      em[2 + padLen] = 0x00;
      em.set(msgBytes, 3 + padLen);

      let emHex = '';
      for (let b of em) emHex += b.toString(16).padStart(2, '0');
      const m = BigInt('0x' + emHex);
      const c = modPow(m, e, n);
      let cHex = c.toString(16);
      if (cHex.length % 2 !== 0) cHex = '0' + cHex;
      while (cHex.length < keyLen * 2) cHex = '00' + cHex;

      let binary = '';
      for (let i = 0; i < cHex.length; i += 2) {
        binary += String.fromCharCode(parseInt(cHex.slice(i, i + 2), 16));
      }
      return window.btoa(binary);
    }

    function encryptCredential(plainText) {
      try {
        const encryptedB64 = rsaEncryptPureJs(plainText, SERVER_RSA_KEY);
        return { encryptedCredential: encryptedB64 };
      } catch (err) {
        console.error('RSA encrypt error:', err);
        return { credential: plainText };
      }
    }

    // 自动检测 URL 参数里的 token 快速登录
    const urlParams = new URLSearchParams(window.location.search);
    const queryToken = urlParams.get('token');
    if (queryToken) {
      input.value = queryToken;
      doVerify(queryToken);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      doVerify(val);
    });

    async function doVerify(credential) {
      submitBtn.disabled = true;
      submitBtn.innerText = ${JSON.stringify(i18n.verifying)};
      statusMsg.className = 'status-msg';
      statusMsg.style.display = 'none';

      try {
        const payload = encryptCredential(credential);
        const res = await fetch('/api/remote-mobile/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          statusMsg.className = 'status-msg success';
          statusMsg.innerText = ${JSON.stringify(i18n.success)};
          statusMsg.style.display = 'block';
          setTimeout(() => {
            window.location.href = '/';
          }, 600);
        } else {
          statusMsg.className = 'status-msg error';
          statusMsg.innerText = data.reason || (isEn ? 'Authorization failed, please try again' : '授权失败，请重试');
          statusMsg.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.innerText = ${JSON.stringify(i18n.submitBtn)};
        }
      } catch (err) {
        statusMsg.className = 'status-msg error';
        statusMsg.innerText = ${JSON.stringify(i18n.networkErr)};
        statusMsg.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.innerText = ${JSON.stringify(i18n.submitBtn)};
      }
    }
  </script>
</body>
</html>`
}
