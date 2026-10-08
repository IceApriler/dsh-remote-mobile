/**
 * 前端 API 交互层
 * 支持网关子路径 / baseURI 前缀自适应
 */

export const RM_API_BASE = (function () {
  try {
    if (typeof document !== 'undefined' && document.baseURI) {
      return new URL('api/remote-mobile/', document.baseURI).toString();
    }
    return '/api/remote-mobile/';
  } catch (e) {
    return '/api/remote-mobile/';
  }
})();

function safeFetchJson(url, options) {
  return fetch(url, options).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (text) {
        var msg = 'HTTP ' + res.status;
        try {
          var parsed = JSON.parse(text);
          if (parsed && (parsed.reason || parsed.message || parsed.error)) {
            msg = parsed.reason || parsed.message || parsed.error;
          }
        } catch (e) {}
        throw new Error(msg);
      });
    }
    return res.json().catch(function () {
      throw new Error('响应解析失败 (Invalid JSON response)');
    });
  });
}

export function fetchStatus() {
  return safeFetchJson(RM_API_BASE + 'status?_t=' + Date.now());
}

export function generatePairCode() {
  return safeFetchJson(RM_API_BASE + 'generate-code', { method: 'POST' });
}

export function updateBypassConfig(allowTailscale, allowLan) {
  return safeFetchJson(RM_API_BASE + 'update-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowTailscale: allowTailscale, allowLan: allowLan }),
  });
}

export function updateAdvancedSecurityOptions(payload) {
  return safeFetchJson(RM_API_BASE + 'update-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function updateSecret(secret) {
  return safeFetchJson(RM_API_BASE + 'set-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: secret }),
  });
}

export function clearSecretApi() {
  return safeFetchJson(RM_API_BASE + 'clear-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export function revokeDeviceApi(token) {
  return safeFetchJson(RM_API_BASE + 'revoke-device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token }),
  });
}

export function revokeAllDevicesApi() {
  return safeFetchJson(RM_API_BASE + 'revoke-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export function unlockIpApi(ip) {
  return safeFetchJson(RM_API_BASE + 'unlock-ip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip: ip }),
  });
}

export function clearIpStatsApi() {
  return safeFetchJson(RM_API_BASE + 'clear-ip-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export function fetchStyles() {
  return safeFetchJson(RM_API_BASE + 'styles?_t=' + Date.now());
}

export function saveStyleSnippet(payload) {
  return safeFetchJson(RM_API_BASE + 'styles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function toggleStyleApi(id, scope, enabled) {
  return safeFetchJson(RM_API_BASE + 'styles/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id, scope: scope, enabled: enabled }),
  });
}

export function deleteStyleSnippetApi(id) {
  return safeFetchJson(RM_API_BASE + 'styles/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id }),
  });
}

export function resetStylesApi() {
  return safeFetchJson(RM_API_BASE + 'styles/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}
