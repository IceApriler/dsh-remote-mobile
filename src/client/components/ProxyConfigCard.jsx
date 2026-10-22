import React from 'react';
import { t } from '../i18n.js';

/**
 * 卡片 9: 接入代理配置。
 * 监听地址/端口/模式变更需要重启 DSH 才会重新绑定。
 */
export function ProxyConfigCard({
  status,
  modeInput,
  setModeInput,
  proxyPortInput,
  setProxyPortInput,
  proxyHostInput,
  setProxyHostInput,
  trustedHostsInput,
  setTrustedHostsInput,
  saveProxyConfig,
  resetProxyConfigDefaults,
  isSaving,
  lang,
}) {
  const isDirect = modeInput === 'direct';
  const fieldLabelStyle = {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--dsw-alias-label-primary, inherit)',
  };
  const fieldHintStyle = {
    fontSize: '11px',
    color: 'var(--dsw-alias-label-tertiary, #888)',
    lineHeight: 1.5,
  };
  const inputStyle = {
    height: '34px',
    background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.15))',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
    borderRadius: '6px',
    padding: '0 10px',
    color: 'inherit',
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
    width: '100%',
  };
  const fieldBoxStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))',
    borderRadius: '8px',
    padding: '10px 12px',
  };

  return (
    <div
      style={{
        background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
        borderRadius: '12px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px 12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🔌</span>
          <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--dsw-alias-label-primary, inherit)' }}>
            {t('proxyConfigCardTitle', lang)}
          </span>
        </div>
        <span
          style={{
            fontSize: '11px',
            color: 'var(--dsw-alias-label-tertiary, #888)',
            background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08))',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
            borderRadius: '999px',
            padding: '3px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {t('proxyCurrentRuntime', lang)}: {status?.proxy?.mode || '-'} / {status?.proxy?.activePort || '-'}
        </span>
      </div>

      <div style={{ fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)', lineHeight: 1.5 }}>
        {t('proxyConfigCardDesc', lang)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <div style={fieldBoxStyle}>
          <label style={fieldLabelStyle}>{t('proxyModeLabel', lang)}</label>
          <select
            value={modeInput}
            onChange={(e) => setModeInput(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="proxy">{t('proxyModeProxy', lang)}</option>
            <option value="direct">{t('proxyModeDirect', lang)}</option>
          </select>
          <span style={fieldHintStyle}>{t('proxyModeHint', lang)}</span>
        </div>

        <div style={fieldBoxStyle}>
          <label style={fieldLabelStyle}>{t('proxyPortLabel', lang)}</label>
          <input
            type="number"
            min="1"
            max="65535"
            value={proxyPortInput}
            onChange={(e) => setProxyPortInput(e.target.value)}
            disabled={isDirect}
            style={{ ...inputStyle, opacity: isDirect ? 0.55 : 1 }}
          />
          <span style={fieldHintStyle}>{t('proxyPortHint', lang)}</span>
        </div>

        <div style={fieldBoxStyle}>
          <label style={fieldLabelStyle}>{t('proxyHostLabel', lang)}</label>
          <input
            type="text"
            value={proxyHostInput}
            onChange={(e) => setProxyHostInput(e.target.value)}
            placeholder="0.0.0.0"
            disabled={isDirect}
            style={{ ...inputStyle, opacity: isDirect ? 0.55 : 1 }}
          />
          <span style={fieldHintStyle}>{t('proxyHostHint', lang)}</span>
        </div>
      </div>

      <div style={fieldBoxStyle}>
        <label style={fieldLabelStyle}>{t('proxyTrustedHostsLabel', lang)}</label>
        <textarea
          value={trustedHostsInput}
          onChange={(e) => setTrustedHostsInput(e.target.value)}
          placeholder={'xxx.tailnet.ts.net\ndsh.example.com'}
          rows={3}
          spellCheck={false}
          style={{
            ...inputStyle,
            height: 'auto',
            minHeight: '70px',
            padding: '8px 10px',
            resize: 'vertical',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
        <span style={fieldHintStyle}>{t('proxyTrustedHostsHint', lang)}</span>
      </div>

      <div style={{ fontSize: '11px', color: '#f59e0b', lineHeight: 1.5 }}>
        ⚠️ {t('proxyRestartNote', lang)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={resetProxyConfigDefaults}
          disabled={isSaving}
          style={{
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
            color: 'var(--dsw-alias-label-secondary, inherit)',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            opacity: isSaving ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {t('proxyResetBtn', lang)}
        </button>
        <button
          type="button"
          onClick={saveProxyConfig}
          disabled={isSaving}
          style={{
            padding: '6px 18px',
            background: '#2563eb',
            border: 'none',
            color: '#ffffff',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            opacity: isSaving ? 0.7 : 1,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
          }}
        >
          {isSaving ? t('proxySavingBtn', lang) : t('proxySaveBtn', lang)}
        </button>
      </div>
    </div>
  );
}
