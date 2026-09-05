import React from 'react';
import { formatTime } from '../utils/format.js';
import { t, formatDeviceName, formatAuthType } from '../i18n.js';

function isCurrentLocalIp(ip, status) {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (status && status.lanIp && ip === status.lanIp) return true;
  if (status && status.tailscaleIp && ip === status.tailscaleIp) return true;
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.hostname &&
    ip === window.location.hostname
  )
    return true;
  return false;
}

/**
 * 卡片 4: 详细已授权设备列表 (支持中英文国际化)
 */
export function DeviceListCard({ status, revokeDevice, revokeAll, lang }) {
  return (
    <div
      style={{
        background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
        borderRadius: '12px',
        padding: '14px 14px',
      }}
    >
      {/* 头部：标题与一键注销按钮（自适应 flexWrap） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px 12px',
          marginBottom: '6px',
        }}
      >
        <div
          style={{
            fontSize: '15px',
            fontWeight: '600',
            color: 'var(--dsw-alias-label-primary, inherit)',
          }}
        >
          {`📱 ${t('deviceCardTitle', lang)} (${status.devicesCount}${
            lang === 'en' ? ' devices' : ' 台'
          })`}
        </div>

        {status.devicesCount > 0 ? (
          <button
            type="button"
            onClick={revokeAll}
            style={{
              background: 'transparent',
              border: '1px solid rgba(239,68,68,0.4)',
              color: 'var(--dsw-alias-label-error, #ef4444)',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              marginLeft: 'auto',
            }}
          >
            {t('revokeAllBtn', lang)}
          </button>
        ) : null}
      </div>

      {/* 说明文字通栏舒展展示，不再与按钮左右挤压 */}
      <div
        style={{
          fontSize: '12px',
          color: 'var(--dsw-alias-label-tertiary, #888)',
          lineHeight: '1.45',
          marginBottom: '14px',
        }}
      >
        {t('deviceCardDesc', lang)}
      </div>

      {/* 设备条目列表 */}
      {status.devices && status.devices.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {status.devices.map((dev) => {
            const isLocal = isCurrentLocalIp(dev.ip, status);
            const ipLabel = `${dev.ip}${isLocal ? (lang === 'en' ? ' (Local)' : ' (本机)') : ''}`;

            return (
              <div
                key={dev.token}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '12px 14px',
                  background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08))',
                  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))',
                  borderRadius: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: '600',
                      color: 'var(--dsw-alias-label-primary, inherit)',
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <span>{formatDeviceName(dev.deviceName, lang)}</span>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: dev.isBypass
                          ? 'rgba(16,185,129,0.15)'
                          : 'rgba(59,130,246,0.15)',
                        color: dev.isBypass ? '#10b981' : 'var(--dsw-alias-brand-primary, #3b82f6)',
                        fontWeight: 'normal',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatAuthType(dev.authType, lang)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--dsw-alias-label-tertiary, #888)',
                      lineHeight: '1.4',
                      wordBreak: 'break-word',
                    }}
                  >
                    {lang === 'en' ? 'IP: ' : '来源 IP: '}
                    {ipLabel}
                    {lang === 'en' ? ' · Authorized: ' : ' · 授权于 '}
                    {formatTime(dev.createdAt, lang)}
                    {lang === 'en' ? ' · Last seen: ' : ' · 最近活跃 '}
                    {formatTime(dev.lastSeenAt, lang)}
                  </div>
                </div>

                {!dev.isBypass ? (
                  <button
                    type="button"
                    onClick={() => revokeDevice(dev.token)}
                    style={{
                      padding: '5px 12px',
                      background: 'transparent',
                      border: '1px solid rgba(239,68,68,0.3)',
                      color: 'var(--dsw-alias-label-error, #ef4444)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {t('revokeDeviceBtn', lang)}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            textAlign: 'center',
            padding: '16px',
            color: 'var(--dsw-alias-label-tertiary, #888)',
            fontSize: '13px',
          }}
        >
          {t('noDevices', lang)}
        </div>
      )}
    </div>
  );
}
