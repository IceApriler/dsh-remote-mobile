#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, '..')

const clientDir = resolve(rootDir, 'src/client')
const outClientJs = resolve(rootDir, 'lib/client.js')
const outClientDts = resolve(rootDir, 'lib/client.d.ts')

// 确保目标 lib 目录存在
mkdirSync(dirname(outClientJs), { recursive: true })

function stripImportsAndExports(code) {
  return code
    .replace(/^import\s+[\s\S]*?;\s*$/gm, '')
    .replace(/^export\s+(?:default\s+)?(?:var|let|const|function|async function|class)?\s*/gm, (match) => {
      if (match.includes('default')) return '';
      return match.replace(/^export\s+/, '');
    })
}

// 读取 package.json 获取最新版本号
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'))
const pluginVersion = `v${pkg.version || '1.0.0'}`

const versionCode = `var PLUGIN_VERSION = ${JSON.stringify(pluginVersion)};`
const i18nCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'i18n.js'), 'utf8'))
const qrcodeCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'qrcode.js'), 'utf8'))
const formatCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'utils/format.js'), 'utf8'))
const toastCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'utils/toast.js'), 'utf8'))
const apiCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'api.js'), 'utf8'))
const networkCardCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'components/NetworkCard.js'), 'utf8'))
const qrPairingCardCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'components/QrPairingCard.js'), 'utf8'))
const secretCardCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'components/SecretCard.js'), 'utf8'))
const deviceListCardCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'components/DeviceListCard.js'), 'utf8'))
const securityCardCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'components/SecurityCard.js'), 'utf8'))
const storageCardCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'components/StorageCard.js'), 'utf8'))
const configCardCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'components/ConfigCard.js'), 'utf8'))
const mainSectionCode = stripImportsAndExports(readFileSync(resolve(clientDir, 'components/MainSection.js'), 'utf8'))

const bundleContent = `/**
 * dsh-remote-mobile 客户端运行时 Bundle
 * 由 scripts/build-client.js 自动化打包生成，请勿直接手动修改此文件！
 * 源码请移步 src/client/ 目录进行模块化开发与维护。
 */
window.__ModuleLoader__.load({
  id: "dsh-remote-mobile",
  factory: function(require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var jsx = require("react/jsx-runtime");

    // --- 0. 版本号 ---
    ${versionCode}

    // --- 1. 国际化多语言引擎 ---
${i18nCode}

    // --- 1. 二维码生成引擎 ---
${qrcodeCode}

    // --- 2. 格式化工具 ---
${formatCode}

    // --- 3. 全局 Toast 提示 ---
${toastCode}

    // --- 4. API 交互 ---
${apiCode}

    // --- 5. 独立卡片组件 ---
${networkCardCode}
${qrPairingCardCode}
${secretCardCode}
${deviceListCardCode}
${securityCardCode}
${storageCardCode}
${configCardCode}

    // --- 6. 主面板容器 ---
${mainSectionCode}

    var TailscaleMobileSection = createTailscaleMobileSection(React, jsx);

    // --- 7. 插件入口与生命周期 ---
    var inject = ["slots", "locale", "connection", "settingsScope", "remote"];

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

    exports.default = apply;
    exports.apply = apply;
    exports.inject = inject;
    exports.TailscaleMobileSection = TailscaleMobileSection;

    return module.exports;
  }
});
`

writeFileSync(outClientJs, bundleContent, 'utf8')
console.log('✅ [build-client] 成功从 src/client/ 各模块组装构建 ModuleLoader Bundle -> lib/client.js')

// 输出 client.d.ts 类型声明
const dtsContent = `declare const _default: (ctx: any) => void;
export default _default;
export declare const inject: string[];
export declare function apply(ctx: any): void;
export declare function TailscaleMobileSection(props: any): any;
`
writeFileSync(outClientDts, dtsContent, 'utf8')
