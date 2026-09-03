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

      // 回归守卫：抽屉层级必须低于官方弹层体系（模态 1000 / 菜单 1100），
      // 否则设置面板的操作菜单（portal 到 body、z=1100）会被抽屉盖住无法交互
      const sidebarCss = store.get('preset-sidebar').css
      assert.ok(sidebarCss.includes('z-index: 900 !important'))
      assert.ok(sidebarCss.includes('z-index: 901 !important'))
      assert.ok(!sidebarCss.includes('99999'))
      // 回归守卫：官方/生态 frame::after 全屏点击遮罩（z=1050）必须压到抽屉(900)之下，
      // 否则黑纱会罩住抽屉内容并拦截点击；未装 web-ui 时由 :not([data-sidebar-collapsed]) 规则补齐遮罩
      // （:has([class*="_sidebarCol"]) 把命中范围锁定到三栏布局帧，避免提问卡片 Mbwy4a_frame 等
      //   也含 _frame 后缀的内层元素被强制 100vw 撑满或被 ::after 全屏黑纱盖住）
      assert.ok(sidebarCss.includes('[class*="_frame"]:has([class*="_sidebarCol"])::after'))
      assert.ok(sidebarCss.includes('[class*="_frame"]:has([class*="_sidebarCol"]):not([data-sidebar-collapsed])::after'))
      assert.ok(/z-index:\s*899 !important/.test(sidebarCss))
      // 回归守卫：移动端 UA 下隐藏官方 Tooltip 气泡（触屏点击后 mouseleave/blur 永不触发导致气泡永久滞留）
      assert.ok(sidebarCss.includes('html[data-dsh-mobile="1"] [role="tooltip"]'))
      // 回归守卫：窄屏隐藏官方详情（details）列，杜绝详情浮层与顶部 header 重叠
      assert.ok(sidebarCss.includes('[class*="_detailsCol"]'))
      assert.ok(/display:\s*none !important/.test(sidebarCss))
      // 回归守卫：覆盖 web-ui 为折叠 rail 预留的 conversation-header 60px 左内边距
      // （特异性 (0,2,1) > web-ui (0,2,0)，且限定同断点 ≤768px）
      assert.ok(sidebarCss.includes('@media (max-width: 768px)'))
      assert.ok(sidebarCss.includes('[class*="_frame"] header[data-dsh-responsive-part="conversation-header"]'))
      assert.ok(/padding-left:\s*8px !important/.test(sidebarCss))
      // 回归守卫：覆盖 web-ui 给 session-utilities 按钮强制的 min-height:44px
      // （重复属性选择器抬特异性至 (0,4,0) > web-ui (0,3,0)，min-width 保留）
      assert.ok(sidebarCss.includes('[class*="_frame"] [data-dsh-responsive-part="session-utilities"][data-dsh-responsive-part] :is(button, [role="button"])'))
      assert.ok(/min-height:\s*0 !important/.test(sidebarCss))
      // 回归守卫：必须清除侧边栏列上会创建 fixed 包含块的属性，
      // 否则内联渲染于侧边栏 DOM 的设置弹窗（position:fixed）会被困在抽屉宽度内并被 overflow:hidden 裁剪
      assert.ok(/transform:\s*none !important/.test(sidebarCss))
      assert.ok(/filter:\s*none !important/.test(sidebarCss))
      assert.ok(/will-change:\s*auto !important/.test(sidebarCss))
      // 回归守卫：抽屉内层必须铺满外层（官方响应式脚本会给内层写死内联 width 如 280px，
      // 与官方外层 min(88vw,320px) 产生 ~40px 右缘空白条），用 !important 覆盖内联样式
      assert.ok(sidebarCss.includes('[class*="_sidebarCol"] > [data-slot="sidebar"] > div'))
      assert.ok(/width:\s*100% !important/.test(sidebarCss))

      // 回归守卫：设置弹窗覆写必须限定在 overlay 上下文内（仅命中设置弹窗），
      // 否则内测声明等通用 Modal（直接挂 body、无 data-slot overlay）会被 94vw/530px 覆写
      const settingsCss = store.get('preset-settings').css
      assert.ok(settingsCss.includes('[data-slot*="overlay"]:has([role="dialog"]) [role="dialog"]'))
      assert.ok(settingsCss.includes('[class*="_overlay"]:has([role="dialog"]) [class*="_dialog"]'))
      assert.ok(settingsCss.includes('[class*="_settingsModal"]'))
      // 不得再出现独立的裸 [role="dialog"] / [class*="_dialog"] 顶层选择器（会波及通用 Modal）
      assert.ok(!/^\s*\[role="dialog"\],$/m.test(settingsCss))
      // 回归守卫：弹窗等比微缩必须覆盖全部直接子元素（含左侧 nav 按钮列表），
      // 右侧内容单独保持 530px 最小宽度；否则左侧按钮列表不随整窗缩放
      assert.ok(settingsCss.includes('[data-slot*="overlay"]:has([role="dialog"]) [role="dialog"] > *'))
      assert.ok(settingsCss.includes('[class*="_overlay"]:has([role="dialog"]) [role="dialog"] > *'))
      assert.ok(settingsCss.includes('[data-slot*="overlay"]:has([role="dialog"]) [role="dialog"] > div'))
      assert.ok(/min-width:\s*530px !important/.test(settingsCss))
      // 回归守卫：重置插件市场弹窗窄屏隐藏左侧 nav 的行为（同选择器 + !important 稳压）
      assert.ok(settingsCss.includes('[role="dialog"]:has([data-dsh-market-root]) > nav'))
      assert.ok(/display:\s*block !important/.test(settingsCss))
      // 回归守卫：移动端设置弹窗顶部固定滑动提示（挂在 overlay ::before，absolute 不随内容滚动）
      assert.ok(settingsCss.includes('[data-slot*="overlay"]:has([role="dialog"])::before'))
      assert.ok(settingsCss.includes('左右滑动浏览'))
      assert.ok(/z-index:\s*100006 !important/.test(settingsCss))
      assert.ok(settingsCss.includes('pointer-events: none'))
      // 回归守卫：_frame 后缀必须用 :has([class*="_sidebarCol"]) 锁定到三栏布局帧，
      // 否则提问卡片 Mbwy4a_frame 等内层元素会被强制 width:100vw 撑满、被 ::after 全屏黑纱盖住
      assert.ok(sidebarCss.includes('[class*="_frame"]:has([class*="_sidebarCol"])'))
      assert.ok(!sidebarCss.match(/^\s*\[class\*="_frame"\]\s*\{$/m))
      assert.ok(!sidebarCss.match(/^\s*\[class\*="_frame"\]\[class\*="_centerCol"\]/m))
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
      // 回归守卫：composer 工具栏紧凑（锚定 _row，缩小按钮/图标/gap，保持两行布局）
      assert.ok(mainPart.includes('[data-composer-card="true"] [class*="_row"]'))
      assert.ok(mainPart.includes('[data-composer-card="true"] [class*="_row"] [class*="_primary"]'))
      assert.ok(/width:\s*30px !important/.test(mainPart))
      assert.ok(mainPart.includes('[data-composer-card="true"] [class*="_row"] svg'))
      // 回归守卫：提问卡片（Mbwy4a_frame，data-question-key 锚点）收窄左右边距，
      // 选项字号跟随正文（标签 13px / 说明 12.5px），避免弹窗撑满或字号过大
      assert.ok(mainPart.includes('[data-question-key]'))
      assert.ok(mainPart.includes('[data-question-key] [class*="_optionLabel"]'))
      assert.ok(/padding-left:\s*8px !important/.test(mainPart))
      assert.ok(/font-size:\s*13px !important/.test(mainPart))
      assert.ok(/font-size:\s*12\.5px !important/.test(mainPart))

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
