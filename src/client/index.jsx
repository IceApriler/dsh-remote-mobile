import React from 'react';
import { TailscaleMobileSection } from './components/MainSection.jsx';
import { showGlobalDeviceToast, showGlobalSecurityToast } from './utils/toast.js';
import { resolveLocale } from './i18n.js';

export const inject = ["slots", "locale", "connection", "settingsScope", "remote"];

export function apply(ctx) {
  if (typeof window !== "undefined") {
    window.__DSH_CLIENT_CTX__ = ctx;
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.appendChild(meta);
    }
    meta.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";

    // 全局长连接监听 (SSE 模式)：0 延时实时接收新设备配对/重新上线/IP审计事件，带自动重连
    if (!window.__DSH_REMOTE_MOBILE_SSE_LISTENER__) {
      window.__DSH_REMOTE_MOBILE_SSE_LISTENER__ = true;
      var initSse = function() {
        try {
          var eventSource = new EventSource("/api/remote-mobile/events");
          eventSource.onmessage = function(event) {
            try {
              var data = JSON.parse(event.data || "{}");
              if (data.type === "device-connected" && data.device) {
                showGlobalDeviceToast(data.device, "device-connected");
                window.dispatchEvent(new CustomEvent("dsh-device-updated", { detail: data }));
              } else if (data.type === "device-online" && data.device) {
                showGlobalDeviceToast(data.device, "device-online");
                window.dispatchEvent(new CustomEvent("dsh-device-updated", { detail: data }));
              } else if (data.type === "device-revoked") {
                window.dispatchEvent(new CustomEvent("dsh-device-updated", { detail: data }));
              } else if (data.type === "ip-security-alert") {
                showGlobalSecurityToast(data);
                window.dispatchEvent(new CustomEvent("dsh-device-updated", { detail: data }));
              } else if (data.type === "ip-security-updated") {
                window.dispatchEvent(new CustomEvent("dsh-device-updated", { detail: data }));
              }
            } catch (e) {}
          };
          eventSource.onerror = function() {
            try { eventSource.close(); } catch (e) {}
            setTimeout(initSse, 3000);
          };
        } catch (e) {
          setTimeout(initSse, 5000);
        }
      };
      initSse();
    }

    var slots = null;
    try {
      if (ctx && typeof ctx.get === "function") {
        slots = ctx.get("slots");
      } else if (ctx && ctx.slots) {
        slots = ctx.slots;
      }
    } catch (e) {}

    if (slots && typeof slots.inject === "function") {
      try {
        slots.inject("settings.section", function() {
          var unregister = slots.register({
            name: "settings.section",
            id: "tailscale-mobile",
            order: 150,
            label: function() {
              var lang = resolveLocale(ctx);
              return lang === "en" ? "Remote & Mobile" : "远程与移动端";
            }
          }, TailscaleMobileSection);
          return function() {
            if (typeof unregister === "function") unregister();
          };
        });
      } catch (e) {}
    }
  }
}

export { TailscaleMobileSection };
export default apply;
