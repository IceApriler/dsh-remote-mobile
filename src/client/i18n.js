/**
 * 国际化多语言字典与辅助函数 (中英文双语支持)
 */

export var translations = {
  zh: {
    // 主面板
    title: "远程与移动端",
    subtitle: "支持 Tailscale 虚拟私网与本地局域网 (Wi-Fi) 接入，提供扫码快速配对与长期访问密码。",

    // 卡片 1: 网络与直连
    netCardTitle: "网络接入地址与免密直连管理",
    netCardDesc: "在手机浏览器中直接输入下列地址，或通过下方二维码扫码配对。若您处于可信安全网络环境中，可开启免密直连功能。",
    tailscaleSectionTitle: "Tailscale 虚拟私网接入 (推荐)",
    tailscaleBadge: "Tailscale IP",
    tailscaleNotConnected: "未检测到 Tailscale 虚拟私网 IP",
    tailscaleGuide: "请确保本机已安装并登录 Tailscale。通过虚拟私网访问既安全又无需公网映射。",
    lanSectionTitle: "本地局域网接入 (LAN / Wi-Fi)",
    lanBadge: "局域网 IP",
    lanNotConnected: "未检测到可用的本地局域网 IP",
    copyUrlBtn: "📋 复制链接",
    copiedTip: "已成功复制链接到剪贴板！",
    directBypassToggle: "免密直连模式 (直达页面)",
    directBypassOn: "已开启免密直连",
    directBypassOff: "已关闭免密直连",
    tailscaleBypassDesc: "开启后，所有通过 Tailscale 私网访问的设备无需输入密码或配对码即可直接进入控制台（推荐在个人 Tailnet 私网中开启）。",
    lanBypassWarningTitle: "🚨 极高风险警示：局域网免密控制风险",
    lanBypassDesc: "开启局域网免密后，连接同一 Wi-Fi 路由器的任意设备（包括家庭访客、公共蹭网者）均无需密码即可直接控制和执行本服务！强烈建议仅在完全私有可信的网络中谨慎开启。",
    lanBypassConfirm: "【🚨 极高安全风险操作确认】\n\n确定要开启「局域网免密直连」吗？\n\n⚠️ 开启后果：\n同一 Wi-Fi 下的任何其他设备（手机/电脑/访客设备）无需输入任何密码或配对码，就能直接接管并控制您的 DSH 工作区与终端服务！\n\n请务必确认您当前连接的是完全可信的家庭私有 Wi-Fi，切勿在公共网络（咖啡厅/酒店/公司 Wi-Fi）中开启！",

    // 卡片 2: 配对码与二维码
    pairingCardTitle: "手机快速配对与扫码接入",
    pairingCardDesc: "手机与电脑连接同一网络后，使用手机微信或相机直接扫描下方二维码，或手动输入 6 位短期配对码即可快速完成身份授权与设备绑定。",
    shortCodeTitle: "6 位短期动态配对码",
    codeValidUntil: "有效期剩余：",
    codeExpired: "配对码已过期，请点击刷新重新生成",
    clickToReveal: "点击查看 6 位配对码",
    clickToHide: "点击隐藏",
    refreshCodeBtn: "🔄 刷新配对码",
    qrTitle: "扫码免输密码直连",
    toggleQrShow: "显示配对二维码",
    toggleQrHide: "收起二维码",
    switchTailscaleTab: "Tailscale 扫码",
    switchLanTab: "局域网 (Wi-Fi) 扫码",
    copyDirectAuthLink: "📋 复制带配对码直链",

    // 卡片 3: 长期密码
    secretCardTitle: "设置长期访问密码 (可选)",
    secretCardDesc: "如果不希望每次使用 6 位短期配对码，可在此设置一个固定密码。在手机端输入此密码也可完成验证并换取持久授权。",
    secretConfigured: "✅ 当前已配置长期访问密码 (已安全加盐加密落盘存储)",
    secretNotConfigured: "⚪ 当前未配置长期访问密码 (仅能通过临时配对码授权)",
    secretInputPlaceholder: "请输入 6 位以上字母与数字组合密码",
    secretInputLabel: "长期密码：",
    showPassword: "👁️ 显示密码",
    hidePassword: "🙈 隐藏密码",
    saveSecretBtn: "💾 保存密码",
    clearSecretBtn: "🗑️ 清除密码",
    secretWeakTip: "密码必须至少 6 位，且同时包含字母和数字",
    clearSecretConfirm: "确定要清除已设置的长期密码吗？清除后将无法再使用固定密码登录。",

    // 卡片 4: 设备列表
    deviceCardTitle: "已授权接入设备列表",
    deviceCardDesc: "所有已通过短期配对码、长期密码或免密直连成功接入的移动设备。您可以随时撤销单个设备，或一键注销全部设备。",
    authDevicesCount: "台设备已授权",
    revokeAllBtn: "🗑️ 一键注销所有设备",
    revokeAllConfirm: "确定要撤销并踢下线所有已授权的设备吗？",
    noDevices: "暂无已授权设备，使用手机扫码配对后将在此自动列出。",
    deviceOnlineNow: "在线",
    deviceOffline: "离线",
    deviceBypassLabel: "免密直连",
    devicePasscodeLabel: "配对码授权",
    deviceSecretLabel: "长期密码",
    deviceFirstSeen: "首次授权：",
    deviceLastSeen: "最近活跃：",
    revokeDeviceBtn: "踢下线",
    revokeDeviceConfirm: "确定要撤销这台设备的访问权限吗？",

    // 卡片 5: 防暴力破解与审计
    securityCardTitle: "防暴力破解与 IP 安全审计",
    securityCardDesc: "实时监控所有外部访问 IP 的请求频率与认证失败次数。连续输错 5 次将自动锁定 IP，防止密码被恶意暴力枚举。",
    securityNormal: "✅ 所有外部访问 IP 状态正常，未检测到暴力破解或异常爆破风险。",
    unlockIpBtn: "🔓 解除锁定",
    unlockIpConfirm: "确定要为 IP {ip} 解除封锁吗？",
    clearSecurityLogBtn: "🗑️ 清空审计日志",
    clearSecurityLogConfirm: "确定要清空所有 IP 访问与安全审计日志吗？",
    thIp: "访问来源 IP",
    thStatus: "当前状态",
    thFailed: "失败/总次数",
    thLastSeen: "最近访问",
    thAction: "操作",
    statusLocked: "🚫 已被锁定",
    statusNormal: "🟢 正常",

    // 卡片 6: 本地存储说明
    storageCardTitle: "本地数据与密钥持久化存储说明",
    storageCardDesc: "所有敏感凭证均在本地经过加盐哈希或非对称加密保护，不依赖任何第三方云端鉴权中心。",
    storageDeviceFile: "已授权设备与会话缓存文件：",
    storageRsaFile: "服务端 RSA 私钥文件 (0o600 权限保护)：",
    storageConfigFile: "主配置文件 (命名空间: dsh-remote-mobile)：",

    // 卡片 7: 全局高级配置
    configCardTitle: "全局高级安全参数配置",
    configCardDesc: "调整单 IP 访问频率限制、输错封禁阈值与锁定持续时间。点击保存将立即生效并自动同步写回 ~/.dsh/settings.yaml 配置文件。",
    copySettingsPathBtn: "📋 复制 settings.yaml 路径",
    fieldVisitsLimit: "⏱️ 每分钟访问上限 (次/分)",
    fieldVisitsLimitHint: "单 IP 1分钟内打开登录页超过此值将触发限频",
    fieldFailedLimit: "🛡️ 输错密码封禁阈值 (次)",
    fieldFailedLimitHint: "连续输错配对码/密码达到此值将封锁该 IP",
    fieldLockDuration: "🚫 触发封锁持续时间 (分钟)",
    fieldLockDurationHint: "IP 被锁定后的冷却等待时长 (默认 15 分钟)",
    restoreDefaultsBtn: "🔄 恢复默认参数",
    saveConfigBtn: "💾 保存参数配置",
    savingConfigBtn: "正在保存...",
    saveConfigSuccessToast: "高级安全参数已成功保存并同步到 settings.yaml！",
    saveConfigFailTip: "参数必须为大于 0 的有效整数",

    // Toast 提示
    toastDeviceConnected: "🎉 新设备接入成功：{name} ({ip})",
    toastDeviceOnline: "📶 设备重新上线：{name} ({ip})",
    toastIpLocked: "🚫 触发安全警报：IP {ip} 连续认证失败已被锁定！"
  },

  en: {
    // Main
    title: "Remote & Mobile Access",
    subtitle: "Enable access via Tailscale private network and local Wi-Fi, featuring QR code pairing and persistent passwords.",

    // Card 1: Network & Bypass
    netCardTitle: "Network Access & Bypass Management",
    netCardDesc: "Enter the address below in your mobile browser, or scan the QR code to pair. You can enable direct bypass if you are in a trusted private network.",
    tailscaleSectionTitle: "Tailscale Private Network (Recommended)",
    tailscaleBadge: "Tailscale IP",
    tailscaleNotConnected: "No Tailscale private IP detected",
    tailscaleGuide: "Please ensure Tailscale is installed and logged in on this machine for secure access without port forwarding.",
    lanSectionTitle: "Local Area Network (LAN / Wi-Fi)",
    lanBadge: "LAN IP",
    lanNotConnected: "No available local LAN IP detected",
    copyUrlBtn: "📋 Copy Link",
    copiedTip: "Link copied to clipboard!",
    directBypassToggle: "Direct Bypass Mode (Passwordless)",
    directBypassOn: "Bypass Enabled",
    directBypassOff: "Bypass Disabled",
    tailscaleBypassDesc: "When enabled, any device connecting via Tailscale can directly access the console without passwords or pairing codes.",
    lanBypassWarningTitle: "🚨 HIGH RISK SECURITY WARNING: LAN BYPASS",
    lanBypassDesc: "Enabling LAN Bypass allows ANY device connected to the same Wi-Fi router (including guest/shared users) to execute commands and control DSH without any authentication. ONLY enable this in completely trusted home private networks!",
    lanBypassConfirm: "[🚨 CRITICAL SECURITY RISK CONFIRMATION]\n\nAre you sure you want to enable LAN Passwordless Bypass?\n\n⚠️ Consequences:\nANY device on the same Wi-Fi network (smartphones, PCs, guests) will gain FULL access and control over your DSH workspace without passwords or codes!\n\nDo NOT enable this on public networks (Cafes, Hotels, Office Wi-Fi)!",

    // Card 2: Pairing & QR
    pairingCardTitle: "Quick Pairing & QR Code Access",
    pairingCardDesc: "When both devices are on the same network, scan the QR code or enter the 6-digit dynamic pairing code to authenticate.",
    shortCodeTitle: "6-Digit Dynamic Pairing Code",
    codeValidUntil: "Expires in: ",
    codeExpired: "Pairing code expired. Click refresh to generate a new one.",
    clickToReveal: "Click to reveal 6-digit code",
    clickToHide: "Click to hide",
    refreshCodeBtn: "🔄 Refresh Code",
    qrTitle: "Scan QR Code for Instant Access",
    toggleQrShow: "Show QR Code",
    toggleQrHide: "Hide QR Code",
    switchTailscaleTab: "Tailscale QR",
    switchLanTab: "LAN (Wi-Fi) QR",
    copyDirectAuthLink: "📋 Copy Link with Code",

    // Card 3: Persistent Password
    secretCardTitle: "Configure Persistent Password (Optional)",
    secretCardDesc: "If you prefer not using 6-digit short codes every time, set a fixed password here. Entering this password on mobile grants persistent access.",
    secretConfigured: "✅ Persistent password is configured (securely salted & encrypted)",
    secretNotConfigured: "⚪ No persistent password set (authentication via temporary codes only)",
    secretInputPlaceholder: "Enter a password with at least 6 alphanumeric characters",
    secretInputLabel: "Password:",
    showPassword: "👁️ Show Password",
    hidePassword: "🙈 Hide Password",
    saveSecretBtn: "💾 Save Password",
    clearSecretBtn: "🗑️ Clear Password",
    secretWeakTip: "Password must be at least 6 characters and contain both letters and numbers",
    clearSecretConfirm: "Are you sure you want to clear the persistent password? You will no longer be able to log in with a fixed password.",

    // Card 4: Device List
    deviceCardTitle: "Authorized Devices List",
    deviceCardDesc: "All mobile devices successfully authorized via pairing code, persistent password, or bypass. You can revoke access at any time.",
    authDevicesCount: "device(s) authorized",
    revokeAllBtn: "🗑️ Revoke All Devices",
    revokeAllConfirm: "Are you sure you want to disconnect and revoke all authorized devices?",
    noDevices: "No authorized devices yet. Scan the QR code with your mobile device to connect.",
    deviceOnlineNow: "Online",
    deviceOffline: "Offline",
    deviceBypassLabel: "Bypass",
    devicePasscodeLabel: "Code",
    deviceSecretLabel: "Password",
    deviceFirstSeen: "Authorized: ",
    deviceLastSeen: "Last active: ",
    revokeDeviceBtn: "Revoke",
    revokeDeviceConfirm: "Are you sure you want to revoke access for this device?",

    // Card 5: Security & Audit
    securityCardTitle: "Brute-Force Defense & IP Audit",
    securityCardDesc: "Real-time monitoring of external access IP request frequencies and failure rates. Automatically locks IPs after 5 consecutive failures.",
    securityNormal: "✅ All external IPs are in good standing. No brute-force attacks detected.",
    unlockIpBtn: "🔓 Unlock IP",
    unlockIpConfirm: "Are you sure you want to unlock IP {ip}?",
    clearSecurityLogBtn: "🗑️ Clear Audit Logs",
    clearSecurityLogConfirm: "Are you sure you want to clear all IP access and security audit logs?",
    thIp: "Client IP",
    thStatus: "Status",
    thFailed: "Fail / Total",
    thLastSeen: "Last Seen",
    thAction: "Actions",
    statusLocked: "🚫 Locked",
    statusNormal: "🟢 Normal",

    // Card 6: Storage
    storageCardTitle: "Local Storage & Key Persistence",
    storageCardDesc: "All sensitive credentials are protected locally via slow salt hashing and asymmetric RSA cryptography, without cloud dependencies.",
    storageDeviceFile: "Authorized devices & session cache:",
    storageRsaFile: "Server RSA private key (0o600 protected):",
    storageConfigFile: "Main configuration (namespace: dsh-remote-mobile):",

    // Card 7: Advanced Security Config
    configCardTitle: "Global Security Policy Configuration",
    configCardDesc: "Configure per-IP rate limits, brute-force failure thresholds, and lockout durations. Changes take effect immediately and sync to ~/.dsh/settings.yaml.",
    copySettingsPathBtn: "📋 Copy settings.yaml Path",
    fieldVisitsLimit: "⏱️ Max Visits per Minute (visits/min)",
    fieldVisitsLimitHint: "Rate limit triggered when a single IP opens login page more than this value",
    fieldFailedLimit: "🛡️ Max Failed Password Attempts (times)",
    fieldFailedLimitHint: "IP locked after consecutive incorrect pairing codes or passwords",
    fieldLockDuration: "🚫 Lockout Duration (minutes)",
    fieldLockDurationHint: "Cool-down lock period for blocked IPs (default: 15 minutes)",
    restoreDefaultsBtn: "🔄 Restore Defaults",
    saveConfigBtn: "💾 Save Configuration",
    savingConfigBtn: "Saving...",
    saveConfigSuccessToast: "Security policy successfully saved and synced to settings.yaml!",
    saveConfigFailTip: "Parameters must be valid integers greater than 0",

    // Toast
    toastDeviceConnected: "🎉 New device connected: {name} ({ip})",
    toastDeviceOnline: "📶 Device reconnected: {name} ({ip})",
    toastIpLocked: "🚫 Security Alert: IP {ip} locked due to consecutive failures!"
  }
};

