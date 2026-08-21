# dsh-remote-mobile

[English Documentation](./README_EN.md) | 简体中文

`dsh-remote-mobile` 是专为 DeepSeek Hub (DSH) 设计的远程与移动端安全接入插件。

DSH 核心服务默认仅允许本地回环地址（`127.0.0.1`）访问 Web 界面。本项目通过门禁中间件与请求上下文虚拟化机制，安全地开放了 Tailscale 虚拟局域网以及本地局域网（LAN）访问能力，并提供扫码配对、长期密码认证、防暴力破解限频、落盘持久化和 SSE 实时状态推送。

---

## 🌟 主要功能

### 1. 网络接入支持
- **Tailscale 虚拟私网**：自动识别本机的 Tailscale IP（`100.64.0.0/10` CGNAT 网段），生成专属访问二维码，支持端到端加密免密直连选项。
- **局域网 (LAN)**：自动识别 RFC 1918 私有 IP（如 `192.168.x.x`、`10.x.x.x`、`172.16-31.x.x`），提供独立的局域网访问二维码与高危醒目警示配置。
- **二维码快速配对**：支持手机相机或微信扫码直接打开登录页面。

### 2. 多重认证机制
- **动态配对码**：生成 6 位短期配对码（5 分钟有效，一次性消费），手机扫码输入后换取 365 天有效期的认证 Cookie。
- **长期访问密码**：支持设置访问密码（需包含字母与数字，长度不小于 6 位），验证成功后同样派发 365 天长效 Cookie。
- **免密直连模式**：可针对 Tailscale 或局域网环境单独开启免密直连。关闭免密后会自动清理临时设备凭证并重置状态。
- **设备会话管理**：实时查看已连接设备的类型、操作系统、浏览器、来源 IP 及最近活跃时间，支持单设备注销与一键全部踢出。

### 3. 企业级安全防护
- **传输层加密**：登录认证接口支持 RSA 密钥加密（RSA-OAEP-SHA256 与 PKCS#1 v1.5 兼容），密文在客户端加密后再通过网络传输。
- **慢哈希存储**：服务端采用 `scrypt` 加盐慢哈希算法（`scrypt:${salt}:${hash}`）对密码进行落盘存储，比对过程采用 `crypto.timingSafeEqual` 恒定时间比对以防范时序侧信道攻击。
- **防暴力破解与限频**：
  - 连续输错 5 次凭证自动锁定该 IP 15 分钟，拦截后续验证请求并返回 HTTP 429；
  - 滑动窗口限频（默认 60 次/分钟），防止高频刷量；
  - 访问审计与锁定状态持久化保存，服务重启后自动恢复；
  - 支持管理员在面板中手动一键解除 IP 锁定。
- **请求头安全**：仅信任底层 Socket 真实连接地址，防范 `X-Forwarded-For` 伪造。

### 4. 实时状态同步与国际化支持
- **SSE 事件通道**：基于 Server-Sent Events 实现新设备配对、重连上线、会话撤销及安全告警的实时通知，无需前端轮询。
- **全界面中英文双语自适应**：根据 DSH 语言偏好设置与浏览器语言，动态自适应中英文面板、提示及手机端登录界面。
- **非 HTTPS 兼容补丁**：自动向 HTML 页面注入 `crypto.randomUUID` Polyfill，解决部分移动端浏览器在 HTTP 非安全上下文下缺少原生 API 的问题。

---

## 🛠️ 安装与前置配置

### 步骤 1：安装插件

#### 方式 1：通过 DSH 命令行一键安装（推荐）

使用 DSH 内置的插件管理工具直接从 npm 官方仓库安装到 web profile：

```bash
dsh plugin --profile web add dsh-remote-mobile
```

#### 方式 2：通过 DSH 插件市场（DSH Market）可视化安装

如果您安装了 `dshmarket` 可视化插件市场：
1. 打开 DSH Web 控制台；
2. 点击左侧导航栏的 **🧩 插件市场**；
3. 搜索 **`dsh-remote-mobile`** 或 **`远程与移动端`**；
4. 点击 **「一键安装」** 即可。

#### 方式 3：手动在 Profile 目录中通过包管理器安装

