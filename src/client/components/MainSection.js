/**
 * 远程与移动端设置面板主组件 (TailscaleMobileSection，支持中英文国际化)
 */
import { fetchStatus, generatePairCode, updateBypassConfig, updateAdvancedSecurityOptions, updateSecret, clearSecretApi, revokeDeviceApi, revokeAllDevicesApi, unlockIpApi, clearIpStatsApi } from '../api.js';
import { generateQrSvg } from '../qrcode.js';
import { renderNetworkCard } from './NetworkCard.js';
import { renderQrPairingCard } from './QrPairingCard.js';
import { renderSecretCard } from './SecretCard.js';
import { renderDeviceListCard } from './DeviceListCard.js';
import { renderSecurityCard } from './SecurityCard.js';
import { renderStorageCard } from './StorageCard.js';
import { renderConfigCard } from './ConfigCard.js';
import { PLUGIN_VERSION } from '../version.js';
import { t, resolveLocale } from '../i18n.js';

export function createTailscaleMobileSection(React, jsx) {
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;

  return function TailscaleMobileSection(props) {
    var ctx = (props && props.ctx) || (typeof window !== 'undefined' && window.__DSH_CLIENT_CTX__) || null;
    var statusState = useState({
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
      locale: 'zh'
    });
    var status = statusState[0];
    var setStatus = statusState[1];

    var secretInputState = useState('');
    var secretInput = secretInputState[0];
    var setSecretInput = secretInputState[1];

    var showSecretState = useState(false);
    var showSecret = showSecretState[0];
    var setShowSecret = showSecretState[1];

    var showCodeState = useState(false);
    var showCode = showCodeState[0];
    var setShowCode = showCodeState[1];

    var showQrState = useState(false);
    var showQr = showQrState[0];
    var setShowQr = showQrState[1];

    var selectedTabState = useState('lan');
    var selectedTab = selectedTabState[0];
    var setSelectedTab = selectedTabState[1];

    var timeLeftState = useState(300);
    var timeLeft = timeLeftState[0];
    var setTimeLeft = timeLeftState[1];

    var toastState = useState(null);
    var toast = toastState[0];
    var setToast = toastState[1];

    var maxVisitsState = useState('60');
    var maxVisitsInput = maxVisitsState[0];
    var setMaxVisitsInput = maxVisitsState[1];

    var maxFailedState = useState('5');
    var maxFailedInput = maxFailedState[0];
    var setMaxFailedInput = maxFailedState[1];

    var lockDurationMinsState = useState('15');
    var lockDurationMinsInput = lockDurationMinsState[0];
    var setLockDurationMinsInput = lockDurationMinsState[1];

    var isSavingState = useState(false);
    var isSaving = isSavingState[0];
    var setIsSaving = isSavingState[1];

    var langState = useState(resolveLocale(ctx, status));
    var currentLang = langState[0];
    var setCurrentLang = langState[1];

    var refreshStatusOnly = useCallback(function() {
      fetchStatus().then(function(data) {
        if (data.tailscaleIp) {
          setSelectedTab('tailscale');
        }
        if (data.maxVisitsPerMinute) setMaxVisitsInput(String(data.maxVisitsPerMinute));
        if (data.maxFailedAttempts) setMaxFailedInput(String(data.maxFailedAttempts));
        if (data.lockDurationMs) setLockDurationMinsInput(String(Math.round(data.lockDurationMs / 60000)));
        if (data.locale) {
          setCurrentLang(resolveLocale(ctx, data));
        }

        setStatus(function(prev) {
          return {
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
            locale: data.locale || 'zh',
            loading: false
          };
        });
      }).catch(function() {});
    }, [ctx]);

    var refreshStatusAndCode = useCallback(function() {
      refreshStatusOnly();

      generatePairCode().then(function(data) {
        if (data.success) {
          setStatus(function(prev) {
            return {
              ...prev,
              code: data.code,
              expiresAt: data.expiresAt
            };
          });
          var remain = Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000));
          setTimeLeft(remain);
        }
      }).catch(function() {});
    }, [refreshStatusOnly]);

    useEffect(function() {
      refreshStatusAndCode();

      // 监听 DSH locale 服务动态切换（注意：不能在此处提前 return，否则后续
      // dsh-device-updated 监听与 3 秒轮询都不会注册，导致实时刷新失效）
      var localeUnsubs = [];
      try {
        var loc = ctx && (typeof ctx.get === 'function' ? ctx.get('locale') : ctx.locale);
        if (loc && typeof loc.subscribe === 'function') {
          var unsub = loc.subscribe(function() {
            setCurrentLang(resolveLocale(ctx, status));
          });
          if (typeof unsub === 'function') localeUnsubs.push(unsub);
        }
      } catch (e) {}

      var handleDeviceUpdate = function(e) {
        if (!e || !e.detail) return;
        var detail = e.detail;

        // 1. IP 安全审计即时更新
        if (detail.stats && Array.isArray(detail.stats)) {
          setStatus(function(prev) {
            return { ...prev, ipSecurityStats: detail.stats };
          });
        }

        // 2. 设备连接/上线即时乐观更新
        if (detail.device) {
          var dev = detail.device;
          setStatus(function(prev) {
            var prevList = prev.devices || [];
            var nextList = [dev].concat(prevList.filter(function(d) { return d.token !== dev.token; }));
            return {
              ...prev,
              devicesCount: nextList.length,
              devices: nextList
            };
          });

          var msg = (detail.type === 'device-connected')
            ? t('toastDeviceConnected', currentLang, { name: dev.deviceName || 'Device', ip: dev.ip })
            : t('toastDeviceOnline', currentLang, { name: dev.deviceName || 'Device', ip: dev.ip });
          setToast({ message: msg, type: 'info' });
          setTimeout(function() { setToast(null); }, 4000);
        }

        // 3. 设备注销即时移除
        if (detail.type === 'device-revoked') {
          setStatus(function(prev) {
            var prevList = prev.devices || [];
            var nextList = detail.all ? [] : prevList.filter(function(d) { return d.token !== detail.token; });
            return {
              ...prev,
              devicesCount: nextList.length,
              devices: nextList
            };
          });
        }

        // 4. 安全告警即时弹窗
        if (detail.type === 'ip-security-alert') {
          var alertMsg = t('toastIpLocked', currentLang, { ip: detail.ip });
          setToast({ message: alertMsg, type: 'danger' });
          setTimeout(function() { setToast(null); }, 5000);
        }

        // 5. 触发后台全量校准
        refreshStatusOnly();
      };
      window.addEventListener('dsh-device-updated', handleDeviceUpdate);

      // 面板打开时的 3 秒定时自动探针（双保险极速实时同步）
      var pollTimer = setInterval(function() {
        refreshStatusOnly();
      }, 3000);

      return function() {
        clearInterval(pollTimer);
        window.removeEventListener('dsh-device-updated', handleDeviceUpdate);
        for (var i = 0; i < localeUnsubs.length; i++) {
          localeUnsubs[i]();
        }
      };
    }, [refreshStatusAndCode, refreshStatusOnly, currentLang, ctx]);

    // 倒计时
    useEffect(function() {
      if (timeLeft <= 0) return;
      var timer = setInterval(function() {
        setTimeLeft(function(prev) {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return function() { clearInterval(timer); };
    }, [timeLeft]);

    // 交互逻辑
    var toggleTailscale = function() {
      var nextVal = !status.allowTailscale;
      updateBypassConfig(nextVal, status.allowLan).then(function() {
        setStatus(function(prev) { return { ...prev, allowTailscale: nextVal }; });
      });
    };

    var toggleLan = function() {
      var nextVal = !status.allowLan;
      if (nextVal) {
        var warnMsg = t('lanBypassConfirm', currentLang);
        if (!confirm(warnMsg)) return;
      }
      updateBypassConfig(status.allowTailscale, nextVal).then(function() {
        setStatus(function(prev) { return { ...prev, allowLan: nextVal }; });
      });
    };

    var saveSecret = function() {
      var trimmed = (secretInput || '').trim();
      if (!trimmed) {
        alert(t('secretInputPlaceholder', currentLang));
        return;
      }
      var hasLetter = /[a-zA-Z]/.test(trimmed);
      var hasNumber = /[0-9]/.test(trimmed);
      if (trimmed.length < 6 || !hasLetter || !hasNumber) {
        alert(t('secretWeakTip', currentLang));
        return;
      }
      updateSecret(trimmed).then(function(data) {
        if (data.success) {
          setStatus(function(prev) { return { ...prev, hasSecret: true }; });
          setSecretInput('');
          setToast({ message: currentLang === 'en' ? 'Persistent password saved!' : '长期访问密码已成功保存并启用！', type: 'success' });
          setTimeout(function() { setToast(null); }, 3000);
        } else {
          alert((currentLang === 'en' ? 'Save failed: ' : '保存失败：') + (data.reason || ''));
        }
      });
    };

    var clearSecret = function() {
      if (confirm(t('clearSecretConfirm', currentLang))) {
        clearSecretApi().then(function() {
          setStatus(function(prev) { return { ...prev, hasSecret: false }; });
          setSecretInput('');
          setToast({ message: currentLang === 'en' ? 'Password cleared!' : '已成功清除长期访问密码！', type: 'info' });
          setTimeout(function() { setToast(null); }, 3000);
        });
      }
    };

    var revokeDevice = function(token) {
      if (confirm(t('revokeDeviceConfirm', currentLang))) {
        revokeDeviceApi(token).then(function() {
          refreshStatusAndCode();
          setToast({ message: currentLang === 'en' ? 'Device disconnected!' : '已成功踢出该设备！', type: 'info' });
          setTimeout(function() { setToast(null); }, 2500);
        });
      }
    };

    var revokeAll = function() {
      if (confirm(t('revokeAllConfirm', currentLang))) {
        revokeAllDevicesApi().then(function() {
          refreshStatusAndCode();
          setToast({ message: currentLang === 'en' ? 'All devices disconnected!' : '已成功注销并踢下线所有设备！', type: 'info' });
          setTimeout(function() { setToast(null); }, 2500);
        });
      }
    };

    var unlockIp = function(ip) {
      if (confirm(t('unlockIpConfirm', currentLang, { ip: ip }))) {
        unlockIpApi(ip).then(function() {
          refreshStatusAndCode();
          setToast({ message: currentLang === 'en' ? ('IP ' + ip + ' unlocked!') : ('已成功为 IP ' + ip + ' 解除锁定！'), type: 'success' });
          setTimeout(function() { setToast(null); }, 3000);
        }).catch(function() {});
      }
    };

    var clearIpStats = function() {
      if (confirm(t('clearSecurityLogConfirm', currentLang))) {
        clearIpStatsApi().then(function() {
          refreshStatusAndCode();
          setToast({ message: currentLang === 'en' ? 'Audit logs cleared!' : '已成功清空所有安全审计日志！', type: 'success' });
          setTimeout(function() { setToast(null); }, 2500);
        }).catch(function() {});
      }
    };

    var saveAdvancedConfig = function() {
      var visits = parseInt(maxVisitsInput, 10);
      var failed = parseInt(maxFailedInput, 10);
      var mins = parseInt(lockDurationMinsInput, 10);

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
        lockDurationMs: mins * 60 * 1000
      }).then(function(data) {
        setIsSaving(false);
        if (data.success) {
          refreshStatusAndCode();
          setToast({ message: t('saveConfigSuccessToast', currentLang), type: 'success' });
          setTimeout(function() { setToast(null); }, 3000);
        } else {
          alert((currentLang === 'en' ? 'Save failed: ' : '保存失败：') + (data.reason || ''));
        }
      }).catch(function() {
        setIsSaving(false);
        alert(currentLang === 'en' ? 'Network request failed, please try again.' : '网络请求失败，请稍后重试');
      });
    };

    var resetAdvancedConfigDefaults = function() {
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
        lockDurationMs: 15 * 60 * 1000
      }).then(function(data) {
        setIsSaving(false);
        if (data.success) {
          refreshStatusAndCode();
          setToast({ message: t('restoreDefaultsSuccessToast', currentLang), type: 'success' });
          setTimeout(function() { setToast(null); }, 3000);
        } else {
          alert((currentLang === 'en' ? 'Reset failed: ' : '重置失败：') + (data.reason || ''));
        }
      }).catch(function() {
        setIsSaving(false);
        alert(currentLang === 'en' ? 'Network request failed, please try again.' : '网络请求失败，请稍后重试');
      });
    };

    var copyDirectLink = function() {
      if (timeLeft <= 0) {
        alert(t('codeExpired', currentLang));
        return;
      }
      var effectiveQrIp = (selectedTab === 'tailscale' && status.tailscaleIp) ? status.tailscaleIp : (status.lanIp || '127.0.0.1');
      var port = (typeof window !== 'undefined' && window.location.port) || '3080';
      var directLink = 'http://' + effectiveQrIp + ':' + port + '/auth?token=' + (status.code || '');
      navigator.clipboard.writeText(directLink).then(function() {
        setStatus(function(prev) { return { ...prev, copied: true }; });
        setTimeout(function() {
          setStatus(function(prev) { return { ...prev, copied: false }; });
        }, 2000);
      });
    };

    var copyText = function(text, successTip) {
      navigator.clipboard.writeText(text).then(function() {
        setToast({ message: successTip || (currentLang === 'en' ? 'Copied to clipboard!' : '已成功复制到剪贴板！'), type: 'success' });
        setTimeout(function() { setToast(null); }, 2500);
      });
    };

    return jsx.jsxs("div", {
      style: {
        padding: "4px 8px",
        color: "var(--dsw-alias-label-primary, inherit)",
        display: "flex",
        flexDirection: "column",
        gap: "16px"
      },
      children: [
        // 标题头部（左侧标题 + 右侧 GitHub 仓库链接）
        jsx.jsxs("div", {
          style: {
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "4px"
          },
          children: [
            jsx.jsxs("div", {
              style: { minWidth: "220px", flex: 1 },
              children: [
                jsx.jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", margin: "0 0 6px 0" },
                  children: [
                    jsx.jsx("h3", {
                      style: {
                        fontSize: "20px",
                        fontWeight: "700",
                        margin: 0,
                        color: "var(--dsw-alias-label-primary, inherit)"
                      },
                      children: t("title", currentLang)
                    }),
                    jsx.jsx("span", {
                      style: {
                        fontSize: "11px",
                        padding: "2px 7px",
                        borderRadius: "10px",
                        background: "rgba(59,130,246,0.15)",
                        color: "var(--dsw-alias-brand-primary, #3b82f6)",
                        fontWeight: "600"
                      },
                      children: PLUGIN_VERSION
                    })
                  ]
                }),
                jsx.jsx("div", {
                  style: {
                    fontSize: "13px",
                    color: "var(--dsw-alias-label-tertiary, #888)"
                  },
                  children: t("subtitle", currentLang)
                })
              ]
            }),

            // 右侧 GitHub 仓库直达徽标
            jsx.jsxs("a", {
              href: "https://github.com/IceApriler/dsh-remote-mobile",
              target: "_blank",
              rel: "noopener noreferrer",
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                background: "var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.1))",
                border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))",
                borderRadius: "8px",
                color: "var(--dsw-alias-label-secondary, inherit)",
                fontSize: "12px",
                fontWeight: "500",
                textDecoration: "none",
                transition: "all 0.2s ease",
                cursor: "pointer"
              },
              children: [
                jsx.jsx("svg", {
                  style: { width: "16px", height: "16px", fill: "currentColor" },
                  viewBox: "0 0 24 24",
                  children: jsx.jsx("path", {
                    d: "M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
                  })
                }),
                jsx.jsx("span", { children: "IceApriler/dsh-remote-mobile" })
              ]
            })
          ]
        }),

        // 卡片 1: 网络接入地址与免密直连管理
        renderNetworkCard(jsx, status, toggleTailscale, toggleLan, copyText, currentLang),

        // 卡片 2: 手机配对码与二维码
        renderQrPairingCard(jsx, {
          status: status,
          showCode: showCode,
          setShowCode: setShowCode,
          timeLeft: timeLeft,
          showQr: showQr,
          setShowQr: setShowQr,
          selectedTab: selectedTab,
          setSelectedTab: setSelectedTab,
          generateQrSvg: generateQrSvg,
          refreshStatusAndCode: refreshStatusAndCode,
          copyDirectLink: copyDirectLink,
          lang: currentLang
        }),

        // 卡片 3: 长期访问密码配置
        renderSecretCard(jsx, {
          status: status,
          secretInput: secretInput,
          setSecretInput: setSecretInput,
          showSecret: showSecret,
          setShowSecret: setShowSecret,
          saveSecret: saveSecret,
          clearSecret: clearSecret,
          lang: currentLang
        }),

        // 卡片 4: 详细已授权设备列表
        renderDeviceListCard(jsx, status, revokeDevice, revokeAll, currentLang),

        // 卡片 5: 防暴力破解与 IP 访问统计审计
        renderSecurityCard(jsx, status, unlockIp, clearIpStats, currentLang),

        // 卡片 6: 本地持久化存储位置说明
        renderStorageCard(jsx, status, currentLang),

        // 卡片 7: 全局高级安全参数配置
        renderConfigCard(jsx, {
          maxVisitsInput: maxVisitsInput,
          setMaxVisitsInput: setMaxVisitsInput,
          maxFailedInput: maxFailedInput,
          setMaxFailedInput: setMaxFailedInput,
          lockDurationMinsInput: lockDurationMinsInput,
          setLockDurationMinsInput: setLockDurationMinsInput,
          saveAdvancedConfig: saveAdvancedConfig,
          resetAdvancedConfigDefaults: resetAdvancedConfigDefaults,
          isSaving: isSaving,
          lang: currentLang
        })
      ]
    });
  };
}
