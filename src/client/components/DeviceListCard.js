/**
 * 卡片 4: 详细已授权设备列表 (支持中英文国际化)
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

export function renderDeviceListCard(jsx, status, revokeDevice, revokeAll, lang) {
  return jsx.jsxs("div", {
    style: {
      background: "var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))",
      border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))",
      borderRadius: "12px",
      padding: "18px 20px"
    },
    children: [
      jsx.jsxs("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "14px"
        },
        children: [
          jsx.jsxs("div", {
            style: { minWidth: 0 },
            children: [
              jsx.jsx("div", {
                style: {
                  fontSize: "15px",
                  fontWeight: "600",
                  color: "var(--dsw-alias-label-primary, inherit)"
                },
                children: "📱 " + t("deviceCardTitle", lang) + " (" + status.devicesCount + (lang === 'en' ? " devices" : " 台") + ")"
              }),
              jsx.jsx("div", {
                style: {
                  fontSize: "12px",
                  color: "var(--dsw-alias-label-tertiary, #888)",
                  marginTop: "2px"
                },
                children: t("deviceCardDesc", lang)
              })
            ]
          }),
          status.devicesCount > 0 ? jsx.jsx("button", {
            type: "button",
            onClick: revokeAll,
            style: {
              background: "transparent",
              border: "1px solid rgba(239,68,68,0.4)",
              color: "var(--dsw-alias-label-error, #ef4444)",
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0
            },
            children: t("revokeAllBtn", lang)
          }) : null
        ]
      }),

      // 设备条目列表
      status.devices && status.devices.length > 0 ? jsx.jsx("div", {
        style: { display: "flex", flexDirection: "column", gap: "10px" },
        children: status.devices.map(function(dev) {
          var isLocal = isCurrentLocalIp(dev.ip, status);
          var ipLabel = dev.ip + (isLocal ? (lang === 'en' ? " (Local)" : " (本机)") : "");
          return jsx.jsxs("div", {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              padding: "12px 14px",
              background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08))",
              border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))",
              borderRadius: "8px"
            },
            children: [
              jsx.jsxs("div", {
                style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, flex: 1 },
                children: [
                  jsx.jsxs("div", {
                    style: {
                      fontSize: "14px",
                      fontWeight: "600",
                      color: "var(--dsw-alias-label-primary, inherit)",
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "8px"
                    },
                    children: [
                      jsx.jsx("span", { children: dev.deviceName || (lang === 'en' ? "Mobile Device" : "移动端设备") }),
                      jsx.jsx("span", {
                        style: {
                          fontSize: "11px",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          background: dev.isBypass ? "rgba(16,185,129,0.15)" : "rgba(59,130,246,0.15)",
                          color: dev.isBypass ? "#10b981" : "var(--dsw-alias-brand-primary, #3b82f6)",
                          fontWeight: "normal",
                          whiteSpace: "nowrap"
                        },
                        children: dev.authType
                      })
                    ]
                  }),
                  jsx.jsxs("div", {
                    style: {
                      fontSize: "12px",
                      color: "var(--dsw-alias-label-tertiary, #888)",
                      lineHeight: "1.4",
                      wordBreak: "break-word"
                    },
                    children: [
                      (lang === 'en' ? "IP: " : "来源 IP: "), ipLabel,
                      (lang === 'en' ? " · Authorized: " : " · 授权于 "), formatTime(dev.createdAt, lang),
                      (lang === 'en' ? " · Last seen: " : " · 最近活跃 "), formatTime(dev.lastSeenAt, lang)
                    ]
                  })
                ]
              }),
              !dev.isBypass ? jsx.jsx("button", {
                type: "button",
                onClick: function() { revokeDevice(dev.token); },
                style: {
                  padding: "5px 12px",
                  background: "transparent",
                  border: "1px solid rgba(239,68,68,0.3)",
                  color: "var(--dsw-alias-label-error, #ef4444)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0
                },
                children: t("revokeDeviceBtn", lang)
              }) : null
            ]
          }, dev.token);
        })
      }) : jsx.jsx("div", {
        style: {
          textAlign: "center",
          padding: "16px",
          color: "var(--dsw-alias-label-tertiary, #888)",
          fontSize: "13px"
        },
        children: t("noDevices", lang)
      })
    ]
  });
}
