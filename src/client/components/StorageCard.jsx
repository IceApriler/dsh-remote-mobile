import React from 'react';
import { t } from '../i18n.js';

/**
 * 卡片 6: 本地持久化存储位置说明 (支持中英文国际化，统一跨平台绝对路径与无弹窗复制体验)
 */
export function StorageCard({ status, lang, copyText }) {
  const handleCopy = (path, tip) => {
    if (!path) return;
    if (typeof copyText === 'function') {
      copyText(path, tip);
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(path).catch(() => {});
    }
  };

  const devicesPath = status.persistPath || '';
  const rsaPath = status.rsaKeyPath || '';
  const stylesPath = status.styleSnippetsPath || '';

  const items = [
    {
      icon: '📁',
      title: t('storageDeviceFile', lang),
      path: devicesPath,
      tip: lang === 'en' ? 'Devices storage path copied!' : '已成功复制设备存储文件路径！',
    },
    {
      icon: '🔑',
      title: t('storageRsaFile', lang),
      path: rsaPath,
      tip: lang === 'en' ? 'RSA key path copied!' : '已成功复制 RSA 密钥文件路径！',
    },
    {
      icon: '🎨',
      title: t('storageStylesFile', lang),
      path: stylesPath,
      tip: lang === 'en' ? 'Style snippets path copied!' : '已成功复制样式片段文件路径！',
    },
  ];

  return (
    <div
      style={{
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.04))',
        border: '1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        borderRadius: '10px',
        padding: '14px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {items.map((item, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            paddingTop: index > 0 ? '8px' : '0',
            borderTop: index > 0 ? '1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.15))' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: '18px', flexShrink: 0 }}>{item.icon}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: 'var(--dsw-alias-label-primary, inherit)',
                }}
              >
                {item.title}
              </div>
              <code
                style={{
                  fontSize: '11px',
                  color: 'var(--dsw-alias-brand-primary, #3b82f6)',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                }}
              >
                {item.path || '...'}
              </code>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleCopy(item.path, item.tip)}
            style={{
              padding: '4px 10px',
              background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.1))',
              border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
              color: 'var(--dsw-alias-label-secondary, inherit)',
              borderRadius: '6px',
              fontSize: '11px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t('copyUrlBtn', lang)}
          </button>
        </div>
      ))}
    </div>
  );
}