/**
 * 获取当前界面的语言标识 ('zh' 或 'en')
 */
export function resolveLocale(ctx, status) {
  try {
    if (ctx) {
      if (typeof ctx.get === 'function') {
        var loc = ctx.get('locale');
        if (loc && loc.snapshot && loc.snapshot.active) {
          return loc.snapshot.active.startsWith('en') ? 'en' : 'zh';
        }
      }
      if (ctx.locale && ctx.locale.snapshot && ctx.locale.snapshot.active) {
        return ctx.locale.snapshot.active.startsWith('en') ? 'en' : 'zh';
      }
    }
  } catch (e) {}

  if (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) {
    return document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh';
  }

  if (status && typeof status.locale === 'string') {
    return status.locale.toLowerCase().startsWith('en') ? 'en' : 'zh';
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'zh';
  }

  return 'zh';
}

/**
 * 翻译文本函数
 */
export function t(key, lang, params) {
  var currentLang = (lang && (lang.startsWith('en') || lang === 'en')) ? 'en' : 'zh';
  var dict = translations[currentLang] || translations.zh;
  var text = dict[key] || translations.zh[key] || key;

  if (params && typeof params === 'object') {
    for (var p in params) {
      if (Object.prototype.hasOwnProperty.call(params, p)) {
        text = text.replace(new RegExp('\\{' + p + '\\}', 'g'), String(params[p]));
      }
    }
  }
  return text;
}
