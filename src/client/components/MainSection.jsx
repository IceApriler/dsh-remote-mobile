import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchStatus,
  generatePairCode,
  updateBypassConfig,
  updateAdvancedSecurityOptions,
  updateSecret,
  clearSecretApi,
  revokeDeviceApi,
  revokeAllDevicesApi,
  unlockIpApi,
  clearIpStatsApi,
} from '../api.js';
import { generateQrSvg } from '../qrcode.js';
import { NetworkCard } from './NetworkCard.jsx';
import { QrPairingCard } from './QrPairingCard.jsx';
import { SecretCard } from './SecretCard.jsx';
import { DeviceListCard } from './DeviceListCard.jsx';
import { SecurityCard } from './SecurityCard.jsx';
import { StorageCard } from './StorageCard.jsx';
import { ConfigCard } from './ConfigCard.jsx';
import { StylesCard } from './StylesCard.jsx';
import { PLUGIN_VERSION, BUILD_TIME } from '../version.js';
import { t, resolveLocale } from '../i18n.js';

/**
 * 远程与移动端设置面板主组件 (TailscaleMobileSection，支持中英文国际化)
 */
export function TailscaleMobileSection(props) {
  const ctx =
    (props && props.ctx) ||
    (typeof window !== 'undefined' && window.__DSH_CLIENT_CTX__) ||
    null;

  const [status, setStatus] = useState({
    tailscaleIp: '',
    lanIp: '',
    code: '',
    expiresAt: 0,
    hasSecret: false,
    allowTailscale: false,
    allowLan: false,
    maxVisitsPerMinute: 60,
    maxFailedAttempts: 5,
    lockDurationMs: 900000,
    devicesCount: 0,
    devices: [],
    ipSecurityStats: [],
    copied: false,
    loading: true,
    persistPath: '',
    rsaKeyPath: '',
    styleSnippetsPath: '',
    locale: 'zh',
  });

  const [secretInput, setSecretInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [selectedTab, setSelectedTab] = useState('lan');
  const [timeLeft, setTimeLeft] = useState(300);
  const [toast, setToast] = useState(null);
  const [maxVisitsInput, setMaxVisitsInput] = useState('60');
  const [maxFailedInput, setMaxFailedInput] = useState('5');
  const [lockDurationMinsInput, setLockDurationMinsInput] = useState('15');
  const [isSaving, setIsSaving] = useState(false);
  const [showVersionTip, setShowVersionTip] = useState(false);
  const [currentLang, setCurrentLang] = useState(resolveLocale(ctx, status));

  // 设置页页签分组（接入 / 设备与安全 / 存储与样式），localStorage 记忆上次位置
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem('dsh-rm-settings-tab');
      if (saved === 'access' || saved === 'devices' || saved === 'style' || saved === 'storage') return saved;
    } catch (e) {}
    return 'access';
  });
  const switchTab = (tab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem('dsh-rm-settings-tab', tab);
    } catch (e) {}
  };

  const refreshStatusOnly = useCallback(() => {
    fetchStatus()
      .then((data) => {
        if (data.tailscaleIp) {
          setSelectedTab('tailscale');
        }
        if (data.maxVisitsPerMinute) setMaxVisitsInput(String(data.maxVisitsPerMinute));
        if (data.maxFailedAttempts) setMaxFailedInput(String(data.maxFailedAttempts));
        if (data.lockDurationMs)
          setLockDurationMinsInput(String(Math.round(data.lockDurationMs / 60000)));
        if (data.locale) {
          setCurrentLang(resolveLocale(ctx, data));
        }

        setStatus((prev) => ({
          ...prev,
          tailscaleIp: data.tailscaleIp || '',
          lanIp: data.lanIp || '',
          hasSecret: data.hasSecret,
          allowTailscale: data.allowTailscale,
          allowLan: data.allowLan,
          maxVisitsPerMinute: data.maxVisitsPerMinute || 60,
          maxFailedAttempts: data.maxFailedAttempts || 5,
          lockDurationMs: data.lockDurationMs || 900000,
          devicesCount: data.devicesCount || 0,
          devices: data.devices || [],
          ipSecurityStats: data.ipSecurityStats || [],
          persistPath: data.persistPath || '',
          rsaKeyPath: data.rsaKeyPath || '',
          styleSnippetsPath: data.styleSnippetsPath || '',
          locale: data.locale || 'zh',
          loading: false,
        }));
      })
      .catch(() => {});
  }, [ctx]);

  const refreshStatusAndCode = useCallback(() => {
    refreshStatusOnly();

    generatePairCode()
      .then((data) => {
        if (data.success) {
          setStatus((prev) => ({
            ...prev,
            code: data.code,
            expiresAt: data.expiresAt,
          }));
          const remain = Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000));
          setTimeLeft(remain);
        }
      })
      .catch(() => {});
  }, [refreshStatusOnly]);

  useEffect(() => {
    refreshStatusAndCode();

    // 监听 DSH locale 服务动态切换（注意：不能在此处提前 return，否则后续
    // dsh-device-updated 监听与 3 秒轮询都不会注册，导致实时刷新失效）
    const localeUnsubs = [];
    try {
      const loc = ctx && (typeof ctx.get === 'function' ? ctx.get('locale') : ctx.locale);
      if (loc && typeof loc.subscribe === 'function') {
        const unsub = loc.subscribe(() => {
          setCurrentLang(resolveLocale(ctx, status));
        });
        if (typeof unsub === 'function') localeUnsubs.push(unsub);
      }
    } catch (e) {}

    const handleDeviceUpdate = (e) => {
      if (!e || !e.detail) return;
      const detail = e.detail;

      // 1. IP 安全审计即时更新
      if (detail.stats && Array.isArray(detail.stats)) {
        setStatus((prev) => ({ ...prev, ipSecurityStats: detail.stats }));
      }

      // 2. 设备连接/上线即时乐观更新
      if (detail.device) {
        const dev = detail.device;
        setStatus((prev) => {
          const prevList = prev.devices || [];
          const nextList = [dev].concat(prevList.filter((d) => d.token !== dev.token));
          return {
            ...prev,
            devicesCount: nextList.length,
            devices: nextList,
          };
        });

        const msg =
          detail.type === 'device-connected'
            ? t('toastDeviceConnected', currentLang, {
                name: dev.deviceName || 'Device',
                ip: dev.ip,
              })
            : t('toastDeviceOnline', currentLang, {
                name: dev.deviceName || 'Device',
                ip: dev.ip,
              });
        setToast({ message: msg, type: 'info' });
        setTimeout(() => setToast(null), 4000);
      }

      // 3. 设备注销即时移除
      if (detail.type === 'device-revoked') {
        setStatus((prev) => {
          const prevList = prev.devices || [];
          const nextList = detail.all
            ? []
            : prevList.filter((d) => d.token !== detail.token);
          return {
            ...prev,
            devicesCount: nextList.length,
            devices: nextList,
          };
        });
      }

      // 4. 安全告警即时弹窗
      if (detail.type === 'ip-security-alert') {
        const alertMsg = t('toastIpLocked', currentLang, { ip: detail.ip });
        setToast({ message: alertMsg, type: 'danger' });
        setTimeout(() => setToast(null), 5000);
      }

      // 5. 触发后台全量校准
      refreshStatusOnly();
    };
    window.addEventListener('dsh-device-updated', handleDeviceUpdate);

    // 面板打开时的 3 秒定时自动探针（双保险极速实时同步）
    const pollTimer = setInterval(() => {
      refreshStatusOnly();
    }, 3000);

    return () => {
      clearInterval(pollTimer);
      window.removeEventListener('dsh-device-updated', handleDeviceUpdate);
      for (let i = 0; i < localeUnsubs.length; i++) {
        localeUnsubs[i]();
      }
    };
  }, [refreshStatusAndCode, refreshStatusOnly, currentLang, ctx]);

  // 倒计时
  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // 交互逻辑
  const toggleTailscale = () => {
    const nextVal = !status.allowTailscale;
    updateBypassConfig(nextVal, status.allowLan).then(() => {
      setStatus((prev) => ({ ...prev, allowTailscale: nextVal }));
    });
  };

  const toggleLan = () => {
    const nextVal = !status.allowLan;
    if (nextVal) {
      const warnMsg = t('lanBypassConfirm', currentLang);
      if (!confirm(warnMsg)) return;
    }
    updateBypassConfig(status.allowTailscale, nextVal).then(() => {
      setStatus((prev) => ({ ...prev, allowLan: nextVal }));
    });
  };

  const saveSecret = () => {
    const trimmed = (secretInput || '').trim();
    if (!trimmed) {
      alert(t('secretInputPlaceholder', currentLang));
      return;
    }
    const hasLetter = /[a-zA-Z]/.test(trimmed);
    const hasNumber = /[0-9]/.test(trimmed);
    if (trimmed.length < 6 || !hasLetter || !hasNumber) {
      alert(t('secretWeakTip', currentLang));
      return;
    }
    updateSecret(trimmed).then((data) => {
      if (data.success) {
        setStatus((prev) => ({ ...prev, hasSecret: true }));
        setSecretInput('');
        setToast({
          message:
            currentLang === 'en'
              ? 'Persistent password saved!'
              : '长期访问密码已成功保存并启用！',
          type: 'success',
        });
        setTimeout(() => setToast(null), 3000);
      } else {
        alert((currentLang === 'en' ? 'Save failed: ' : '保存失败：') + (data.reason || ''));
      }
    });
  };

  const clearSecret = () => {
    if (confirm(t('clearSecretConfirm', currentLang))) {
      clearSecretApi().then(() => {
        setStatus((prev) => ({ ...prev, hasSecret: false }));
        setSecretInput('');
        setToast({
          message: currentLang === 'en' ? 'Password cleared!' : '已成功清除长期访问密码！',
          type: 'info',
        });
        setTimeout(() => setToast(null), 3000);
      });
    }
  };

  const revokeDevice = (token) => {
    if (confirm(t('revokeDeviceConfirm', currentLang))) {
      revokeDeviceApi(token).then(() => {
        refreshStatusAndCode();
        setToast({
          message: currentLang === 'en' ? 'Device disconnected!' : '已成功踢出该设备！',
          type: 'info',
        });
        setTimeout(() => setToast(null), 2500);
      });
    }
  };

  const revokeAll = () => {
    if (confirm(t('revokeAllConfirm', currentLang))) {
      revokeAllDevicesApi().then(() => {
        refreshStatusAndCode();
        setToast({
          message:
            currentLang === 'en'
              ? 'All devices disconnected!'
              : '已成功注销并踢下线所有设备！',
          type: 'info',
        });
        setTimeout(() => setToast(null), 2500);
      });
    }
  };

  const unlockIp = (ip) => {
    if (confirm(t('unlockIpConfirm', currentLang, { ip }))) {
      unlockIpApi(ip)
        .then(() => {
          refreshStatusAndCode();
          setToast({
            message:
              currentLang === 'en'
                ? `IP ${ip} unlocked!`
                : `已成功为 IP ${ip} 解除锁定！`,
            type: 'success',
          });
          setTimeout(() => setToast(null), 3000);
        })
        .catch(() => {});
    }
  };

  const clearIpStats = () => {
    if (confirm(t('clearSecurityLogConfirm', currentLang))) {
      clearIpStatsApi()
        .then(() => {
          refreshStatusAndCode();
          setToast({
            message:
              currentLang === 'en'
                ? 'Audit logs cleared!'
                : '已成功清空所有安全审计日志！',
            type: 'success',
          });
          setTimeout(() => setToast(null), 2500);
        })
        .catch(() => {});
    }
  };

  const saveAdvancedConfig = () => {
    const visits = parseInt(maxVisitsInput, 10);
    const failed = parseInt(maxFailedInput, 10);
    const mins = parseInt(lockDurationMinsInput, 10);

    if (isNaN(visits) || visits <= 0 || isNaN(failed) || failed <= 0 || isNaN(mins) || mins <= 0) {
      alert(t('saveConfigFailTip', currentLang));
      return;
    }

    if (!confirm(t('saveConfigConfirm', currentLang))) {
      return;
    }

    setIsSaving(true);
    updateAdvancedSecurityOptions({
      maxVisitsPerMinute: visits,
      maxFailedAttempts: failed,
      lockDurationMs: mins * 60 * 1000,
    })
      .then((data) => {
        setIsSaving(false);
        if (data.success) {
          refreshStatusAndCode();
          setToast({ message: t('saveConfigSuccessToast', currentLang), type: 'success' });
          setTimeout(() => setToast(null), 3000);
        } else {
          alert((currentLang === 'en' ? 'Save failed: ' : '保存失败：') + (data.reason || ''));
        }
      })
      .catch(() => {
        setIsSaving(false);
        alert(currentLang === 'en' ? 'Network request failed, please try again.' : '网络请求失败，请稍后重试');
      });
  };

  const resetAdvancedConfigDefaults = () => {
    if (!confirm(t('restoreDefaultsConfirm', currentLang))) {
      return;
    }

    setMaxVisitsInput('60');
    setMaxFailedInput('5');
    setLockDurationMinsInput('15');

    setIsSaving(true);
    updateAdvancedSecurityOptions({
      maxVisitsPerMinute: 60,
      maxFailedAttempts: 5,
      lockDurationMs: 15 * 60 * 1000,
    })
      .then((data) => {
        setIsSaving(false);
        if (data.success) {
          refreshStatusAndCode();
          setToast({ message: t('restoreDefaultsSuccessToast', currentLang), type: 'success' });
          setTimeout(() => setToast(null), 3000);
        } else {
          alert((currentLang === 'en' ? 'Reset failed: ' : '重置失败：') + (data.reason || ''));
        }
      })
      .catch(() => {
        setIsSaving(false);
        alert(currentLang === 'en' ? 'Network request failed, please try again.' : '网络请求失败，请稍后重试');
      });
  };

  const copyDirectLink = () => {
    if (timeLeft <= 0) {
      alert(t('codeExpired', currentLang));
      return;
    }
    const effectiveQrIp =
      selectedTab === 'tailscale' && status.tailscaleIp
        ? status.tailscaleIp
        : status.lanIp || '127.0.0.1';
    const port = (typeof window !== 'undefined' && window.location.port) || '3080';
    const directLink = `http://${effectiveQrIp}:${port}/auth?token=${status.code || ''}`;
    navigator.clipboard.writeText(directLink).then(() => {
      setStatus((prev) => ({ ...prev, copied: true }));
      setTimeout(() => {
        setStatus((prev) => ({ ...prev, copied: false }));
      }, 2000);
    });
  };

  const copyText = (text, successTip) => {
    navigator.clipboard.writeText(text).then(() => {
      setToast({
        message:
          successTip ||
          (currentLang === 'en' ? 'Copied to clipboard!' : '已成功复制到剪贴板！'),
        type: 'success',
      });
      setTimeout(() => setToast(null), 2500);
    });
  };

  return (
    <div
      style={{
        padding: '4px 8px',
        color: 'var(--dsw-alias-label-primary, inherit)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {/* 标题头部（左侧标题 + 右侧 GitHub 仓库链接） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '4px',
        }}
      >
        <div style={{ minWidth: '220px', flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              margin: '0 0 6px 0',
            }}
          >
            <h3
              style={{
                fontSize: '20px',
                fontWeight: '700',
                margin: 0,
                color: 'var(--dsw-alias-label-primary, inherit)',
              }}
            >
              {t('title', currentLang)}
            </h3>
            <div
              style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
              onMouseEnter={() => setShowVersionTip(true)}
              onMouseLeave={() => setShowVersionTip(false)}
              onClick={() => {
                setToast({
                  message: `📦 dsh-remote-mobile ${PLUGIN_VERSION} (${currentLang === 'en' ? 'Build: ' : '构建时间: '}${BUILD_TIME})`,
                  type: 'info',
                });
                setTimeout(() => setToast(null), 3000);
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 7px',
                  borderRadius: '10px',
                  background: 'rgba(59,130,246,0.15)',
                  color: 'var(--dsw-alias-brand-primary, #3b82f6)',
                  fontWeight: '600',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'all 0.2s ease',
                }}
              >
                {PLUGIN_VERSION}
              </span>

              {/* 鼠标悬停 0 延迟即时浮现的 Tooltip 气泡 */}
              {showVersionTip ? (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: '#0f172a',
                    color: '#f8fafc',
                    padding: '5px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: '500',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 8px 16px rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    zIndex: 9999,
                    pointerEvents: 'none',
                    lineHeight: '1.4',
                    textAlign: 'center',
                  }}
                >
                  {`${currentLang === 'en' ? 'Build: ' : '打包时间: '}${BUILD_TIME}`}
                </div>
              ) : null}
            </div>
          </div>
          <div
            style={{
              fontSize: '13px',
              color: 'var(--dsw-alias-label-tertiary, #888)',
            }}
          >
            {t('subtitle', currentLang)}
          </div>
        </div>

        {/* 右侧 GitHub 仓库直达徽标 */}
        <a
          href="https://github.com/IceApriler/dsh-remote-mobile"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.1))',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            borderRadius: '8px',
            color: 'var(--dsw-alias-label-secondary, inherit)',
            fontSize: '12px',
            fontWeight: '500',
            textDecoration: 'none',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }}
        >
          <svg style={{ width: '16px', height: '16px', fill: 'currentColor' }} viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          <span>dsh-remote-mobile</span>
        </a>
      </div>

      {/* 页签导航：接入 / 设备与安全 / 存储与样式（下划线风格） */}
      <div
        style={{
          display: 'flex',
          gap: '24px',
          borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2))',
          paddingBottom: '0',
          marginBottom: '6px',
        }}
      >
        {[
          { id: 'access', label: t('tabAccess', currentLang) },
          { id: 'devices', label: t('tabDevices', currentLang) },
          { id: 'style', label: t('tabStyle', currentLang) },
          { id: 'storage', label: t('tabStorage', currentLang) },
        ].map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => switchTab(item.id)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                padding: '8px 2px 10px 2px',
                fontSize: '14px',
                fontWeight: isActive ? '600' : '400',
                cursor: 'pointer',
                color: isActive
                  ? 'var(--dsw-alias-label-primary, #111827)'
                  : 'var(--dsw-alias-label-tertiary, #8c8c8c)',
                borderBottom: isActive
                  ? '2px solid var(--dsw-alias-label-primary, #111827)'
                  : '2px solid transparent',
                marginBottom: '-1px',
                transition: 'all 0.2s ease',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* 页签组 1：接入（网络 / 配对码 / 密码）——全部保持挂载，仅按 display 切换，避免状态重置 */}
      <div style={{ display: activeTab === 'access' ? 'flex' : 'none', flexDirection: 'column', gap: '16px' }}>
        <NetworkCard
          status={status}
          toggleTailscale={toggleTailscale}
          toggleLan={toggleLan}
          copyText={copyText}
          lang={currentLang}
        />
        <QrPairingCard
          status={status}
          showCode={showCode}
          setShowCode={setShowCode}
          timeLeft={timeLeft}
          showQr={showQr}
          setShowQr={setShowQr}
          selectedTab={selectedTab}
          setSelectedTab={setSelectedTab}
          generateQrSvg={generateQrSvg}
          refreshStatusAndCode={refreshStatusAndCode}
          copyDirectLink={copyDirectLink}
          lang={currentLang}
        />
        <SecretCard
          status={status}
          secretInput={secretInput}
          setSecretInput={setSecretInput}
          showSecret={showSecret}
          setShowSecret={setShowSecret}
          saveSecret={saveSecret}
          clearSecret={clearSecret}
          lang={currentLang}
        />
      </div>

      {/* 页签组 2：设备与安全（设备 / 审计 / 高级配置） */}
      <div style={{ display: activeTab === 'devices' ? 'flex' : 'none', flexDirection: 'column', gap: '16px' }}>
        <DeviceListCard
          status={status}
          revokeDevice={revokeDevice}
          revokeAll={revokeAll}
          lang={currentLang}
        />
        <SecurityCard
          status={status}
          unlockIp={unlockIp}
          clearIpStats={clearIpStats}
          lang={currentLang}
        />
        <ConfigCard
          maxVisitsInput={maxVisitsInput}
          setMaxVisitsInput={setMaxVisitsInput}
          maxFailedInput={maxFailedInput}
          setMaxFailedInput={setMaxFailedInput}
          lockDurationMinsInput={lockDurationMinsInput}
          setLockDurationMinsInput={setLockDurationMinsInput}
          saveAdvancedConfig={saveAdvancedConfig}
          resetAdvancedConfigDefaults={resetAdvancedConfigDefaults}
          isSaving={isSaving}
          lang={currentLang}
        />
      </div>

      {/* 页签组 3：样式覆写（样式片段） */}
      <div style={{ display: activeTab === 'style' ? 'flex' : 'none', flexDirection: 'column', gap: '16px' }}>
        <StylesCard lang={currentLang} />
      </div>

      {/* 页签组 4：本地数据（持久化存储与密钥说明） */}
      <div style={{ display: activeTab === 'storage' ? 'flex' : 'none', flexDirection: 'column', gap: '16px' }}>
        <StorageCard status={status} lang={currentLang} copyText={copyText} />
      </div>
    </div>
  );
}

// 兼容工厂函数创建形式
export function createTailscaleMobileSection() {
  return TailscaleMobileSection;
}
