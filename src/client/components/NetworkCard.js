/**
 * 卡片 1: 网络接入地址与免密直连管理 (支持中英文国际化与高危醒目警示)
 */
import { t } from '../i18n.js';

export function renderNetworkCard(jsx, status, toggleTailscale, toggleLan, copyText, lang) {
  var tsHost = status.tailscaleIp || '100.x.y.z';
  var lanHost = status.lanIp || '127.0.0.1';
  var port = (typeof window !== 'undefined' && window.location.port) || '3080';

  return jsx.jsxs("div", {
    style: {
      background: "var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))",
      border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))",
      borderRadius: "12px",
      padding: "18px 20px"
    },
    children: [
      jsx.jsx("div", {
        style: {
          fontSize: "15px",
          fontWeight: "600",
          color: "var(--dsw-alias-label-primary, inherit)",
          marginBottom: "4px"
        },
        children: t("netCardTitle", lang)
      }),
      jsx.jsx("div", {
        style: {
          fontSize: "12px",
          color: "var(--dsw-alias-label-tertiary, #888)",
          marginBottom: "16px"
        },
        children: t("netCardDesc", lang)
      }),

      // 网络条目 1: Tailscale 虚拟私网
      jsx.jsxs("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))",
          marginBottom: "16px"
        },
        children: [
          jsx.jsxs("div", {
            style: { flex: 1, minWidth: "220px" },
            children: [
              jsx.jsxs("div", {
                style: { display: "flex", alignItems: "center", gap: "8px" },
                children: [
                  jsx.jsx("span", { style: { fontSize: "16px" }, children: "🔒" }),
                  jsx.jsx("span", { style: { fontSize: "14px", fontWeight: "700" }, children: t("tailscaleSectionTitle", lang) }),
                  status.tailscaleIp ? jsx.jsx("span", {
                    style: { fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: "600" },
                    children: lang === 'en' ? "Connected" : "已连接"
                  }) : jsx.jsx("span", {
                    style: { fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: "rgba(239,68,68,0.15)", color: "#ef4444", fontWeight: "600" },
                    children: lang === 'en' ? "Not Connected" : "未连接"
                  })
                ]
              }),
              status.tailscaleIp ? jsx.jsxs("div", {
                style: { fontSize: "13px", marginTop: "4px", fontFamily: "monospace", color: "var(--dsw-alias-brand-primary, #3b82f6)" },
                children: [
                  "http://" + tsHost + ":" + port,
                  jsx.jsx("button", {
                    type: "button",
                    onClick: function() { copyText("http://" + tsHost + ":" + port, t("copiedTip", lang)); },
                    style: { marginLeft: "8px", padding: "2px 6px", background: "transparent", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))", borderRadius: "4px", fontSize: "11px", cursor: "pointer", color: "var(--dsw-alias-label-secondary, inherit)" },
                    children: t("copyUrlBtn", lang)
                  })
                ]
              }) : jsx.jsx("div", {
                style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #888)", marginTop: "4px" },
                children: t("tailscaleGuide", lang)
              }),
              status.tailscaleIp ? jsx.jsx("div", {
                style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #888)", marginTop: "4px" },
                children: t("tailscaleBypassDesc", lang)
              }) : null
            ]
          }),
          // Tailscale 免密开关 (iOS 风格切换开关)
          status.tailscaleIp ? jsx.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: "8px" },
            children: [
              jsx.jsx("span", { style: { fontSize: "12px", color: status.allowTailscale ? "var(--dsw-alias-brand-primary, #3b82f6)" : "var(--dsw-alias-label-secondary, #888)", fontWeight: "600" }, children: status.allowTailscale ? t("directBypassOn", lang) : t("directBypassOff", lang) }),
              jsx.jsxs("label", {
                style: { position: "relative", display: "inline-block", width: "44px", height: "24px", cursor: "pointer", userSelect: "none" },
                children: [
                  jsx.jsx("input", {
                    type: "checkbox",
                    checked: !!status.allowTailscale,
                    onChange: toggleTailscale,
                    style: { opacity: 0, width: 0, height: 0, margin: 0 }
                  }),
                  jsx.jsx("span", {
                    style: {
                      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: status.allowTailscale ? "var(--dsw-alias-brand-primary, #3b82f6)" : "var(--dsw-alias-border-l2, rgba(128,128,128,0.3))",
                      transition: "background-color 0.25s ease",
                      borderRadius: "24px"
                    }
                  }),
                  jsx.jsx("span", {
                    style: {
                      position: "absolute", top: "3px", left: "3px", width: "18px", height: "18px",
                      backgroundColor: "#ffffff", borderRadius: "50%",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.25)",
                      transform: status.allowTailscale ? "translateX(20px)" : "translateX(0px)",
                      transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
                    }
                  })
                ]
              })
            ]
          }) : null
        ]
      }),

      // 网络条目 2: 局域网 Wi-Fi
      jsx.jsxs("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "10px"
        },
        children: [
          jsx.jsxs("div", {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px"
            },
            children: [
              jsx.jsxs("div", {
                style: { flex: 1, minWidth: "220px" },
                children: [
                  jsx.jsxs("div", {
                    style: { display: "flex", alignItems: "center", gap: "8px" },
                    children: [
                      jsx.jsx("span", { style: { fontSize: "16px" }, children: "🏠" }),
                      jsx.jsx("span", { style: { fontSize: "14px", fontWeight: "700" }, children: t("lanSectionTitle", lang) }),
                      jsx.jsx("span", {
                        style: { fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: "600" },
                        children: lang === 'en' ? "Ready" : "已就绪"
                      })
                    ]
                  }),
                  jsx.jsxs("div", {
                    style: { fontSize: "13px", marginTop: "4px", fontFamily: "monospace", color: "var(--dsw-alias-brand-primary, #3b82f6)" },
                    children: [
                      "http://" + lanHost + ":" + port,
                      jsx.jsx("button", {
                        type: "button",
                        onClick: function() { copyText("http://" + lanHost + ":" + port, t("copiedTip", lang)); },
                        style: { marginLeft: "8px", padding: "2px 6px", background: "transparent", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))", borderRadius: "4px", fontSize: "11px", cursor: "pointer", color: "var(--dsw-alias-label-secondary, inherit)" },
                        children: t("copyUrlBtn", lang)
                      })
                    ]
                  })
                ]
              }),

              // 局域网免密开关 (高危醒目警告开关)
              jsx.jsxs("div", {
                style: { display: "flex", alignItems: "center", gap: "8px" },
                children: [
                  jsx.jsx("span", {
                    style: {
                      fontSize: "12px",
                      color: status.allowLan ? "#ef4444" : "var(--dsw-alias-label-secondary, #888)",
                      fontWeight: status.allowLan ? "700" : "500",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px"
                    },
                    children: status.allowLan ? (lang === 'en' ? "🚨 LAN Bypass Enabled (HIGH RISK)" : "🚨 局域网免密已开启（高危状态）") : t("directBypassOff", lang)
                  }),
                  jsx.jsxs("label", {
                    style: { position: "relative", display: "inline-block", width: "44px", height: "24px", cursor: "pointer", userSelect: "none" },
                    children: [
                      jsx.jsx("input", {
                        type: "checkbox",
                        checked: !!status.allowLan,
                        onChange: toggleLan,
                        style: { opacity: 0, width: 0, height: 0, margin: 0 }
                      }),
                      jsx.jsx("span", {
                        style: {
                          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                          backgroundColor: status.allowLan ? "#ef4444" : "var(--dsw-alias-border-l2, rgba(128,128,128,0.3))",
                          boxShadow: status.allowLan ? "0 0 10px rgba(239, 68, 68, 0.45)" : "none",
                          transition: "all 0.25s ease",
                          borderRadius: "24px"
                        }
                      }),
                      jsx.jsx("span", {
                        style: {
                          position: "absolute", top: "3px", left: "3px", width: "18px", height: "18px",
                          backgroundColor: "#ffffff", borderRadius: "50%",
                          boxShadow: "0 2px 4px rgba(0, 0, 0, 0.25)",
                          transform: status.allowLan ? "translateX(20px)" : "translateX(0px)",
                          transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
                        }
                      })
                    ]
                  })
                ]
              })
            ]
          }),

          // 🚨 局域网免密高危醒目警示横幅 (Alert Callout Banner)
          jsx.jsxs("div", {
            style: {
              marginTop: "4px",
              padding: "10px 14px",
              borderRadius: "8px",
              background: status.allowLan ? "rgba(239, 68, 68, 0.12)" : "rgba(245, 158, 11, 0.08)",
              border: status.allowLan ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid rgba(245, 158, 11, 0.25)",
              borderLeft: status.allowLan ? "4px solid #ef4444" : "4px solid #f59e0b",
              boxShadow: status.allowLan ? "0 2px 8px rgba(239, 68, 68, 0.15)" : "none"
            },
            children: [
              jsx.jsxs("div", {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: "700",
                  color: status.allowLan ? "#ef4444" : "#f59e0b",
                  marginBottom: "4px"
                },
                children: [
                  jsx.jsx("span", { children: status.allowLan ? "🚨" : "⚠️" }),
                  jsx.jsx("span", { children: t("lanBypassWarningTitle", lang) })
                ]
              }),
              jsx.jsx("div", {
                style: {
                  fontSize: "12px",
                  lineHeight: "1.55",
                  color: status.allowLan ? "var(--dsw-alias-label-primary, #fca5a5)" : "var(--dsw-alias-label-secondary, #cbd5e1)"
                },
                children: t("lanBypassDesc", lang)
              })
            ]
          })
        ]
      })
    ]
  });
}
