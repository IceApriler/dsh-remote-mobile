<div align="center">

# dsh-remote-mobile

**DeepSeek Hub (DSH) Mobile & Remote Access Security Guard Plugin**

[![npm version](https://img.shields.io/npm/v/dsh-remote-mobile.svg?style=flat-square&color=3b82f6)](https://www.npmjs.com/package/dsh-remote-mobile)
[![license](https://img.shields.io/npm/l/dsh-remote-mobile.svg?style=flat-square&color=10b981)](https://github.com/IceApriler/dsh-remote-mobile/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/dsh-remote-mobile.svg?style=flat-square&color=8b5cf6)](https://nodejs.org)
[![dsh-compatible](https://img.shields.io/badge/DSH-Compatible-orange?style=flat-square)](https://github.com/deepseek-ai)

<p align="center">
  <b>Break Loopback Limits · QR Instant Pairing · Full Workspace Parity · End-to-End Security Gateway</b>
</p>

English Documentation · [简体中文](./README.md)

<p align="center">
  <a href="#about">About</a> •
  <a href="#advantages">Key Advantages</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#config">Required Config</a> •
  <a href="#preview">UI Preview</a> •
  <a href="#features">Features</a> •
  <a href="#install">Installation</a> •
  <a href="#faq">FAQ</a>
</p>

---

</div>

<span id="about"></span>
## 📖 About

`dsh-remote-mobile` is a dedicated remote and mobile security governance plugin designed specifically for **DeepSeek Hub (DSH)**.

By default, DSH strictly listens only to the local loopback address (`127.0.0.1`), preventing mobile devices, tablets, or external computers from accessing the Web console. This plugin uses **global security gate middleware** and **request context virtualization** to securely open up **Tailscale Private Network** and **Local Area Network (LAN / Wi-Fi)** access, complete with RSA transmission encryption, QR code pairing, persistent password auth, and automated brute-force defense.

---

<span id="advantages"></span>
## ⚡ Key Advantages

* 🚀 **Break Network Barriers with Full Workspace Parity**: Solves the core issue of accessing DSH Web over LAN and Tailscale. When accessed on mobile devices, **creating workspaces, switching workspaces, and executing terminal commands are 100% supported** without any feature degradation!
* 📱 **Unified Codebase with Web (Zero Backend Overhead)**: Mobile devices share the exact same DSH Web core runtime and ecosystem plugins (such as `dsh-pet`, task boards, etc.). Zero duplicate backend maintenance needed; future enhancements only require standard responsive styling adjustments!
* 🛡️ **End-to-End Security Gateway & Encryption**: Built-in client-side RSA asymmetric public key encryption, `scrypt` salted slow-hashing password persistence, and automated IP lockout upon consecutive brute-force failures.
* 📲 **Out-of-the-Box Instant QR Pairing**: Auto-detects Tailscale CGNAT and LAN IP addresses to generate dedicated pairing QR codes. Authenticate and obtain persistent credentials in under 5 seconds.
* 🔄 **SSE Real-Time Push Stream**: Device connection, reconnection, revocation, and security alert events are broadcasted instantaneously via Server-Sent Events without polling.

---

<span id="quick-start"></span>
## 🚀 Quick Start

### 1. One-Command Installation

Run the DSH official plugin management command in your terminal (Recommended):

```bash
dsh plugin --profile web add dsh-remote-mobile
```

---

<span id="config"></span>
### 2. Required Configuration (Open External Listening)

Because DSH defaults to `127.0.0.1`, ensure your `~/.dsh/profiles/web/cordis.patch.yml` includes the following configuration to allow external connectivity:

```yaml
# 1. Allow webserver to listen for external connections (Required)
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: '0.0.0.0'
    port: 3080

# 2. Disable legacy remote plugin built into @linxin666/dsh-web-ui-all (Required: prevent route conflicts)
- id: web-ui-remote-web-ui
  disabled: true
```

> **💡 Note**: Plugin self-registration is automatically handled by the DSH Bundle system. You do **not** need to add `id: remote-mobile` manually.

---

### 3. Launch & Pair

```bash
dsh web --no-open
```

Open the DSH Web Console in your browser, navigate to **Settings ⚙️ -> Remote & Mobile Access**, and scan the QR code with your mobile camera or WeChat to start using DSH on mobile!

---

<span id="preview"></span>
## 🖼️ UI Preview

### Desktop DSH Plugin Control Panel

| Network Access & QR Pairing | Persistent Passwords, Device Sessions & IP Audit |
| :---: | :---: |
| ![PC Settings - Network & QR](images/pc-dsh-setting-1.png) | ![PC Settings - Passwords & Devices](images/pc-dsh-setting-2.png) |

---

### Mobile Live Demonstration (Same-Origin Auth & Full Workspace Control)

| Mobile QR Auth & Login Page | Full DSH Workspace Control on Mobile |
| :---: | :---: |
| ![Mobile Auth Page](images/mobile-auth.jpg) | ![Mobile Workspace Control](images/mobile-dsh.jpg) |

---

<span id="features"></span>
## 🌟 Features

### 1. Network Access
- **Tailscale Private Network**: Automatically detects local Tailscale IP (`100.64.0.0/10` CGNAT subnet), creates pairing QR codes, and supports direct passwordless bypass (transport encryption guaranteed by Tailscale WireGuard tunnels).
- **Local Area Network (LAN / Wi-Fi)**: Automatically detects RFC 1918 private IPs (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`), generates LAN pairing QR codes with direct link previews and prominent high-risk security warnings.
- **Instant QR Pairing**: Scan QR codes directly with any mobile camera or scanner app to authenticate.

### 2. Multi-Tier Authentication
- **Dynamic 6-Digit Pairing Codes**: Generates 6-digit short codes (5-minute validity, single-use) that exchange for 365-day persistent authentication cookies on mobile.
- **Persistent Access Passwords**: Set customizable persistent passwords (minimum 6 characters with letters and numbers) for seamless long-term logins across multiple devices.
- **Direct Bypass Mode**: Enable passwordless direct bypass independently for Tailscale or LAN. Disabling bypass immediately cleans up temporary credentials and resets device state.
- **Device Session Management**: Real-time inspection of connected device types, OS, browser, source IP, and last active timestamp, with single-device kick-off and one-click bulk revocation.

### 3. Enterprise-Grade Security
- **Transport RSA Asymmetric Encryption**: Login authentication endpoints support client-side RSA encryption (RSA-OAEP-SHA256 & PKCS#1 v1.5 compatible), ensuring passwords and pairing codes are never transmitted in plaintext.
- **scrypt Slow Hash Storage**: Server persists passwords with `scrypt` salted slow-hashing (`scrypt:${salt}:${hash}`). Verification uses `crypto.timingSafeEqual` constant-time comparison to eliminate timing side-channel attacks.
- **Brute-Force Defense & Rate Limiting**:
  - Automatically locks out IPs for 15 minutes after reaching consecutive failed attempt thresholds (default: 5), returning HTTP 429;
  - Sliding-window rate limiting (default: 60 visits/min) to prevent high-frequency scraping;
  - Audit logs and lockout states persist to disk and restore across restarts;
  - Administrators can manually unlock blocked IPs with one click in the panel.
- **Real Socket IP Extraction**: Relies strictly on underlying Socket connection addresses, preventing spoofed `X-Forwarded-For` header attacks.

### 4. Real-Time Sync & Internationalization
- **SSE Full-Duplex Channel**: Real-time push notifications for new device pairing, reconnections, revocations, and security alerts.
- **Adaptive Bilingual UI**: Automatically switches between English and Simplified Chinese based on DSH settings and browser language preferences.
- **Non-HTTPS Compatibility Patch**: Injects `crypto.randomUUID` Polyfill into HTML templates to fix missing native Web Crypto APIs in HTTP non-secure mobile browser contexts.

---

<span id="install"></span>
## 📦 All Installation Methods

<details>
<summary><b>Expand to view all 4 installation methods</b></summary>

### Method 1: DSH CLI One-Command Install (Recommended)
```bash
dsh plugin --profile web add dsh-remote-mobile
```

### Method 2: Web GUI Plugin Marketplace Install
1. Open DSH Web console in your browser;
2. Navigate to **Settings ⚙️ -> Plugins**;
3. Switch to the **Plugin Management** tab at the top;
4. Enter the npm package name **`dsh-remote-mobile`** and click **Install**;
5. Restart DSH after installation completes.

### Method 3: Install via Package Manager in Profile Directory
```bash
# 1. Navigate to DSH Web Profile directory
cd ~/.dsh/profiles/web

# 2. Install using pnpm
pnpm add dsh-remote-mobile
```

### Method 4: Local Source Development (Instant Symlink Sync)
```bash
# 1. Clone source code
git clone https://github.com/IceApriler/dsh-remote-mobile.git
cd dsh-remote-mobile

# 2. Install dependencies & build
npm install
npm run build

# 3. Create symlink to DSH runtime (changes take effect instantly on npm run build)
rm -rf ~/.dsh/profiles/web/node_modules/dsh-remote-mobile
ln -s $(pwd) ~/.dsh/profiles/web/node_modules/dsh-remote-mobile
```

</details>

---

## ⚙️ Advanced Configuration

Fully integrated with the DSH official Settings system. Configurations can be adjusted in the Web UI or edited in `~/.dsh/settings.yaml` under the `dsh-remote-mobile` namespace:

```yaml
dsh-remote-mobile:
  allowTailscale: false       # boolean, default false: allow passwordless access via Tailscale
  allowLan: false             # boolean, default false: allow passwordless access via LAN (High Risk)
  secretHash: ""              # string, default empty: scrypt salted hash of the persistent password
  maxVisitsPerMinute: 60      # number, default 60: max login page visits per minute per IP
  maxFailedAttempts: 5        # number, default 5: max consecutive failed attempts before IP lockout
  lockDurationMs: 900000      # number, default 900000 (15 mins): IP lockout duration in ms
```

---

## 📂 Local File Storage Locations

| Path | Description | Security Level |
|---|---|---|
| `~/.dsh/settings.yaml` | Global security policies & bypass toggles | User R/W |
| `~/.dsh/remote-mobile/devices.json` | Authorized devices, sessions & IP audit statistics | Local persistence |
| `~/.dsh/remote-mobile/rsa_private.key` | Server RSA private key | `0o600` (Restricted to current user) |

---

<span id="faq"></span>
## ❓ FAQ

<details>
<summary><b>Q1: Getting "Connection Refused" or cannot open page when scanning on mobile?</b></summary>

**Answer**: Please verify the following 3 items:
1. Ensure `host: '0.0.0.0'` is properly configured in `cordis.patch.yml` and DSH has been restarted;
2. For LAN access, ensure your mobile phone and computer are connected to the exact same Wi-Fi router;
3. If OS firewall is active on the computer, ensure inbound traffic on port `3080` is allowed.
</details>

<details>
<summary><b>Q2: What is the difference between Tailscale Bypass and LAN Bypass?</b></summary>

**Answer**:
* **Tailscale Bypass**: Highly secure. Tailscale operates over an end-to-end encrypted WireGuard overlay where only devices logged into your account can connect.
* **LAN Bypass**: Inherent risks. Anyone connected to your Wi-Fi (including guests or unauthorized devices) can control your workspace. **Never enable this on untrusted networks**.
</details>

<details>
<summary><b>Q3: Does mobile support creating and switching workspaces normally?</b></summary>

**Answer**: **Fully Supported!** The plugin virtualizes the full execution context, granting mobile devices 100% feature parity with the desktop Web interface.
</details>

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
