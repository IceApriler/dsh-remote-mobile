/**
 * 全局页面层设备接入与安全预警 Toast 通知系统
 */

export function showGlobalDeviceToast(device, eventType) {
  if (typeof document === 'undefined') return;
  var toastId = 'dsh-global-device-toast';
  var existing = document.getElementById(toastId);
  if (existing) existing.remove();

  var isNewPair = eventType === 'device-connected';
  var bgGradient = isNewPair 
    ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95))'
    : 'linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.95))';
  var glowShadow = isNewPair 
    ? 'rgba(16, 185, 129, 0.3)' 
    : 'rgba(59, 130, 246, 0.3)';
  var icon = isNewPair ? '🎉' : '📶';
  var title = isNewPair ? '新设备已成功配对接入！' : '已授权设备已重新上线！';

  var toast = document.createElement('div');
  toast.id = toastId;
  toast.style.cssText = [
    'position: fixed',
    'top: 24px',
    'left: 50%',
    'transform: translateX(-50%)',
    'z-index: 9999999',
    'background: ' + bgGradient,
    'color: white',
    'border-radius: 14px',
    'padding: 14px 20px',
    'box-shadow: 0 16px 36px rgba(0, 0, 0, 0.35), 0 0 24px ' + glowShadow,
    'display: flex',
    'align-items: center',
    'gap: 14px',
    'min-width: 340px',
    'max-width: 90vw',
    'backdrop-filter: blur(12px)',
    '-webkit-backdrop-filter: blur(12px)',
    'border: 1px solid rgba(255, 255, 255, 0.25)',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'animation: dshToastIn 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
    'cursor: pointer'
  ].join(';');

  if (!document.getElementById('dsh-toast-anim-style')) {
    var style = document.createElement('style');
    style.id = 'dsh-toast-anim-style';
    style.textContent = '@keyframes dshToastIn { from { opacity: 0; transform: translate(-50%, -20px) scale(0.95); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } } @keyframes dshToastOut { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -20px); } }';
    document.head.appendChild(style);
  }

  toast.innerHTML = [
    '<div style="font-size: 26px; line-height: 1; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">' + icon + '</div>',
    '<div style="flex: 1; min-width: 0;">',
    '  <div style="font-size: 14px; font-weight: 700; margin-bottom: 2px; letter-spacing: 0.2px;">' + title + '</div>',
    '  <div style="font-size: 12px; opacity: 0.92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + (device.deviceName || '移动端设备') + ' · IP: ' + (device.ip || '未知') + '</div>',
    '</div>',
    '<button id="dsh-toast-close" style="background: transparent; border: none; color: white; opacity: 0.8; font-size: 16px; cursor: pointer; padding: 4px 6px; line-height: 1; border-radius: 4px;">✕</button>'
  ].join('');

  document.body.appendChild(toast);

  var timer = setTimeout(function() {
    if (toast && toast.parentElement) {
      toast.style.animation = 'dshToastOut 0.3s forwards';
      setTimeout(function() { if (toast.parentElement) toast.remove(); }, 300);
    }
  }, 6000);

  var closeBtn = toast.querySelector('#dsh-toast-close');
  if (closeBtn) {
    closeBtn.onclick = function(e) {
      e.stopPropagation();
      clearTimeout(timer);
      toast.remove();
    };
  }
}

export function showGlobalSecurityToast(alertData) {
  if (typeof document === 'undefined') return;
  var toastId = 'dsh-global-security-toast';
  var existing = document.getElementById(toastId);
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.id = toastId;
  toast.style.cssText = [
    'position: fixed',
    'top: 24px',
    'left: 50%',
    'transform: translateX(-50%)',
    'z-index: 9999999',
    'background: linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(185, 28, 28, 0.95))',
    'color: white',
    'border-radius: 14px',
    'padding: 14px 20px',
    'box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4), 0 0 24px rgba(239, 68, 68, 0.4)',
    'display: flex',
    'align-items: center',
    'gap: 14px',
    'min-width: 360px',
    'max-width: 90vw',
    'backdrop-filter: blur(12px)',
    '-webkit-backdrop-filter: blur(12px)',
    'border: 1px solid rgba(255, 255, 255, 0.3)',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'animation: dshToastIn 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
    'cursor: pointer'
  ].join(';');

  toast.innerHTML = [
    '<div style="font-size: 26px; line-height: 1; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">🚨</div>',
    '<div style="flex: 1; min-width: 0;">',
    '  <div style="font-size: 14px; font-weight: 700; margin-bottom: 2px; letter-spacing: 0.2px;">安全拦截预警</div>',
    '  <div style="font-size: 12px; opacity: 0.95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">IP ' + (alertData.ip || '未知') + ' ' + (alertData.reason || '已触发安全熔断锁定！') + '</div>',
    '</div>',
    '<button id="dsh-sec-toast-close" style="background: transparent; border: none; color: white; opacity: 0.8; font-size: 16px; cursor: pointer; padding: 4px 6px; line-height: 1; border-radius: 4px;">✕</button>'
  ].join('');

  document.body.appendChild(toast);

  var timer = setTimeout(function() {
    if (toast && toast.parentElement) {
      toast.style.animation = 'dshToastOut 0.3s forwards';
      setTimeout(function() { if (toast.parentElement) toast.remove(); }, 300);
    }
  }, 7000);

  var closeBtn = toast.querySelector('#dsh-sec-toast-close');
  if (closeBtn) {
    closeBtn.onclick = function(e) {
      e.stopPropagation();
      clearTimeout(timer);
      toast.remove();
    };
  }
}
