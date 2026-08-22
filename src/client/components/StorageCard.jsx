import React from 'react';
import { t } from '../i18n.js';

/**
 * 卡片 6: 本地持久化存储位置说明 (支持中英文国际化)
 */
export function StorageCard({ status, lang }) {
  return (
    <div
      style={{
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.04))',
        border: '1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        borderRadius: '10px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* 条目 1: devices.json */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <span style={{ fontSize: '18px' }}>📁</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <div
              style={{
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--dsw-alias-label-primary, inherit)',
              }}
            >
              {t('storageDeviceFile', lang)}
            </div>
            <code
              style={{
                fontSize: '11px',
                color: 'var(--dsw-alias-brand-primary, #3b82f6)',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}
            >
              {status.persistPath || '~/.dsh/remote-mobile/devices.json'}
            </code>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            const p = status.persistPath || '~/.dsh/remote-mobile/devices.json';
            navigator.clipboard.writeText(p).then(() => {
              alert((lang === 'en' ? 'Copied path:\n' : '存储文件路径已复制到剪贴板！\n') + p);
            });
          }}
          style={{
            padding: '4px 10px',
            background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.1))',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            color: 'var(--dsw-alias-label-secondary, inherit)',
            borderRadius: '6px',
            fontSize: '11px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('copyUrlBtn', lang)}
        </button>
      </div>

      {/* 条目 2: rsa-keys.json */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          paddingTop: '8px',
          borderTop: '1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <span style={{ fontSize: '18px' }}>🔑</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <div
              style={{
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--dsw-alias-label-primary, inherit)',
              }}
            >
              {t('storageRsaFile', lang)}
            </div>
            <code
              style={{
                fontSize: '11px',
                color: 'var(--dsw-alias-brand-primary, #3b82f6)',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}
            >
              {status.rsaKeyPath || '~/.dsh/remote-mobile/rsa-keys.json'}
            </code>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            const p = status.rsaKeyPath || '~/.dsh/remote-mobile/rsa-keys.json';
            navigator.clipboard.writeText(p).then(() => {
              alert((lang === 'en' ? 'Copied RSA path:\n' : 'RSA 密钥文件路径已复制到剪贴板！\n') + p);
            });
          }}
          style={{
            padding: '4px 10px',
            background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.1))',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            color: 'var(--dsw-alias-label-secondary, inherit)',
            borderRadius: '6px',
            fontSize: '11px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('copyUrlBtn', lang)}
        </button>
      </div>
    </div>
  );
}
