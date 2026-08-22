# dsh-remote-mobile

English Documentation | [简体中文](./README.md)

`dsh-remote-mobile` is a remote and mobile security access plugin tailored for DeepSeek Hub (DSH).

By default, the DSH core service restricts Web UI access to localhost (`127.0.0.1`). This project safely enables Tailscale VPN and Local Area Network (LAN/Wi-Fi) remote connectivity using a custom authentication gate and context virtualization. It features QR code pairing, persistent passwords, brute-force rate-limiting, local data persistence, and realtime SSE push notifications.

---

## 🌟 Key Features

### 1. Network Connectivity
- **Tailscale Virtual Private Network**: Automatically detects Tailscale CGNAT IPs (`100.64.0.0/10`), generates a dedicated access QR code, and offers an end-to-end encrypted passwordless bypass option.
- **Local Area Network (LAN / Wi-Fi)**: Automatically detects RFC 1918 private IPs (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`), provides an independent LAN QR code, and includes high-risk visual safety warnings.
- **Quick QR Pairing**: Direct scanning with mobile camera or WeChat to open the authorization portal.

### 2. Multi-Tiered Authentication
- **Dynamic 6-Digit Code**: Generates temporary one-time pairing codes (valid for 5 minutes). Entering it on mobile grants a 365-day persistent session cookie.
- **Persistent Password (Secret)**: Set a custom password (letters + numbers, 6+ chars) to gain persistent authentication on any mobile device.
- **Passwordless Bypass Mode**: Selectively enable bypass for Tailscale or LAN. Turning off bypass automatically purges temporary credentials and resets device statuses.
- **Device Management**: View connected device types, OS, browsers, IP addresses, and last seen timestamps. Supports individual device revocation and one-click global purge.

### 3. Enterprise-Grade Security
- **Transport Layer Encryption**: Login verification supports RSA encryption (RSA-OAEP-SHA256 & PKCS#1 v1.5 compatible). Passwords and codes are encrypted on the browser before network transit.
- **Slow Salted Hashing**: Stores passwords locally using `scrypt` slow hashing (`scrypt:${salt}:${hash}`). Employs `crypto.timingSafeEqual` for constant-time comparisons against timing attacks.
- **Brute-Force & Rate-Limiting Defense**:
  - Automatically locks out an IP for 15 minutes after 5 consecutive failed attempts (returns HTTP 429);
  - Sliding-window rate limiter (default: 60 requests/min) to prevent high-frequency abuse;
  - Audit logs and lockout states persist across DSH restarts;
  - Manual one-click IP unlock support from the management UI.
- **Socket-Level Verification**: Only inspects low-level socket remote addresses, defending against forged `X-Forwarded-For` headers.

### 4. Realtime Push & Full Internationalization (i18n)
- **Server-Sent Events (SSE)**: Delivers instant push notifications for new device pairing, reconnections, revocations, and security alerts without client polling.
- **Bilingual Adaptive UI**: Dynamically switches between English and Simplified Chinese based on DSH preferences and browser settings.
- **Non-HTTPS Crypto Polyfill**: Injects a lightweight `crypto.randomUUID` Polyfill into HTML headers to support mobile browsers running in HTTP non-secure contexts.

---

## 🛠️ Installation & Setup

### Step 1: Install the Plugin

#### Option 1: One-Click via DSH CLI (Recommended)

Use the DSH built-in plugin manager to install from npm directly into the web profile:

```bash
dsh plugin --profile web add dsh-remote-mobile
```

#### Option 2: Visual Install via Web Settings (Plugin Manager)

Open the DSH Web UI in your browser:
1. Navigate to **Settings ⚙️ -> Plugins**;
2. Switch to the **"Plugin Manager"** (插件管理) tab at the top;
3. Enter the npm package name **`dsh-remote-mobile`** in the input field and click **"Install"** (安装);
4. Restart DSH to activate the plugin.

#### Option 3: Manual Installation via Package Manager in Profile Directory

```bash
# 1. Enter the DSH Web Profile directory
cd ~/.dsh/profiles/web

# 2. Install via pnpm
pnpm add dsh-remote-mobile

# 3. Check ~/.dsh/profiles/web/package.json
# Ensure "dsh-remote-mobile" is present in dsh.profile.bundles
```

#### Option 4: Local Development & Source Installation

```bash
# 1. Clone or download the repository locally
cd ~/Myfile/www-self/dsh-remote-mobile

# 2. Install dependencies, build and pack
npm install
npm run build && npm test && npm pack

# 3. Install the packed tarball into DSH
cd ~/.dsh/profiles/web
pnpm add /path/to/dsh-remote-mobile/dsh-remote-mobile-1.0.0.tgz
```

---

### Step 2: Configure Network Binding (Required)

Since DSH defaults to listening only on `127.0.0.1` (localhost), you need to bind the webserver to `0.0.0.0` in `~/.dsh/profiles/web/cordis.patch.yml` to accept connections from Tailscale or LAN:

```yaml
# 1. Override webserver to listen on 0.0.0.0:3080 (Required for remote access)
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: '0.0.0.0'
    port: 3080

# 2. Disable the built-in remote plugin from @linxin666/dsh-web-ui-all (Required: prevent route conflicts and UI overlaps)
- id: web-ui-remote-web-ui
  disabled: true
```

> **💡 Note**: The plugin is automatically registered by the DSH Bundle loader. You **do not** need to add `id: remote-mobile` to `cordis.patch.yml`.

---

### Step 3: Start DSH

```bash
dsh web
```

Open `http://127.0.0.1:3080` in your PC browser and navigate to **Settings ⚙️ -> Remote & Mobile** to configure pairing.

---

## ⚙️ Configuration

Options can be customized in `~/.dsh/settings.yaml` (or interactively configured via **Settings ⚙️ -> Remote & Mobile**):

```yaml
dsh-remote-mobile:
  # Bypass options
  allowTailscale: true        # boolean, default: false - Allow passwordless Tailscale access
  allowLan: false             # boolean, default: false - Allow passwordless LAN (Wi-Fi) access

  # Persistent password hash (auto-generated when saved in the UI)
  secretHash: ''              # string, default: empty

  # Advanced security policies
  maxVisitsPerMinute: 60      # number, default: 60 - Max visits to /auth per minute per IP
  maxFailedAttempts: 5        # number, default: 5 - Lockout threshold for wrong passwords
  lockDurationMs: 900000      # number, default: 900000 (15 min) - Lockout duration in ms
```

| Option | Type | Default | Description |
|---|---|---|---|
| `allowTailscale` | `boolean` | `false` | Enable passwordless access for Tailscale nodes |
| `allowLan` | `boolean` | `false` | Enable passwordless access for local Wi-Fi devices (High Risk) |
| `secretHash` | `string` | `""` | Salted scrypt hash for persistent password |
| `maxVisitsPerMinute` | `number` | `60` | Max /auth page visits per minute per IP |
| `maxFailedAttempts` | `number` | `5` | Maximum failed attempts before IP lockout |
| `lockDurationMs` | `number` | `900000` | IP lockout duration (ms) |

---

## 📂 Local Storage Paths

- **Device Sessions & Security Audit**: `~/.dsh/remote-mobile/devices.json`
- **RSA Transport Keypair**: `~/.dsh/remote-mobile/rsa-keys.json` (auto-generated on first launch with `0600` permissions)

---

## 🔒 Security Best Practices

1. **LAN Bypass Risk**: **NEVER enable `allowLan`** on public Wi-Fi, cafes, hotels, or untrusted shared networks.
2. **Tailscale Recommended**: Prioritize Tailscale for encrypted private access without exposing ports to the public internet.
3. **Password Strength**: When setting a persistent password, choose a strong alphanumeric combination (6+ characters).

---

## 🗑️ Uninstalling

```bash
dsh plugin --profile web remove dsh-remote-mobile
```

---

## 📄 License

[MIT License](./LICENSE)
