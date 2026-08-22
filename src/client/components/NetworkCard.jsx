import React from 'react';
import { t } from '../i18n.js';

/**
 * 卡片 1: 网络接入地址与免密直连管理 (支持中英文国际化与高危醒目警示)
 */
export function NetworkCard({ status, toggleTailscale, toggleLan, copyText, lang }) {
  const tsHost = status.tailscaleIp || '100.x.y.z';
  const lanHost = status.lanIp || '127.0.0.1';
  const port = (typeof window !== 'undefined' && window.location.port) || '3080';

  return (
    <div
      style={{
        background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
        borderRadius: '12px',
        padding: '18px 20px',
      }}
    >
      <div
        style={{
          fontSize: '15px',
          fontWeight: '600',
          color: 'var(--dsw-alias-label-primary, inherit)',
          marginBottom: '4px',
        }}
      >
        {t('netCardTitle', lang)}
      </div>
      <div
        style={{
          fontSize: '12px',
          color: 'var(--dsw-alias-label-tertiary, #888)',
          marginBottom: '16px',
        }}
      >
        {t('netCardDesc', lang)}
      </div>

      {/* 网络条目 1: Tailscale 虚拟私网 */}
      <div
        style={{
          paddingBottom: '16px',
          borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))',
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
        }}
      >
        {/* 左侧内容区：标题 + 徽标 + URL + 说明 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* 标题与状态徽标 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '16px', flexShrink: 0 }}>🔒</span>
            <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--dsw-alias-label-primary, inherit)' }}>
              {t('tailscaleSectionTitle', lang)}
            </span>
            {status.tailscaleIp ? (
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(16,185,129,0.15)',
                  color: '#10b981',
                  fontWeight: '600',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {lang === 'en' ? 'Connected' : '已连接'}
              </span>
            ) : (
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(239,68,68,0.15)',
                  color: '#ef4444',
                  fontWeight: '600',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {lang === 'en' ? 'Not Connected' : '未连接'}
              </span>
            )}
          </div>

          {/* 访问链接行 */}
          {status.tailscaleIp ? (
            <div
              style={{
                fontSize: '13px',
                fontFamily: 'monospace',
                color: 'var(--dsw-alias-brand-primary, #3b82f6)',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <span>{`http://${tsHost}:${port}`}</span>
              <button
                type="button"
                onClick={() => copyText(`http://${tsHost}:${port}`, t('copiedTip', lang))}
                style={{
                  padding: '2px 8px',
                  background: 'transparent',
                  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  color: 'var(--dsw-alias-label-secondary, inherit)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {t('copyUrlBtn', lang)}
              </button>
            </div>
          ) : (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--dsw-alias-label-tertiary, #888)',
                lineHeight: '1.4',
              }}
            >
              {t('tailscaleGuide', lang)}
            </div>
          )}

          {status.tailscaleIp ? (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--dsw-alias-label-tertiary, #888)',
                lineHeight: '1.4',
              }}
            >
              {t('tailscaleBypassDesc', lang)}
            </div>
          ) : null}
        </div>

        {/* 右侧：Tailscale 免密开关 (固定在右上角) */}
        {status.tailscaleIp ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, paddingTop: '2px' }}>
            <span
              style={{
                fontSize: '12px',
                color: status.allowTailscale
                  ? 'var(--dsw-alias-brand-primary, #3b82f6)'
                  : 'var(--dsw-alias-label-secondary, #888)',
                fontWeight: '600',
                whiteSpace: 'nowrap',
              }}
            >
              {status.allowTailscale ? t('directBypassOn', lang) : t('directBypassOff', lang)}
            </span>
            <label
              style={{
                position: 'relative',
                display: 'inline-block',
                width: '44px',
                height: '24px',
                cursor: 'pointer',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              <input
                type="checkbox"
                checked={!!status.allowTailscale}
                onChange={toggleTailscale}
                style={{ opacity: 0, width: 0, height: 0, margin: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: status.allowTailscale
                    ? 'var(--dsw-alias-brand-primary, #3b82f6)'
                    : 'var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
                  transition: 'background-color 0.25s ease',
                  borderRadius: '24px',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: '3px',
                  left: '3px',
                  width: '18px',
                  height: '18px',
                  backgroundColor: '#ffffff',
                  borderRadius: '50%',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.25)',
                  transform: status.allowTailscale ? 'translateX(20px)' : 'translateX(0px)',
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </label>
          </div>
        ) : null}
      </div>

      {/* 网络条目 2: 局域网 Wi-Fi */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* 顶部主体：左侧信息 + 右侧开关 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '16px',
          }}
        >
          {/* 左侧内容区：标题 + 徽标 + URL */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }}>🏠</span>
              <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--dsw-alias-label-primary, inherit)' }}>
                {t('lanSectionTitle', lang)}
              </span>
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(16,185,129,0.15)',
                  color: '#10b981',
                  fontWeight: '600',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {lang === 'en' ? 'Ready' : '已就绪'}
              </span>
            </div>

            {/* 访问链接行 */}
            <div
              style={{
                fontSize: '13px',
                fontFamily: 'monospace',
                color: 'var(--dsw-alias-brand-primary, #3b82f6)',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <span>{`http://${lanHost}:${port}`}</span>
              <button
                type="button"
                onClick={() => copyText(`http://${lanHost}:${port}`, t('copiedTip', lang))}
                style={{
                  padding: '2px 8px',
                  background: 'transparent',
                  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  color: 'var(--dsw-alias-label-secondary, inherit)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {t('copyUrlBtn', lang)}
              </button>
            </div>
          </div>

          {/* 右侧：局域网免密开关 (固定在右上角) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, paddingTop: '2px' }}>
            <span
              style={{
                fontSize: '12px',
                color: status.allowLan ? '#ef4444' : 'var(--dsw-alias-label-secondary, #888)',
                fontWeight: status.allowLan ? '700' : '500',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              {status.allowLan
                ? lang === 'en'
                  ? '🚨 LAN Bypass (High Risk)'
                  : '🚨 局域网免密（高危）'
                : t('directBypassOff', lang)}
            </span>
            <label
              style={{
                position: 'relative',
                display: 'inline-block',
                width: '44px',
                height: '24px',
                cursor: 'pointer',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              <input
                type="checkbox"
                checked={!!status.allowLan}
                onChange={toggleLan}
                style={{ opacity: 0, width: 0, height: 0, margin: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: status.allowLan
                    ? '#ef4444'
                    : 'var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
                  boxShadow: status.allowLan ? '0 0 10px rgba(239, 68, 68, 0.45)' : 'none',
                  transition: 'all 0.25s ease',
                  borderRadius: '24px',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: '3px',
                  left: '3px',
                  width: '18px',
                  height: '18px',
                  backgroundColor: '#ffffff',
                  borderRadius: '50%',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.25)',
                  transform: status.allowLan ? 'translateX(20px)' : 'translateX(0px)',
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </label>
          </div>
        </div>

        {/* 🚨 局域网免密高危醒目警示横幅 */}
        <div
          style={{
            marginTop: '4px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: status.allowLan ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.08)',
            border: status.allowLan
              ? '1px solid rgba(239, 68, 68, 0.4)'
              : '1px solid rgba(245, 158, 11, 0.25)',
            borderLeft: status.allowLan ? '4px solid #ef4444' : '4px solid #f59e0b',
            boxShadow: status.allowLan ? '0 2px 8px rgba(239, 68, 68, 0.15)' : 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: '700',
              color: status.allowLan ? '#ef4444' : '#f59e0b',
              marginBottom: '4px',
            }}
          >
            <span>{status.allowLan ? '🚨' : '⚠️'}</span>
            <span>{t('lanBypassWarningTitle', lang)}</span>
          </div>
          <div
            style={{
              fontSize: '12px',
              lineHeight: '1.55',
              color: status.allowLan
                ? 'var(--dsw-alias-label-primary, #fca5a5)'
                : 'var(--dsw-alias-label-secondary, #cbd5e1)',
            }}
          >
            {t('lanBypassDesc', lang)}
          </div>
        </div>
      </div>
    </div>
  );
}
