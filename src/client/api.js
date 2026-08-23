/**
 * 前端 API 交互层
 */

export function fetchStatus() {
  return fetch('/api/remote-mobile/status?_t=' + Date.now()).then(function(res) {
    return res.json();
  });
}

export function generatePairCode() {
  return fetch('/api/remote-mobile/generate-code', { method: 'POST' }).then(function(res) {
    return res.json();
  });
}

export function updateBypassConfig(allowTailscale, allowLan) {
  return fetch('/api/remote-mobile/update-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowTailscale: allowTailscale, allowLan: allowLan })
  }).then(function(res) {
    return res.json();
  });
}

export function updateAdvancedSecurityOptions(payload) {
  return fetch('/api/remote-mobile/update-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res) {
    return res.json();
  });
}

export function updateSecret(secret) {
  return fetch('/api/remote-mobile/set-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: secret })
  }).then(function(res) {
    return res.json();
  });
}

export function clearSecretApi() {
  return fetch('/api/remote-mobile/clear-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }).then(function(res) {
    return res.json();
  });
}

export function revokeDeviceApi(token) {
  return fetch('/api/remote-mobile/revoke-device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token })
  }).then(function(res) {
    return res.json();
  });
}

export function revokeAllDevicesApi() {
  return fetch('/api/remote-mobile/revoke-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }).then(function(res) {
    return res.json();
  });
}

export function unlockIpApi(ip) {
  return fetch('/api/remote-mobile/unlock-ip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip: ip })
  }).then(function(res) {
    return res.json();
  });
}

export function clearIpStatsApi() {
  return fetch('/api/remote-mobile/clear-ip-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }).then(function(res) {
    return res.json();
  });
}

export function fetchStyles() {
  return fetch('/api/remote-mobile/styles?_t=' + Date.now()).then(function(res) {
    return res.json();
  });
}

export function saveStyleSnippet(payload) {
  return fetch('/api/remote-mobile/styles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res) {
    return res.json();
  });
}

export function toggleStyleApi(id, scope, enabled) {
  return fetch('/api/remote-mobile/styles/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id, scope: scope, enabled: enabled })
  }).then(function(res) {
    return res.json();
  });
}

export function deleteStyleSnippetApi(id) {
  return fetch('/api/remote-mobile/styles/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  }).then(function(res) {
    return res.json();
  });
}

export function resetStylesApi() {
  return fetch('/api/remote-mobile/styles/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }).then(function(res) {
    return res.json();
  });
}
