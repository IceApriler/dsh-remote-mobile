import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  StyleSnippetStore,
  BUILTIN_PRESETS,
  isMobileUserAgent,
  applyDataMobileAttr,
  buildMobileStyleTag,
  DEFAULT_STYLE_FILE,
} from '../lib/styles/style-snippets.js'

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-style-snippet-'))
  const file = join(dir, 'style-snippets.json')
  return { dir, file, store: new StyleSnippetStore(file) }
}

test('移动端样式片段模块测试 (style-snippets.ts)', async (t) => {
  await t.test('isMobileUserAgent 正确识别移动端 UA', () => {
    assert.equal(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'), true)
    assert.equal(isMobileUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'), true)
    assert.equal(isMobileUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'), false)
    assert.equal(isMobileUserAgent(''), false)
  })

  await t.test('内置三段预设：侧边栏/设置/正文，默认移动端启用且 PC 关闭', () => {
    const { store, dir } = makeStore()
    try {
      const ids = store.list().filter((s) => s.builtin).map((s) => s.id)
      assert.deepEqual(ids, ['preset-sidebar', 'preset-settings', 'preset-main'])
      assert.equal(BUILTIN_PRESETS.length, 3)
      assert.ok(store.list().every((s) => s.builtin === true && s.mobileEnabled === true && s.pcEnabled === false))

      const allCss = store.collectCss()
      assert.ok(allCss.includes('preset-sidebar'))
      assert.ok(allCss.includes('preset-settings'))
      assert.ok(allCss.includes('preset-main'))
      // 默认仅移动端开：全部为窄屏块，无宽屏块
      assert.ok(allCss.includes('@media (max-width: 900px)'))
      assert.ok(!allCss.includes('@media (min-width: 901px)'))

      // 回归守卫：官方弹窗 portal 层必须抬到抽屉 z-index 之上（否则设置弹窗被侧边栏盖住）
      const sidebarCss = store.get('preset-sidebar').css
      assert.ok(sidebarCss.includes('body > [role="presentation"]:has([role="dialog"][aria-modal="true"])'))
      assert.ok(sidebarCss.includes('z-index: 100006'))
      // 回归守卫：移动端 UA 下隐藏官方 Tooltip 气泡（触屏点击后 mouseleave/blur 永不触发导致气泡永久滞留）
      assert.ok(sidebarCss.includes('html[data-dsh-mobile="1"] [role="tooltip"]'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('按端启停：PC 开启后桌面注入、移动端关闭后不再注入', () => {
    const { store, dir } = makeStore()
    try {
      assert.equal(store.setEnabled('preset-main', 'pc', true), true)
      const bothCss = store.collectCss()
      assert.ok(bothCss.includes('@media (max-width: 900px)')) // 其余预设仍为窄屏块
      // preset-main 双端开 → 全宽度原样注入（无包装）
      assert.ok(bothCss.includes('/* 正文紧凑排版 (preset-main) */\n/* ===== dsh-remote-mobile'))

      assert.equal(store.setEnabled('preset-main', 'mobile', false), true)
      const pcOnlyCss = store.collectCss()
      assert.ok(pcOnlyCss.includes('@media (min-width: 901px)')) // 仅 PC → 宽屏块
      assert.ok(pcOnlyCss.includes('/* 正文紧凑排版 (preset-main) */\n@media (min-width: 901px)'))
      assert.ok(pcOnlyCss.includes('/* 侧边栏抽屉导航 (preset-sidebar) */\n@media (max-width: 900px)'))

      assert.equal(store.setEnabled('not-exist', 'pc', true), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('自定义片段：默认 PC 关/移动端开，可指定双端开关', () => {
    const { store, dir } = makeStore()
    try {
      const s = store.upsertCustom({ name: '默认片段', css: '.a {}' })
      assert.ok(s.id.startsWith('custom-'))
      assert.equal(s.pcEnabled, false)
      assert.equal(s.mobileEnabled, true)
      const allCss = store.collectCss()
      assert.ok(allCss.includes('默认片段'))
      assert.ok(allCss.includes('@media (max-width: 900px) {\n.a {}')) // 默认仅移动端 → 窄屏块

      const both = store.upsertCustom({ name: '双端片段', css: '.b {}', pcEnabled: true, mobileEnabled: true })
      assert.equal(both.pcEnabled, true)
      assert.equal(both.mobileEnabled, true)
      assert.ok(store.collectCss().includes('.b {}')) // 两端都开 → 全宽度原样生效
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('编辑自定义片段保持 id 与 createdAt，删除后从列表移除', () => {
    const { store, dir } = makeStore()
    try {
      const created = store.upsertCustom({ name: 'A', css: 'a {}' })
      const edited = store.upsertCustom({ id: created.id, name: 'A2', css: 'b {}', pcEnabled: true })
      assert.equal(edited.id, created.id)
      assert.equal(edited.createdAt, created.createdAt)
      assert.equal(edited.name, 'A2')
      assert.equal(edited.pcEnabled, true)
      assert.equal(store.removeCustom(created.id), true)
      assert.equal(store.removeCustom(created.id), false)
      assert.ok(!store.list().some((x) => x.id === created.id))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('双端启停状态持久化后可跨实例恢复', () => {
    const { store, file, dir } = makeStore()
    try {
      const custom = store.upsertCustom({ name: '持久片段', css: '.x {}', pcEnabled: true, mobileEnabled: false })
      store.setEnabled('preset-sidebar', 'pc', true)
      store.setEnabled('preset-settings', 'mobile', false)
      store.flushPersistedData()
      assert.ok(existsSync(file))

      const reloaded = new StyleSnippetStore(file)
      assert.equal(reloaded.get('preset-sidebar')?.pcEnabled, true)
      assert.equal(reloaded.get('preset-settings')?.mobileEnabled, false)
      assert.equal(reloaded.get(custom.id)?.pcEnabled, true)
      assert.equal(reloaded.get(custom.id)?.mobileEnabled, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('分组落盘：flush 后恒为三个预设分组，每组两字段齐全', () => {
    const { store, file, dir } = makeStore()
    try {
      store.setEnabled('preset-main', 'pc', true)
      store.flushPersistedData()
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      // 三组齐全
      assert.deepEqual(Object.keys(raw.presetStates).sort(), ['preset-main', 'preset-settings', 'preset-sidebar'])
      // 只操作 pc 的组：mobile 保持当前有效值（默认 true）一并落盘
      assert.deepEqual(raw.presetStates['preset-main'], { pc: true, mobile: true })
      // 未操作组带默认值
      assert.deepEqual(raw.presetStates['preset-sidebar'], { pc: false, mobile: true })
      // 读取一致
      const reloaded = new StyleSnippetStore(file)
      assert.equal(reloaded.get('preset-main')?.pcEnabled, true)
      assert.equal(reloaded.get('preset-main')?.mobileEnabled, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('collectCss 按端包装：移动端内置预设包窄屏媒体查询，PC 端不包直接生效', () => {
    const { store, dir } = makeStore()
    try {
      // 用户核心场景：默认仅移动端 → preset-main 位于窄屏块，PC 拉小窗口同样生效
      const s1 = store.collectCss()
      assert.ok(s1.includes('/* 正文紧凑排版 (preset-main) */\n@media (max-width: 900px)'))
      assert.ok(s1.includes('font-size: 12.5px')) // 高密度排版：紧凑字号
      assert.ok(s1.includes('[class*="_markdown"]'))
      // main 为最后一个预设（settings 在前含自己的 zoom），单独检查 main 段无布局缩放
      const mainPart = s1.split('/* 正文紧凑排版 (preset-main) */')[1] || ''
      assert.ok(!mainPart.includes('zoom:'))
      assert.ok(mainPart.includes('[data-composer-card="true"]')) // 输入区跟随紧凑
      assert.ok(mainPart.includes('line-height: 20px')) // 三层统一基准行高，防光标错位
      assert.ok(mainPart.includes('table th')) // 表格字号/内边距收敛
      assert.ok(mainPart.includes(':has(> [data-composer-card')) // composer 外层留白收窄

      // 双端开 → 全宽度原样；仅 PC → 宽屏块
      store.setEnabled('preset-main', 'pc', true)
      assert.ok(store.collectCss().includes('/* 正文紧凑排版 (preset-main) */\n/* ===== dsh-remote-mobile'))
      store.setEnabled('preset-main', 'mobile', false)
      const s2 = store.collectCss()
      assert.ok(s2.includes('@media (min-width: 901px)'))
      assert.ok(s2.includes('/* 正文紧凑排版 (preset-main) */\n@media (min-width: 901px)'))

      // 自定义片段同样按开关包装：仅移动 → 窄屏块；仅 PC → 宽屏块
      store.upsertCustom({ name: '窄屏片段', css: '.x {}' })
      store.upsertCustom({ name: '宽屏片段', css: '.y {}', pcEnabled: true, mobileEnabled: false })
      const s3 = store.collectCss()
      assert.ok(s3.includes('@media (max-width: 900px) {\n.x {}'))
      assert.ok(s3.includes('@media (min-width: 901px) {\n.y {}'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('v1 旧格式（enabled/mobileOnly）自动迁移到 v2 双端开关', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-style-migrate-'))
    const file = join(dir, 'style-snippets.json')
    try {
      writeFileSync(file, JSON.stringify({
        version: 1,
        builtinEnabled: { 'preset-sidebar': false, 'preset-main': true },
        custom: [
          { id: 'old-mobile', name: '旧移动端', css: 'a {}', enabled: true, mobileOnly: true },
          { id: 'old-both', name: '旧双端', css: 'b {}', enabled: true, mobileOnly: false },
          { id: 'old-off', name: '旧关闭', css: 'c {}', enabled: false, mobileOnly: false },
        ],
        customOrder: ['old-mobile', 'old-both', 'old-off'],
      }), 'utf8')

      const migrated = new StyleSnippetStore(file)
      assert.equal(migrated.get('preset-sidebar')?.pcEnabled, false)
      assert.equal(migrated.get('preset-sidebar')?.mobileEnabled, false)
      assert.equal(migrated.get('preset-main')?.mobileEnabled, true)
      assert.equal(migrated.get('old-mobile')?.pcEnabled, false)
      assert.equal(migrated.get('old-mobile')?.mobileEnabled, true)
      assert.equal(migrated.get('old-both')?.pcEnabled, true)
      assert.equal(migrated.get('old-both')?.mobileEnabled, true)
      assert.equal(migrated.get('old-off')?.pcEnabled, false)
      assert.equal(migrated.get('old-off')?.mobileEnabled, false)

      // 迁移后持久化为 v2
      migrated.resetEnabled()
      migrated.flushPersistedData()
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(raw.version, 2)
      assert.ok(raw.presetStates && typeof raw.presetStates === 'object')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('resetEnabled 恢复默认：内置移动开/PC 关，自定义移动开/PC 关', () => {
    const { store, dir } = makeStore()
    try {
      store.setEnabled('preset-sidebar', 'mobile', false)
      const custom = store.upsertCustom({ name: 'C', css: 'c {}', pcEnabled: true, mobileEnabled: false })
      store.resetEnabled()
      assert.ok(store.list().filter((s) => s.builtin).every((s) => s.mobileEnabled === true && s.pcEnabled === false))
      assert.equal(store.get(custom.id)?.pcEnabled, false)
      assert.equal(store.get(custom.id)?.mobileEnabled, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('参数校验与内置 id 冲突防护：preset- 前缀与内置 id 均拒绝', () => {
    const { store, dir } = makeStore()
    try {
      assert.throws(() => store.upsertCustom({ name: '  ', css: 'a {}' }))
      assert.throws(() => store.upsertCustom({ name: 'x', css: '   ' }))
      assert.throws(() => store.upsertCustom({ name: 'x'.repeat(100), css: 'a {}' }))
      // 与内置预设同 id / preset- 保留前缀均不可作为自定义 id
      assert.throws(() => store.upsertCustom({ id: 'preset-sidebar', name: '撞车', css: 'a {}' }))
      assert.throws(() => store.upsertCustom({ id: 'preset-custom-mine', name: '保留前缀', css: 'a {}' }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test('applyDataMobileAttr 幂等，buildMobileStyleTag 空内容返回空串且转义闭合标签', () => {
    const html = '<!DOCTYPE html><html lang="en"><head></head></html>'
    const withAttr = applyDataMobileAttr(html)
    assert.ok(withAttr.includes('data-dsh-mobile="1"'))
    assert.equal(applyDataMobileAttr(withAttr), withAttr)

    assert.equal(buildMobileStyleTag(''), '')
    assert.ok(buildMobileStyleTag('.x{}').startsWith('<style id="dsh-remote-mobile-style-snippets">'))

    // `</style` 必须被转义，防止片段提前闭合 <style> 标签
    // 注意：HTML 闭合标签自身也含 </style>，需按带上下文的序列断言
    const escaped = buildMobileStyleTag('.a { content: "</style>"; }')
    const rawSeq = '</' + 'style>'
    const coveredSeq = '<' + '\\' + '/style>'
    assert.ok(escaped.includes(coveredSeq + '"; }'))
    assert.ok(!escaped.includes(rawSeq + '"; }'))
  })

  await t.test('list(lang) 内置预设名称与描述按语言本地化', () => {
    const { store, dir } = makeStore()
    try {
      assert.equal(store.list('en').find((s) => s.id === 'preset-sidebar')?.name, 'Sidebar Drawer')
      assert.equal(store.list('zh').find((s) => s.id === 'preset-sidebar')?.name, '侧边栏抽屉导航')
      assert.equal(store.list('de').find((s) => s.id === 'preset-sidebar')?.name, '侧边栏抽屉导航')
      assert.ok(store.list('en').find((s) => s.id === 'preset-settings')?.description.includes('settings'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
