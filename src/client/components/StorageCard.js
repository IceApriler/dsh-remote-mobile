/**
 * 卡片 6: 本地持久化存储位置说明 (支持中英文国际化)
 */
import { t } from '../i18n.js';

export function renderStorageCard(jsx, status, lang) {
  return jsx.jsxs("div", {
    style: {
      background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.04))",
      border: "1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.2))",
      borderRadius: "10px",
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: "10px"
    },
    children: [
      // 条目 1: devices.json
      jsx.jsxs("div", {
        style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
        children: [
          jsx.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
            children: [
              jsx.jsx("span", { style: { fontSize: "18px" }, children: "📁" }),
              jsx.jsxs("div", {
                style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
                children: [
                  jsx.jsx("div", {
                    style: {
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "var(--dsw-alias-label-primary, inherit)"
                    },
                    children: t("storageDeviceFile", lang)
                  }),
                  jsx.jsx("code", {
                    style: {
                      fontSize: "11px",
                      color: "var(--dsw-alias-brand-primary, #3b82f6)",
                      fontFamily: "monospace",
                      wordBreak: "break-all"
                    },
                    children: status.persistPath || "~/.dsh/remote-mobile/devices.json"
                  })
                ]
              })
            ]
          }),
          jsx.jsx("button", {
            type: "button",
            onClick: function() {
              var p = status.persistPath || "~/.dsh/remote-mobile/devices.json";
              navigator.clipboard.writeText(p).then(function() {
                alert((lang === 'en' ? "Copied path:\n" : "存储文件路径已复制到剪贴板！\n") + p);
              });
            },
            style: {
              padding: "4px 10px",
              background: "var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.1))",
              border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))",
              color: "var(--dsw-alias-label-secondary, inherit)",
              borderRadius: "6px",
              fontSize: "11px",
              cursor: "pointer",
              whiteSpace: "nowrap"
            },
            children: t("copyUrlBtn", lang)
          })
        ]
      }),

      // 条目 2: rsa-keys.json
      jsx.jsxs("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          paddingTop: "8px",
          borderTop: "1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.15))"
        },
        children: [
          jsx.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
            children: [
              jsx.jsx("span", { style: { fontSize: "18px" }, children: "🔑" }),
              jsx.jsxs("div", {
                style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
                children: [
                  jsx.jsx("div", {
                    style: {
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "var(--dsw-alias-label-primary, inherit)"
                    },
                    children: t("storageRsaFile", lang)
                  }),
                  jsx.jsx("code", {
                    style: {
                      fontSize: "11px",
                      color: "var(--dsw-alias-brand-primary, #3b82f6)",
                      fontFamily: "monospace",
                      wordBreak: "break-all"
                    },
                    children: status.rsaKeyPath || "~/.dsh/remote-mobile/rsa-keys.json"
                  })
                ]
              })
            ]
          }),
          jsx.jsx("button", {
            type: "button",
            onClick: function() {
              var p = status.rsaKeyPath || "~/.dsh/remote-mobile/rsa-keys.json";
              navigator.clipboard.writeText(p).then(function() {
                alert((lang === 'en' ? "Copied RSA path:\n" : "RSA 密钥文件路径已复制到剪贴板！\n") + p);
              });
            },
            style: {
              padding: "4px 10px",
              background: "var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.1))",
              border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))",
              color: "var(--dsw-alias-label-secondary, inherit)",
              borderRadius: "6px",
              fontSize: "11px",
              cursor: "pointer",
              whiteSpace: "nowrap"
            },
            children: t("copyUrlBtn", lang)
          })
        ]
      })
    ]
  });
}
