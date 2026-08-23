import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchStyles,
  saveStyleSnippet,
  toggleStyleApi,
  deleteStyleSnippetApi,
  resetStylesApi,
} from '../api.js';
import { t } from '../i18n.js';

/**
 * 卡片 8: 移动端样式片段（样式小插件）管理
 * 内置预设开箱即用，自定义片段即时增删改；保存后下一次页面加载即生效，无需重启。
 */
export function StylesCard({ lang }) {
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // null=未编辑, ''=新增, id=编辑中
  const [showForm, setShowForm] = useState(false); // 自定义表单默认收起，点「＋新增」展开
  const [name, setName] = useState('');
  const [css, setCss] = useState('');
  const [pcEnabled, setPcEnabled] = useState(false);
  const [mobileEnabled, setMobileEnabled] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [feedback, setFeedback] = useState('');

  const load = useCallback(() => {
    fetchStyles()
      .then((data) => {
        setSnippets(data.snippets || []);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setFeedback(t('stylesLoadFail', lang));
      });
  }, [lang]);

  useEffect(() => {
    load();
  }, [load]);

  const showFeedback = (msg) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 3500);
  };

  const toggle = (id, scope, enabled) => {
    toggleStyleApi(id, scope, enabled).then((data) => {
      if (data.success) {
        load();
        const scopeLabel = scope === 'pc' ? (lang === 'en' ? 'PC' : 'PC 端') : (lang === 'en' ? 'Mobile' : '移动端');
        showFeedback(
          enabled
            ? (lang === 'en' ? scopeLabel + ' enabled!' : scopeLabel + ' 已启用！')
            : (lang === 'en' ? scopeLabel + ' disabled!' : scopeLabel + ' 已停用！')
        );
      }
    });
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setShowForm(true);
    setName(s.name);
    setCss(s.css);
    setPcEnabled(s.pcEnabled !== false);
    setMobileEnabled(s.mobileEnabled !== false);
    setFeedback('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowForm(false);
    setName('');
    setCss('');
    setPcEnabled(false);
    setMobileEnabled(true);
    setFeedback('');
  };

  const save = () => {
    if (!name.trim() || !css.trim()) {
      alert(t('stylesFieldsRequired', lang));
      return;
    }
    saveStyleSnippet({
      id: editingId || undefined,
      name: name.trim(),
      css: css,
      pcEnabled: pcEnabled,
      mobileEnabled: mobileEnabled,
    })
      .then((data) => {
        if (data.success) {
          load();
          cancelEdit();
          showFeedback(t('stylesSaveSuccess', lang));
        } else {
          alert((lang === 'en' ? 'Save failed: ' : '保存失败：') + (data.reason || ''));
        }
      })
      .catch(() => {
        alert(lang === 'en' ? 'Network request failed, please try again.' : '网络请求失败，请稍后重试');
      });
  };

  const remove = (s) => {
    if (s.builtin) return;
    if (confirm(t('stylesDeleteConfirm', lang))) {
      deleteStyleSnippetApi(s.id).then((data) => {
        if (data.success) {
          if (editingId === s.id) cancelEdit();
          load();
          showFeedback(lang === 'en' ? 'Style snippet deleted!' : '自定义样式片段已删除！');
        }
      });
    }
  };

  const resetAll = () => {
    if (!confirm(t('stylesResetConfirm', lang))) return;
    resetStylesApi().then((data) => {
      if (data.success) {
        load();
        showFeedback(lang === 'en' ? 'Style snippets reset to defaults!' : '已恢复所有片段的默认启停状态！');
      }
    });
  };

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // 双端启停状态徽标（PC / 移动端）
  const scopeBadge = (s) => {
    if (s.pcEnabled && s.mobileEnabled) return t('stylesBothDevices', lang);
    if (s.mobileEnabled) return '📱 ' + t('stylesMobileOnlyBadge', lang);
    if (s.pcEnabled) return '🖥️ ' + t('stylesPcOnlyBadge', lang);
    return t('stylesDisabled', lang);
  };

  const rowStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))',
    borderRadius: '8px',
    padding: '10px 12px',
  };

  const miniBtnStyle = {
    padding: '4px 10px',
    background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.1))',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
    color: 'var(--dsw-alias-label-secondary, inherit)',
    borderRadius: '6px',
    fontSize: '11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  const primaryBtnStyle = {
    ...miniBtnStyle,
    background: 'rgba(59,130,246,0.15)',
    color: 'var(--dsw-alias-brand-primary, #3b82f6)',
    border: '1px solid rgba(59,130,246,0.3)',
  };

  return (
    <div
      style={{
        background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06))',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
        borderRadius: '12px',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🎨</span>
          <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--dsw-alias-label-primary, inherit)' }}>
            {t('stylesCardTitle', lang)}
          </span>
        </div>
        <button type="button" onClick={resetAll} style={miniBtnStyle}>
          {t('stylesResetAll', lang)}
        </button>
      </div>

      <div style={{ fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)', lineHeight: '1.5' }}>
        {t('stylesCardDesc', lang)}
      </div>

      {feedback ? (
        <div
          style={{
            fontSize: '12px',
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(16,185,129,0.12)',
            color: 'var(--dsw-alias-success, #10b981)',
            border: '1px solid rgba(16,185,129,0.25)',
          }}
        >
          {feedback}
        </div>
      ) : null}

      {loading ? (
        <div style={{ fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' }}>
          {lang === 'en' ? 'Loading style snippets...' : '正在加载样式片段...'}
        </div>
      ) : (
        <>
          {/* 内置预设（若有预设则展示，若无则仅展示自定义片段） */}
          {snippets.some((s) => s.builtin) ? (
            <>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-secondary, inherit)' }}>
                {t('stylesPresetsTitle', lang)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {snippets
                  .filter((s) => s.builtin)
                  .map((s) => (
                    <div key={s.id} style={rowStyle}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '180px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--dsw-alias-label-primary, inherit)' }}>
                              {s.name}
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                padding: '1px 6px',
                                borderRadius: '8px',
                                background: 'rgba(139,92,246,0.15)',
                                color: '#8b5cf6',
                                fontWeight: '600',
                              }}
                            >
                              Preset
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                padding: '1px 6px',
                                borderRadius: '8px',
                                background: 'rgba(59,130,246,0.12)',
                                color: '#3b82f6',
                                fontWeight: '600',
                              }}
                            >
                              {scopeBadge(s)}
                            </span>
                          </div>
                          {s.description ? (
                            <div style={{ fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: '3px' }}>
                              {s.description}
                            </div>
                          ) : null}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={s.pcEnabled}
                              onChange={(e) => toggle(s.id, 'pc', e.target.checked)}
                              style={{ accentColor: '#3b82f6', width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            🖥️ {t('stylesPcShort', lang)}
                          </label>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={s.mobileEnabled}
                              onChange={(e) => toggle(s.id, 'mobile', e.target.checked)}
                              style={{ accentColor: '#3b82f6', width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            📱 {t('stylesMobileShort', lang)}
                          </label>
                          <button type="button" onClick={() => toggleExpand(s.id)} style={miniBtnStyle}>
                            {expanded[s.id] ? t('stylesHideCss', lang) : t('stylesViewCss', lang)}
                          </button>
                        </div>
                      </div>
                      {expanded[s.id] ? (
                        <pre
                          style={{
                            maxHeight: '180px',
                            overflow: 'auto',
                            fontSize: '11px',
                            lineHeight: '1.5',
                            margin: 0,
                            padding: '8px 10px',
                            background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.25))',
                            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
                            borderRadius: '6px',
                            color: 'var(--dsw-alias-label-secondary, inherit)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
                          }}
                        >
                          {s.css}
                        </pre>
                      ) : null}
                    </div>
                  ))}
              </div>
            </>
          ) : null}

          {/* 自定义片段 */}
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-secondary, inherit)', marginTop: '4px' }}>
            {t('stylesCustomTitle', lang)}
          </div>

          {/* 新增/编辑表单：默认收起，最多展示「＋ 新增自定义片段」入口；编辑时自动展开 */}
          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              style={{
                width: '100%',
                padding: '12px',
                background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))',
                border: '1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
                borderRadius: '8px',
                color: 'var(--dsw-alias-brand-primary, #3b82f6)',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              {t('stylesAddNew', lang)}
            </button>
          ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))',
              border: '1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
              borderRadius: '8px',
              padding: '12px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('stylesNamePlaceholder', lang)}
                style={{
                  flex: 1,
                  minWidth: '160px',
                  padding: '8px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
                  background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.2))',
                  color: 'var(--dsw-alias-label-primary, inherit)',
                  outline: 'none',
                }}
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={pcEnabled}
                  onChange={(e) => setPcEnabled(e.target.checked)}
                  style={{ accentColor: '#3b82f6', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                🖥️ {t('stylesPcShort', lang)}
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={mobileEnabled}
                  onChange={(e) => setMobileEnabled(e.target.checked)}
                  style={{ accentColor: '#3b82f6', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                📱 {t('stylesMobileShort', lang)}
              </label>
            </div>
            <textarea
              value={css}
              onChange={(e) => setCss(e.target.value)}
              placeholder={t('stylesCssPlaceholder', lang)}
              rows={5}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                fontSize: '12px',
                lineHeight: '1.5',
                borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
                background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.2))',
                color: 'var(--dsw-alias-label-primary, inherit)',
                fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
                outline: 'none',
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={save} style={primaryBtnStyle}>
                {t('stylesSave', lang)}
              </button>
              {editingId !== null ? (
                <button type="button" onClick={cancelEdit} style={miniBtnStyle}>
                  {t('stylesCancelEdit', lang)}
                </button>
              ) : null}
              {showForm && !editingId ? (
                <button type="button" onClick={cancelEdit} style={miniBtnStyle}>
                  {t('stylesCancelEdit', lang)}
                </button>
              ) : null}
            </div>
          </div>
          )}

          {/* 自定义列表 */}
          {snippets.filter((s) => !s.builtin).length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' }}>
              {t('stylesEmptyCustom', lang)}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {snippets
                .filter((s) => !s.builtin)
                .map((s) => (
                  <div key={s.id} style={rowStyle}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: '180px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--dsw-alias-label-primary, inherit)' }}>
                            {s.name}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '1px 6px',
                              borderRadius: '8px',
                              background: 'rgba(59,130,246,0.12)',
                              color: '#3b82f6',
                              fontWeight: '600',
                            }}
                          >
                            {scopeBadge(s)}
                          </span>
                        </div>
                        {s.description ? (
                          <div style={{ fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: '3px' }}>
                            {s.description}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={s.pcEnabled}
                            onChange={(e) => toggle(s.id, 'pc', e.target.checked)}
                            style={{ accentColor: '#3b82f6', width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          🖥️ {t('stylesPcShort', lang)}
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={s.mobileEnabled}
                            onChange={(e) => toggle(s.id, 'mobile', e.target.checked)}
                            style={{ accentColor: '#3b82f6', width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          📱 {t('stylesMobileShort', lang)}
                        </label>
                        <button type="button" onClick={() => startEdit(s)} style={miniBtnStyle}>
                          {t('stylesEditBtn', lang)}
                        </button>
                        <button type="button" onClick={() => remove(s)} style={{ ...miniBtnStyle, color: '#ef4444' }}>
                          {t('stylesDeleteBtn', lang)}
                        </button>
                        <button type="button" onClick={() => toggleExpand(s.id)} style={miniBtnStyle}>
                          {expanded[s.id] ? t('stylesHideCss', lang) : t('stylesViewCss', lang)}
                        </button>
                      </div>
                    </div>
                    {expanded[s.id] ? (
                      <pre
                        style={{
                          maxHeight: '180px',
                          overflow: 'auto',
                          fontSize: '11px',
                          lineHeight: '1.5',
                          margin: 0,
                          padding: '8px 10px',
                          background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.25))',
                          border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
                          borderRadius: '6px',
                          color: 'var(--dsw-alias-label-secondary, inherit)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
                        }}
                      >
                        {s.css}
                      </pre>
                    ) : null}
                  </div>
                ))}
            </div>
          )}

          {/* 使用提示 */}
          <div style={{ fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)', lineHeight: '1.6' }}>
            {t('stylesHint', lang)}
          </div>
        </>
      )}
    </div>
  );
}
