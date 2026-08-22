/**
 * 卡片 7: 全局高级安全参数配置 (输入框 + 保存设置，支持中英文国际化)
 */
import { t } from '../i18n.js';

export function renderConfigCard(jsx, props) {
  var maxVisitsInput = props.maxVisitsInput;
  var setMaxVisitsInput = props.setMaxVisitsInput;
  var maxFailedInput = props.maxFailedInput;
  var setMaxFailedInput = props.setMaxFailedInput;
  var lockDurationMinsInput = props.lockDurationMinsInput;
  var setLockDurationMinsInput = props.setLockDurationMinsInput;
  var saveAdvancedConfig = props.saveAdvancedConfig;
  var resetAdvancedConfigDefaults = props.resetAdvancedConfigDefaults;
  var isSaving = props.isSaving;
  var lang = props.lang;

  return jsx.jsxs("div", {
    style: {
      background: "var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))",
      border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))",
      borderRadius: "12px",
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: "14px"
    },
    children: [
      // 头部标题与复制路径按钮
      jsx.jsxs("div", {
        style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" },
        children: [
          jsx.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: "8px" },
            children: [
              jsx.jsx("span", { style: { fontSize: "16px" }, children: "⚙️" }),
              jsx.jsx("span", {
                style: { fontSize: "15px", fontWeight: "600", color: "var(--dsw-alias-label-primary, inherit)" },
                children: t("configCardTitle", lang)
              })
            ]
          }),
          jsx.jsx("button", {
            type: "button",
            onClick: function() {
              navigator.clipboard.writeText("~/.dsh/settings.yaml").then(function() {
                alert((lang === 'en' ? "Copied settings path:\n~/.dsh/settings.yaml (namespace: dsh-remote-mobile)" : "已复制配置文件路径：\n~/.dsh/settings.yaml (命名空间: dsh-remote-mobile)"));
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
              whiteSpace: "nowrap",
              flexShrink: 0
            },
            children: t("copySettingsPathBtn", lang)
          })
        ]
      }),

      // 说明文本
      jsx.jsx("div", {
        style: {
          fontSize: "12px",
          color: "var(--dsw-alias-label-tertiary, #888)",
          lineHeight: "1.5"
        },
        children: t("configCardDesc", lang)
      }),

      // 3 个表单输入项 Grid
      jsx.jsxs("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px"
        },
        children: [
          // 字段 1: 单 IP 限频
          jsx.jsxs("div", {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))",
              border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))",
              borderRadius: "8px",
              padding: "10px 12px"
            },
            children: [
              jsx.jsx("label", {
                style: {
                  fontSize: "12px",
                  fontWeight: "600",
                  color: "var(--dsw-alias-label-primary, inherit)"
                },
                children: t("fieldVisitsLimit", lang)
              }),
              jsx.jsx("input", {
                type: "number",
                min: "1",
                max: "1000",
                value: maxVisitsInput,
                onChange: function(e) { setMaxVisitsInput(e.target.value); },
                placeholder: "60",
                style: {
                  height: "34px",
                  background: "var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.15))",
                  border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))",
                  borderRadius: "6px",
                  padding: "0 10px",
                  color: "inherit",
                  fontSize: "13px",
                  outline: "none"
                }
              }),
              jsx.jsx("span", {
                style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #888)" },
                children: t("fieldVisitsLimitHint", lang)
              })
            ]
          }),

          // 字段 2: 连续失败封锁阈值
          jsx.jsxs("div", {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))",
              border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))",
              borderRadius: "8px",
              padding: "10px 12px"
            },
            children: [
              jsx.jsx("label", {
                style: {
                  fontSize: "12px",
                  fontWeight: "600",
                  color: "var(--dsw-alias-label-primary, inherit)"
                },
                children: t("fieldFailedLimit", lang)
              }),
              jsx.jsx("input", {
                type: "number",
                min: "1",
                max: "100",
                value: maxFailedInput,
                onChange: function(e) { setMaxFailedInput(e.target.value); },
                placeholder: "5",
                style: {
                  height: "34px",
                  background: "var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.15))",
                  border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))",
                  borderRadius: "6px",
                  padding: "0 10px",
                  color: "inherit",
                  fontSize: "13px",
                  outline: "none"
                }
              }),
              jsx.jsx("span", {
                style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #888)" },
                children: t("fieldFailedLimitHint", lang)
              })
            ]
          }),

          // 字段 3: 封锁时长
          jsx.jsxs("div", {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))",
              border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))",
              borderRadius: "8px",
              padding: "10px 12px"
            },
            children: [
              jsx.jsx("label", {
                style: {
                  fontSize: "12px",
                  fontWeight: "600",
                  color: "var(--dsw-alias-label-primary, inherit)"
                },
                children: t("fieldLockDuration", lang)
              }),
              jsx.jsx("input", {
                type: "number",
                min: "1",
                max: "1440",
                value: lockDurationMinsInput,
                onChange: function(e) { setLockDurationMinsInput(e.target.value); },
                placeholder: "15",
                style: {
                  height: "34px",
                  background: "var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.15))",
                  border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))",
                  borderRadius: "6px",
                  padding: "0 10px",
                  color: "inherit",
                  fontSize: "13px",
                  outline: "none"
                }
              }),
              jsx.jsx("span", {
                style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #888)" },
                children: t("fieldLockDurationHint", lang)
              })
            ]
          })
        ]
      }),

      // 底部操作按钮栏
      jsx.jsxs("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "10px",
          marginTop: "4px"
        },
        children: [
          jsx.jsx("button", {
            type: "button",
            onClick: resetAdvancedConfigDefaults,
            disabled: isSaving,
            style: {
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))",
              color: "var(--dsw-alias-label-secondary, inherit)",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: isSaving ? "not-allowed" : "pointer",
              opacity: isSaving ? 0.6 : 1,
              whiteSpace: "nowrap"
            },
            children: t("restoreDefaultsBtn", lang)
          }),
          jsx.jsx("button", {
            type: "button",
            onClick: saveAdvancedConfig,
            disabled: isSaving,
            style: {
              padding: "6px 18px",
              background: "var(--dsw-alias-brand-primary, #3b82f6)",
              border: "none",
              color: "white",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: "600",
              cursor: isSaving ? "not-allowed" : "pointer",
              opacity: isSaving ? 0.7 : 1,
              whiteSpace: "nowrap"
            },
            children: isSaving ? t("savingConfigBtn", lang) : t("saveConfigBtn", lang)
          })
        ]
      })
    ]
  });
}
