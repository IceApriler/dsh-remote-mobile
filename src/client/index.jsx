import React from 'react';
import { TailscaleMobileSection } from './components/MainSection.jsx';
import { showGlobalDeviceToast, showGlobalSecurityToast } from './utils/toast.js';
import { resolveLocale } from './i18n.js';
import { RM_API_BASE } from './api.js';

/**
 * 【客户端 Cordis 服务依赖】只声明真实存在且确实使用的服务。
 *
 * 历史问题：这里曾写成 ["slots", "locale", "connection", "settingsScope", "remote"]。
 * 其中 `settingsScope` 与 `remote` 在 DSH 0.2.2（含 rc.3）的浏览器端运行时里根本不存在，
 * 而 Cordis 对数组形式的 inject 是「硬依赖」——只要有一个名字拿不到，整个客户端插件
 * 就永远停在 pending，设置面板（含扫码/设备管理）不会挂载，控制台只会留下一句
 * “pending (waiting for services: ...)”。`connection` 本插件也从未使用（服务端门禁
 * 走的是 HTTP API，不依赖浏览器侧的 WS 连接状态），一并去掉。
 *
 * 现仅保留两个核心 UI 服务：`slots`（插件 UI 挂载点，必需）与 `locale`（界面语言，
 * 缺省时 MainSection 内部还有中文兜底）。
 */
export const inject = ["slots", "locale"];

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
          var eventSource = new EventSource(RM_API_BASE + "events");
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
