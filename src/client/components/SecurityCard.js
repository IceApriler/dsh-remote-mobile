/**
 * 卡片 5: 安全防护与 IP 访问统计审计 (支持中英文国际化)
 */
import { formatTime } from '../utils/format.js';
import { t } from '../i18n.js';

function isCurrentLocalIp(ip, status) {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;
  if (status && status.lanIp && ip === status.lanIp) return true;
  if (status && status.tailscaleIp && ip === status.tailscaleIp) return true;
  if (typeof window !== "undefined" && window.location && window.location.hostname && ip === window.location.hostname) return true;
  return false;
}

export function renderSecurityCard(jsx, status, unlockIp, clearIpStats, lang) {
  return jsx.jsxs("div", {
    style: {
      background: "var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))",
      border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))",
      borderRadius: "12px",
      padding: "18px 20px"
    },
    children: [
      // 头部第 1 行：标题 + 清空日志按钮
      jsx.jsxs("div", {
        style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" },
        children: [
          jsx.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: "8px" },
            children: [
              jsx.jsx("span", { style: { fontSize: "16px" }, children: "🛡️" }),
              jsx.jsx("span", {
                style: { fontSize: "15px", fontWeight: "600", color: "var(--dsw-alias-label-primary, inherit)", whiteSpace: "nowrap" },
                children: t("securityCardTitle", lang)
              })
            ]
          }),
          (status.ipSecurityStats && status.ipSecurityStats.length > 0) ? jsx.jsx("button", {
            type: "button",
            onClick: clearIpStats,
            style: {
              background: "transparent",
              border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))",
              color: "var(--dsw-alias-label-secondary, inherit)",
              padding: "3px 10px",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: "pointer"
            },
            children: t("clearSecurityLogBtn", lang)
          }) : null
        ]
      }),

      // 头部第 2 行：双安全策略徽标
      jsx.jsxs("div", {
        style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" },
        children: [
          jsx.jsx("span", {
            style: {
              fontSize: "12px",
              color: "#10b981",
              background: "rgba(16,185,129,0.12)",
              padding: "2px 8px",
              borderRadius: "12px",
              fontWeight: "500"
            },
            children: lang === 'en' ? ("⏱️ IP Rate Limit: " + (status.maxVisitsPerMinute || 60) + "/min") : ("⏱️ 单 IP 限频 " + (status.maxVisitsPerMinute || 60) + "次/分钟")
          }),
          jsx.jsx("span", {
            style: {
              fontSize: "12px",
              color: "#10b981",
              background: "rgba(16,185,129,0.12)",
              padding: "2px 8px",
              borderRadius: "12px",
              fontWeight: "500"
            },
            children: lang === 'en' ? ("🛡️ Lockout: " + (status.maxFailedAttempts || 5) + " fails / " + Math.round((status.lockDurationMs || 900000) / 60000) + " mins") : ("🛡️ 连续 " + (status.maxFailedAttempts || 5) + " 次错误封锁 " + Math.round((status.lockDurationMs || 900000) / 60000) + " 分钟")
          })
        ]
      }),

      // 头部第 3 行：详细说明
      jsx.jsx("div", {
        style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #888)", marginBottom: "12px", lineHeight: "1.5" },
        children: t("securityCardDesc", lang)
      }),

      // 审计条目列表
      (status.ipSecurityStats && status.ipSecurityStats.length > 0) ? jsx.jsx("div", {
        style: { display: "flex", flexDirection: "column", gap: "8px" },
        children: status.ipSecurityStats.map(function(stat) {
          var isLocked = stat.lockedUntil && stat.lockedUntil > Date.now();
          var remMin = isLocked ? Math.ceil((stat.lockedUntil - Date.now()) / 60000) : 0;
          var matchedDevice = (status.devices && Array.isArray(status.devices)) ? status.devices.find(function(d) { return d.ip === stat.ip; }) : null;
          var effectiveAuthType = stat.authType;
          if (!effectiveAuthType || effectiveAuthType === "⚪ 待认证" || effectiveAuthType === "⚪ Pending") {
            if (matchedDevice) {
              if (matchedDevice.authType && matchedDevice.authType.indexOf("免密") !== -1) {
                effectiveAuthType = lang === 'en' ? "⚡ Bypass Access" : matchedDevice.authType;
              } else if (matchedDevice.authType && matchedDevice.authType.indexOf("密码") !== -1) {
                effectiveAuthType = lang === 'en' ? "🔑 Password Auth" : "🔑 长期密码认证";
              } else {
                effectiveAuthType = lang === 'en' ? "📱 QR Pairing Auth" : "📱 扫码配对认证";
              }
            }
          }

          var effectiveDeviceName = stat.deviceName;
          if (!effectiveDeviceName && matchedDevice && matchedDevice.deviceName) {
            effectiveDeviceName = matchedDevice.deviceName;
          }

          var isLocal = isCurrentLocalIp(stat.ip, status);
          var ipLabel = stat.ip + (isLocal ? (lang === 'en' ? " (Local)" : " (本机)") : "");

          return jsx.jsxs("div", {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              padding: "10px 14px",
              background: isLocked ? "rgba(239,68,68,0.08)" : "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08))",
              border: isLocked ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.1))",
              borderRadius: "8px"
            },
            children: [
              jsx.jsxs("div", {
                style: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0, flex: 1 },
                children: [
                  jsx.jsxs("div", {
                    style: { fontSize: "13px", fontWeight: "600", color: "var(--dsw-alias-label-primary, inherit)", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
                    children: [
                      jsx.jsxs("span", {
                        style: { display: "inline-flex", alignItems: "center", gap: "6px" },
                        children: [
                          effectiveDeviceName ? jsx.jsx("span", { style: { color: "var(--dsw-alias-label-primary, inherit)" }, children: effectiveDeviceName }) : null,
                          effectiveDeviceName ? jsx.jsx("span", { style: { color: "var(--dsw-alias-label-tertiary, #888)", fontWeight: "normal" }, children: "·" }) : null,
                          jsx.jsx("span", { style: { color: effectiveDeviceName ? "var(--dsw-alias-label-secondary, #888)" : "inherit" }, children: ipLabel })
                        ]
                      }),
                      effectiveAuthType ? (function() {
                        var bg = "rgba(148,163,184,0.15)";
                        var color = "#94a3b8";
                        if (effectiveAuthType.indexOf("免密") !== -1 || effectiveAuthType.indexOf("Bypass") !== -1) {
                          bg = "rgba(16,185,129,0.15)";
                          color = "#10b981";
                        } else if (effectiveAuthType.indexOf("扫码") !== -1 || effectiveAuthType.indexOf("Pairing") !== -1) {
                          bg = "rgba(59,130,246,0.15)";
                          color = "#3b82f6";
                        } else if (effectiveAuthType.indexOf("密码") !== -1 || effectiveAuthType.indexOf("Password") !== -1) {
                          bg = "rgba(139,92,246,0.15)";
                          color = "#a78bfa";
                        }
                        return jsx.jsx("span", {
                          style: { fontSize: "11px", padding: "1px 6px", borderRadius: "4px", background: bg, color: color, fontWeight: "600", whiteSpace: "nowrap" },
                          children: effectiveAuthType
                        });
                      })() : null,
                      isLocked ? jsx.jsxs("span", {
                        style: { fontSize: "11px", padding: "1px 6px", borderRadius: "4px", background: "rgba(239,68,68,0.2)", color: "#ef4444", fontWeight: "700", whiteSpace: "nowrap" },
                        children: [lang === 'en' ? ("🚫 Locked (" + remMin + "m left)") : ("🚫 已被锁定 (还剩 " + remMin + " 分钟)")]
                      }) : (stat.failedAttempts > 0 ? jsx.jsxs("span", {
                        style: { fontSize: "11px", padding: "1px 6px", borderRadius: "4px", background: "rgba(245,158,11,0.2)", color: "#f59e0b", fontWeight: "600", whiteSpace: "nowrap" },
                        children: [lang === 'en' ? ("⚠️ " + stat.failedAttempts + " failed attempts") : ("⚠️ 曾失败 " + stat.failedAttempts + " 次")]
                      }) : (!effectiveAuthType ? jsx.jsx("span", {
                        style: { fontSize: "11px", padding: "1px 6px", borderRadius: "4px", background: "rgba(148,163,184,0.15)", color: "#94a3b8", fontWeight: "600", whiteSpace: "nowrap" },
                        children: lang === 'en' ? "⚪ Pending" : "⚪ 待认证"
                      }) : null))
                    ]
                  }),
                  jsx.jsxs("div", {
                    style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #888)", lineHeight: "1.4", wordBreak: "break-word" },
                    children: [
                      lang === 'en'
                        ? ("Visits: " + stat.authVisits + " · Attempts: " + stat.totalAttempts + " · Consecutive fails: " + stat.failedAttempts + " · Last seen: " + formatTime(stat.lastSeenAt, lang))
                        : ("打开登录页 " + stat.authVisits + " 次 · 尝试配对 " + stat.totalAttempts + " 次 · 连续失败 " + stat.failedAttempts + " 次 · 最近访问 " + formatTime(stat.lastSeenAt, lang))
                    ]
                  })
                ]
              }),
              isLocked ? jsx.jsx("button", {
                type: "button",
                onClick: function() { unlockIp(stat.ip); },
                style: {
                  padding: "5px 12px",
                  background: "rgba(59,130,246,0.12)",
                  border: "1px solid rgba(59,130,246,0.3)",
                  color: "var(--dsw-alias-brand-primary, #3b82f6)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0
                },
                children: t("unlockIpBtn", lang)
              }) : null
            ]
          }, stat.ip);
        })
      }) : jsx.jsx("div", {
        style: {
          textAlign: "center",
          padding: "14px",
          color: "var(--dsw-alias-label-tertiary, #888)",
          fontSize: "13px"
        },
        children: t("securityNormal", lang)
      })
    ]
  });
}
