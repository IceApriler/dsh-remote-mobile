import React from 'react';
import { formatCountdown } from '../utils/format.js';
import { t } from '../i18n.js';

/**
 * 卡片 2: 手机配对码与二维码 (支持中英文国际化)
 */
export function QrPairingCard({
  status,
  showCode,
  setShowCode,
  timeLeft,
  showQr,
  setShowQr,
  selectedTab,
  setSelectedTab,
  generateQrSvg,
  refreshStatusAndCode,
  copyDirectLink,
  lang,
}) {
  const port = (typeof window !== 'undefined' && window.location.port) || '3080';
  const isExpired = timeLeft <= 0;
  const currentHost =
    selectedTab === 'lan' && status.lanIp
      ? status.lanIp
      : status.tailscaleIp ||
        status.lanIp ||
        (typeof window !== 'undefined' && window.location.hostname) ||
        '127.0.0.1';
  const directLink = `http://${currentHost}:${port}/auth?token=${status.code || ''}`;

  return (
    <div
      style={{
        background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
        borderRadius: '12px',
        padding: '14px 14px',
        textAlign: 'center',
      }}
    >
      {/* 头部标题 */}
      <div
        style={{
          fontSize: '15px',
          fontWeight: '600',
          marginBottom: '4px',
          color: 'var(--dsw-alias-label-primary, inherit)',
        }}
      >
        {`📱 ${t('shortCodeTitle', lang)}`}
      </div>
      <div
        style={{
          fontSize: '12px',
          color: 'var(--dsw-alias-label-tertiary, #888)',
          marginBottom: '14px',
        }}
      >
        {t('pairingCardDesc', lang)}
      </div>

      {/* 1. 二维码展示区（展开后显示） */}
      {showQr ? (
        <div
          style={{
            background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))',
            borderRadius: '10px',
            padding: '16px',
            maxWidth: '320px',
            margin: '0 auto 16px auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          {/* 二维码网络切换 Tabs */}
          <div
            style={{
              display: 'flex',
              width: '100%',
              background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.1))',
              padding: '3px',
              borderRadius: '8px',
            }}
          >
            {status.tailscaleIp ? (
              <button
                type="button"
                onClick={() => setSelectedTab('tailscale')}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  background:
                    selectedTab === 'tailscale'
                      ? 'var(--dsw-alias-brand-primary, #3b82f6)'
                      : 'transparent',
                  color:
                    selectedTab === 'tailscale'
                      ? '#ffffff'
                      : 'var(--dsw-alias-label-secondary, inherit)',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {`🚀 ${t('switchTailscaleTab', lang)}`}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setSelectedTab('lan')}
              style={{
                flex: 1,
                padding: '5px 8px',
                borderRadius: '6px',
                border: 'none',
                background:
                  selectedTab === 'lan'
                    ? 'var(--dsw-alias-brand-primary, #3b82f6)'
                    : 'transparent',
                color:
                  selectedTab === 'lan'
                    ? '#ffffff'
                    : 'var(--dsw-alias-label-secondary, inherit)',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {`🏠 ${t('switchLanTab', lang)}`}
            </button>
          </div>

          {/* 二维码本体 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              opacity: isExpired ? 0.3 : 1,
            }}
            dangerouslySetInnerHTML={{
              __html: generateQrSvg(directLink, 170),
            }}
          />

          {/* 直达链接地址预览（脱敏保护：配对码隐藏时显示 ••••••，显示配对码时显示真实 token） */}
          <div
            style={{
              width: '100%',
              padding: '6px 10px',
              background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.12))',
              border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '11px',
              color: isExpired
                ? 'var(--dsw-alias-label-error, #ef4444)'
                : 'var(--dsw-alias-label-secondary, inherit)',
              wordBreak: 'break-all',
              userSelect: 'all',
              lineHeight: '1.4',
              textAlign: 'center',
            }}
          >
            {`http://${currentHost}:${port}/auth?token=`}
            <span
              style={{
                fontWeight: '700',
                color: showCode ? 'var(--dsw-alias-brand-primary, #3b82f6)' : 'inherit',
                letterSpacing: showCode ? '1px' : '2px',
              }}
            >
              {showCode ? (status.code || '') : '••••••'}
            </span>
          </div>

          {/* 二维码下方：复制当前直达链接按钮 */}
          <button
            type="button"
            onClick={copyDirectLink}
            style={{
              padding: '6px 16px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
              transition: 'background-color 0.2s',
            }}
          >
            {status.copied
              ? `✅ ${lang === 'en' ? 'Copied!' : '已复制！'}`
              : t('copyDirectAuthLink', lang)}
          </button>
        </div>
      ) : null}

      {/* 2. 6 位配对码展示行 */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.1))',
          border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
          borderRadius: '10px',
          padding: '6px 20px',
          margin: '4px auto 8px auto',
        }}
      >
        <span
          style={{
            fontSize: '32px',
            fontWeight: '800',
            letterSpacing: showCode ? '6px' : '4px',
            color: isExpired
              ? 'var(--dsw-alias-label-error, #ef4444)'
              : 'var(--dsw-alias-brand-primary, #3b82f6)',
            fontFamily: 'monospace',
            userSelect: 'all',
          }}
        >
          {isExpired ? (lang === 'en' ? 'EXPIRED' : '已过期') : showCode ? status.code : '••••••'}
        </span>

        {/* 眼睛显隐按钮 */}
        <button
          type="button"
          onClick={() => setShowCode(!showCode)}
          title={showCode ? t('clickToHide', lang) : t('clickToReveal', lang)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--dsw-alias-label-secondary, #888)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
          }}
        >
          {showCode ? (
            <svg style={{ width: '20px', height: '20px', fill: 'currentColor' }} viewBox="0 0 24 24">
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
            </svg>
          ) : (
            <svg style={{ width: '20px', height: '20px', fill: 'currentColor' }} viewBox="0 0 24 24">
              <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
            </svg>
          )}
        </button>
      </div>

      {/* 倒计时提示 */}
      <div
        style={{
          fontSize: '12px',
          color: isExpired
            ? 'var(--dsw-alias-label-error, #ef4444)'
            : 'var(--dsw-alias-label-secondary, #888)',
          margin: '4px 0 16px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isExpired ? '#ef4444' : '#10b981',
          }}
        />
        {isExpired
          ? `⚠️ ${t('codeExpired', lang)}`
          : `${t('codeValidUntil', lang)}${formatCountdown(timeLeft, lang)}`}
      </div>

      {/* 3. 底部操作按钮组 */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => setShowQr(!showQr)}
          style={{
            padding: '7px 16px',
            background: showQr
              ? 'rgba(59,130,246,0.15)'
              : 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.1))',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            color: showQr
              ? 'var(--dsw-alias-brand-primary, #3b82f6)'
              : 'var(--dsw-alias-label-primary, inherit)',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {showQr ? `📷 ${t('toggleQrHide', lang)}` : `📷 ${t('toggleQrShow', lang)}`}
        </button>
        <button
          type="button"
          onClick={refreshStatusAndCode}
          style={{
            padding: '7px 16px',
            background: 'rgba(59,130,246,0.12)',
            border: '1px solid rgba(59,130,246,0.3)',
            color: 'var(--dsw-alias-brand-primary, #3b82f6)',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {t('refreshCodeBtn', lang)}
        </button>
      </div>
    </div>
  );
}
