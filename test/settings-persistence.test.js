import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import {
  readPluginSettingsJson,
  writePluginSettingsJson,
  readLegacyDshSettings,
  resolveInitialStoreOptions,
  parseLocaleFromSettingsYaml,
  parseLocaleFromPatch,
  readGlobalLocale,
} from '../lib/auth/token.js'

test('插件配置持久化与旧版 settings.yaml 迁移 (settings-persistence)', async (t) => {
  t.after(() => {})

  await t.test('writePluginSettingsJson / readPluginSettingsJson 往返一致且权限为 0600', () => {
    const file = `/tmp/dsh-rm-settings-${Date.now()}.json`
    const ok = writePluginSettingsJson({
      allowTailscale: true,
      allowLan: false,
      secretHash: 'scrypt:salt:hash',
      maxFailedAttempts: 8,
      lockDurationMs: 1200000,
      maxVisitsPerMinute: 40,
    }, file)
    assert.equal(ok, true)

    const parsed = readPluginSettingsJson(file)
    assert.equal(parsed.allowTailscale, true)
    assert.equal(parsed.allowLan, false)
    assert.equal(parsed.secretHash, 'scrypt:salt:hash')
    assert.equal(parsed.maxFailedAttempts, 8)
    assert.equal(parsed.lockDurationMs, 1200000)
    assert.equal(parsed.maxVisitsPerMinute, 40)

    // 仅当前用户可读写
    assert.equal(statSync(file).mode & 0o777, 0o600)

    rmSync(file, { force: true })
  })

  await t.test('readPluginSettingsJson 对缺失文件与非法内容安全降级', () => {
    assert.deepEqual(readPluginSettingsJson(`/tmp/dsh-rm-nonexist-${Date.now()}.json`), {})

    const bad = `/tmp/dsh-rm-bad-${Date.now()}.json`
    writeFileSync(bad, '{ not valid json', 'utf8')
    assert.deepEqual(readPluginSettingsJson(bad), {})
    rmSync(bad, { force: true })

    const badTypes = `/tmp/dsh-rm-badtypes-${Date.now()}.json`
    writeFileSync(badTypes, JSON.stringify({ allowTailscale: 'yes', maxFailedAttempts: -3, secretHash: '' }), 'utf8')
    const parsed = readPluginSettingsJson(badTypes)
    assert.equal(parsed.allowTailscale, undefined)
    assert.equal(parsed.maxFailedAttempts, undefined)
    assert.equal(parsed.secretHash, undefined)
    rmSync(badTypes, { force: true })
  })

  await t.test('readLegacyDshSettings 合并 settings.yaml 与 settings.yaml.imported（live 优先）', () => {
    const live = `/tmp/dsh-rm-live-${Date.now()}.yaml`
    const imported = `/tmp/dsh-rm-imported-${Date.now()}.yaml`
    writeFileSync(live, [
      'dsh-remote-mobile:',
      '  allowTailscale: false',
      '  maxVisitsPerMinute: 30',
    ].join('\n'), 'utf8')
    writeFileSync(imported, [
      'dsh-remote-mobile:',
      '  allowTailscale: true',
      '  maxVisitsPerMinute: 40',
      '  secretHash: \'scrypt:legacy:hash\'',
    ].join('\n'), 'utf8')

    const merged = readLegacyDshSettings(live, imported)
    assert.equal(merged.allowTailscale, false) // live 覆盖 imported
    assert.equal(merged.maxVisitsPerMinute, 30)
    assert.equal(merged.secretHash, 'scrypt:legacy:hash') // imported 独有的字段保留

    rmSync(live, { force: true })
    rmSync(imported, { force: true })
  })

  await t.test('parseLocaleFromPatch 解析 profile cordis.patch.yml 的 locale 配置', () => {
    const patch = [
      '# profile patch',
      '- id: webserver',
      '  name: "@deepseek-ai/dsh-host-webserver"',
      '  config:',
      '    host: 0.0.0.0',
      '- id: locale',
      '  name: "@deepseek-ai/dsh-client-locale"',
      '  config:',
      '    preference: en',
      '- id: ui-theme',
      '  config:',
      '    preference: system',
    ].join('\n')
    assert.equal(parseLocaleFromPatch(patch), 'en')

    const zhPatch = patch.replace('preference: en', 'preference: zh')
    assert.equal(parseLocaleFromPatch(zhPatch), 'zh')

    assert.equal(parseLocaleFromPatch('- id: webserver\n  config:\n    host: 0.0.0.0'), null)
  })

  await t.test('parseLocaleFromSettingsYaml 解析旧版 settings.yaml 的 locale.preference', () => {
    assert.equal(parseLocaleFromSettingsYaml('locale:\n  preference: zh'), 'zh')
    assert.equal(parseLocaleFromSettingsYaml('pet:\n  visible: true\nlocale:\n  preference: en'), 'en')
    assert.equal(parseLocaleFromSettingsYaml('pet:\n  visible: true'), null)
  })

  await t.test('readGlobalLocale 显式路径按旧版 settings.yaml 解析', () => {
    const file = `/tmp/dsh-rm-locale-${Date.now()}.yaml`
    writeFileSync(file, 'locale:\n  preference: en\n', 'utf8')
    assert.equal(readGlobalLocale(file), 'en')
    rmSync(file, { force: true })

    assert.equal(readGlobalLocale(`/tmp/dsh-rm-locale-missing-${Date.now()}.yaml`), 'zh')
  })

  await t.test('readPluginSettingsJson / writePluginSettingsJson 流程闭环', () => {
    const file = `/tmp/dsh-rm-flow-${Date.now()}.json`
    writePluginSettingsJson({
      allowTailscale: false,
      allowLan: false,
      secretHash: '',
      maxFailedAttempts: 5,
      lockDurationMs: 900000,
      maxVisitsPerMinute: 60,
    }, file)
    const read = readPluginSettingsJson(file)
    assert.equal(read.allowTailscale, false)
    assert.equal(read.allowLan, false)
    assert.equal(read.secretHash, undefined) // 空密码在读取时归一化为 undefined（由 store 默认值保持为空）
    rmSync(file, { force: true })
  })

  await t.test('resolveInitialStoreOptions 核心决策：自有配置存在时老密码绝不复活，且支持首次迁移', () => {
    // 场景 1: 自有配置已存在且清空了密码（own 中无有效 secretHash），旧配置 legacy 中残留老密码
    // 核心安全断言：绝不复活老密码！
    const cleared = resolveInitialStoreOptions(
      {},
      { allowTailscale: true, maxFailedAttempts: 8 }, // 已存在自有配置，但无密码
      { secretHash: 'scrypt:legacy:resurrect:prevent', maxFailedAttempts: 3 }
    )
    assert.equal(cleared.secretHash, '', '自有配置存在时，老密码绝不得复活')
    assert.equal(cleared.allowTailscale, true)
    assert.equal(cleared.maxFailedAttempts, 8)

    // 场景 2: 首次安装/升级（own === null，文件尚不存在），legacy 含有旧密码与旧配置
    // 迁移断言：安全救回旧密码与配置
    const migrated = resolveInitialStoreOptions(
      {},
      null, // 文件尚不存在
      { secretHash: 'scrypt:legacy:recover', maxFailedAttempts: 10, allowLan: true }
    )
    assert.equal(migrated.secretHash, 'scrypt:legacy:recover', '首次迁移应救回 legacy 密码')
    assert.equal(migrated.maxFailedAttempts, 10)
    assert.equal(migrated.allowLan, true)

    // 场景 3: 构造显式入参 explicit 拥有最高优先级
    const explicit = resolveInitialStoreOptions(
      { secretHash: 'scrypt:explicit:highest', maxFailedAttempts: 99 },
      { secretHash: 'scrypt:own', maxFailedAttempts: 5 },
      { secretHash: 'scrypt:legacy', maxFailedAttempts: 3 }
    )
    assert.equal(explicit.secretHash, 'scrypt:explicit:highest')
    assert.equal(explicit.maxFailedAttempts, 99)
  })
})
