/**
 * DSH 客户端前端插件主入口
 */
import { showGlobalDeviceToast, showGlobalSecurityToast } from './utils/toast.js';
import { createTailscaleMobileSection } from './components/MainSection.js';

export var inject = ["slots", "locale", "connection", "settingsScope", "remote"];

export function initPlugin(require, exports, module) {
  var React = require('react');
  var jsx = require('react/jsx-runtime');

  var TailscaleMobileSection = createTailscaleMobileSection(React, jsx);

  function apply(ctx) {
    if (typeof window !== "undefined") {
      window.__DSH_CLIENT_CTX__ = ctx;
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "viewport";
        document.head.appendChild(meta);
      }
      meta.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";

      // 全局长连接监听 (SSE 模式)：0 延时实时接收新设备配对/重新上线事件
      if (!window.__DSH_TAILSCALE_SSE_LISTENER__) {
        window.__DSH_TAILSCALE_SSE_LISTENER__ = true;
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
        } catch (e) {}
      }

      var slots = null;
      try {
        if (ctx && typeof ctx.get === "function") {
          slots = ctx.get("slots");
        } else if (ctx && ctx.slots) {
          slots = ctx.slots;
        }
      } catch (e) {}

      if (slots && typeof slots.register === "function") {
        try {
          slots.register({
            slot: "settingsScope",
            id: "tailscale-mobile-settings",
            order: 99,
            component: TailscaleMobileSection
          });
        } catch (e) {}
      }
    }
  }

  exports.apply = apply;
}
