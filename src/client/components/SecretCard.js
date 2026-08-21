/**
 * 卡片 3: 长期访问密码配置 (支持中英文国际化)
 */
import { t } from '../i18n.js';

export function renderSecretCard(jsx, params) {
  var status = params.status;
  var secretInput = params.secretInput;
  var setSecretInput = params.setSecretInput;
  var showSecret = params.showSecret;
  var setShowSecret = params.setShowSecret;
  var saveSecret = params.saveSecret;
  var clearSecret = params.clearSecret;
  var lang = params.lang;

  return jsx.jsxs("div", {
    style: {
      background: "var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))",
      border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))",
      borderRadius: "12px",
      padding: "18px 20px"
    },
    children: [
      // 注入样式强制隐藏浏览器原生密码眼睛
      jsx.jsx("style", {
        dangerouslySetInnerHTML: {
          __html: "input.dsh-secret-pwd-input::-ms-reveal, input.dsh-secret-pwd-input::-ms-clear, input.dsh-secret-pwd-input::-webkit-credentials-auto-fill-button, input.dsh-secret-pwd-input::-webkit-contacts-auto-fill-button { display: none !important; width: 0 !important; height: 0 !important; visibility: hidden !important; pointer-events: none !important; }"
        }
      }),

      jsx.jsxs("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "4px"
        },
        children: [
          jsx.jsx("div", {
            style: {
              fontSize: "15px",
              fontWeight: "600",
              color: "var(--dsw-alias-label-primary, inherit)"
            },
            children: t("secretCardTitle", lang)
          }),
          status.hasSecret ? jsx.jsx("span", {
            style: {
              fontSize: "12px",
              color: "#10b981",
              background: "rgba(16,185,129,0.12)",
              padding: "2px 8px",
              borderRadius: "12px",
              fontWeight: "500"
            },
            children: t("secretConfigured", lang)
          }) : jsx.jsx("span", {
            style: {
              fontSize: "12px",
              color: "var(--dsw-alias-label-tertiary, #888)"
            },
            children: t("secretNotConfigured", lang)
          })
        ]
      }),
      jsx.jsx("div", {
        style: {
          fontSize: "12px",
          color: "var(--dsw-alias-label-tertiary, #888)",
          marginBottom: "12px"
        },
        children: t("secretCardDesc", lang)
      }),
      jsx.jsxs("div", {
        style: { display: "flex", gap: "10px", alignItems: "center" },
        children: [
          jsx.jsxs("div", {
            style: {
              position: "relative",
              flex: 1,
              display: "flex",
              alignItems: "center"
            },
            children: [
              jsx.jsx("input", {
                className: "dsh-secret-pwd-input",
                type: showSecret ? "text" : "password",
                value: secretInput,
                placeholder: status.hasSecret ? (lang === 'en' ? "•••••••• (Password configured, enter new to update)" : "•••••••• (已配置有效密码，输入新密码可覆盖更新)") : t("secretInputPlaceholder", lang),
                onChange: function(e) { setSecretInput(e.target.value); },
                style: {
                  width: "100%",
                  height: "38px",
                  background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.1))",
                  border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))",
                  borderRadius: "8px",
                  padding: "0 38px 0 12px",
                  color: "inherit",
                  fontSize: "14px",
                  outline: "none"
                }
              }),
              jsx.jsx("button", {
                type: "button",
                onClick: function() { setShowSecret(!showSecret); },
                title: showSecret ? t("hidePassword", lang) : t("showPassword", lang),
                style: {
                  position: "absolute",
                  right: "8px",
                  background: "transparent",
                  border: "none",
                  color: "var(--dsw-alias-label-secondary, #888)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "4px"
                },
                children: showSecret ? jsx.jsx("svg", {
                  style: { width: "18px", height: "18px", fill: "currentColor" },
                  viewBox: "0 0 24 24",
                  children: jsx.jsx("path", {
                    d: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                  })
                }) : jsx.jsx("svg", {
                  style: { width: "18px", height: "18px", fill: "currentColor" },
                  viewBox: "0 0 24 24",
                  children: jsx.jsx("path", {
                    d: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
                  })
                })
              })
            ]
          }),
          jsx.jsx("button", {
            type: "button",
            onClick: saveSecret,
            style: {
              padding: "0 16px",
              height: "38px",
              background: "var(--dsw-alias-brand-primary, #3b82f6)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0
            },
            children: t("saveSecretBtn", lang)
          }),
          status.hasSecret ? jsx.jsx("button", {
            type: "button",
            onClick: clearSecret,
            title: t("clearSecretConfirm", lang),
            style: {
              padding: "0 12px",
              height: "38px",
              background: "rgba(239, 68, 68, 0.1)",
              color: "#ef4444",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "500",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0
            },
            children: t("clearSecretBtn", lang)
          }) : null
        ]
      })
    ]
  });
}