```bash
# 1. 进入 DSH Web Profile 目录
cd ~/.dsh/profiles/web

# 2. 通过 pnpm 安装
pnpm add dsh-remote-mobile

# 3. 检查 ~/.dsh/profiles/web/package.json
# 确保 dsh.profile.bundles 数组中已包含 "dsh-remote-mobile"
```

#### 方式 4：本地开发与源码安装

```bash
# 1. 克隆或下载源码至本地目录
cd ~/Myfile/www-self/dsh-remote-mobile

# 2. 安装依赖并编译打包
npm install
npm run build && npm test && npm pack

# 3. 在 DSH 中以本地包形式安装
cd ~/.dsh/profiles/web
pnpm add /path/to/dsh-remote-mobile/dsh-remote-mobile-1.0.0.tgz
```

---

### 步骤 2：开放网络监听配置（前置必配）

由于 DSH 默认出于安全考虑仅监听 `127.0.0.1`（本地回环），为了使 Tailscale 私网或局域网设备能够连通，请在 `~/.dsh/profiles/web/cordis.patch.yml` 中确保包含以下配置：

```yaml
# 1. 覆盖 webserver 配置监听 0.0.0.0:3080（必选：允许接收外部连接）
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: '0.0.0.0'
    port: 3080

# 2. 禁用 @linxin666/dsh-web-ui-all 全家桶自带的远程插件（必选：防止路由冲突与界面覆盖）
- id: web-ui-remote-web-ui
  disabled: true
```

> **💡 说明**：插件自身的注册已由 DSH Bundle 自动处理，**无需**在 `cordis.patch.yml` 中额外添加 `id: remote-mobile`。

---

### 步骤 3：启动服务

```bash
dsh web
```

启动后，在 PC 端浏览器打开 `http://127.0.0.1:3080`，进入 **设置 ⚙️ -> 远程与移动端 (Remote & Mobile)** 即可查看配对二维码或配置访问密码。

---

## ⚙️ 配置项说明

在 `~/.dsh/settings.yaml` 中可配置插件参数（**推荐直接在 Web 面板中可视化调整**，修改后自动写回持久化）：

```yaml
dsh-remote-mobile:
  # 免密直连开关
  allowTailscale: true        # boolean，默认 false：Tailscale 节点访问是否免密
  allowLan: false             # boolean，默认 false：局域网 (Wi-Fi) 设备访问是否免密

  # 长期访问密码哈希（在面板中输入明文会自动生成加盐哈希保存）
  secretHash: ''              # string，默认空

  # 全局高级安全防护参数
  maxVisitsPerMinute: 60      # number，默认 60：单 IP 每分钟打开 /auth 页面最大允许次数
  maxFailedAttempts: 5        # number，默认 5：密码连续输错阈值
  lockDurationMs: 900000      # number，默认 900000 (15分钟)：IP 锁定持续时间（毫秒）
```

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `allowTailscale` | `boolean` | `false` | 是否允许 Tailscale 私网 IP 免密访问 |
| `allowLan` | `boolean` | `false` | 是否允许局域网私有 IP 免密访问（高危警示） |
| `secretHash` | `string` | `""` | 长期密码的 scrypt 加盐哈希值 |
| `maxVisitsPerMinute` | `number` | `60` | 单 IP 每分钟最大访问登录页次数 |
| `maxFailedAttempts` | `number` | `5` | 连续认证失败最大次数（达到后自动封锁 IP） |
| `lockDurationMs` | `number` | `900000` | 触发防暴破后的 IP 锁定时间（毫秒） |

---

## 📂 本地文件存储位置

- **设备会话与安全审计数据**：`~/.dsh/remote-mobile/devices.json`
- **RSA 传输加密密钥对**：`~/.dsh/remote-mobile/rsa-keys.json`（权限模式为 `0600`，首次启动自动就地生成）

---

## 🔒 安全建议

1. **局域网免密风险**：若在公共 Wi-Fi、咖啡厅或共享网络环境下使用，**严禁开启 `allowLan`（局域网免密直连）**。
2. **Tailscale 推荐**：建议优先配合 Tailscale 虚拟专用网络使用，既能保障公网不可达，又能获得端到端加密传输保障。
3. **密码复杂度**：若使用长期密码，建议设置包含字母与数字且 6 位以上的高强度密码。

---

## 🗑️ 卸载插件

```bash
dsh plugin --profile web remove dsh-remote-mobile
```

---

## 📄 开源许可

[MIT License](./LICENSE)
