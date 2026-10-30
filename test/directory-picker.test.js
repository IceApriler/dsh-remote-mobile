import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'
import {
  inspectDirectoryPickerPatchContent,
  applyDirectoryPickerBrowsePatch,
  removeDirectoryPickerBrowsePatch,
  inspectRuntimeDirectoryPicker,
  bindDirectoryPickerRuntime,
  getDirectoryPickerStatus,
  enableDirectoryPickerBrowse,
  disableDirectoryPickerBrowse,
} from '../lib/bridge/directory-picker.js'
import { SessionStore } from '../lib/auth/token.js'
import { createRoutes } from '../lib/routes/api.js'
import { EventEmitter } from 'node:events'

test('目录选择器（directory-picker）检测与幂等去重补丁测试', async (t) => {
  await t.test('空配置或仅含常规插件时判定为未启用且非 partial', () => {
    const baseYaml = [
      '- insert:',
      '    - id: remote-mobile',
      "      name: 'dsh-remote-mobile'",
      '',
    ].join('\n')

    const info = inspectDirectoryPickerPatchContent(baseYaml)
    assert.equal(info.autoDisabled, false)
    assert.equal(info.hostBrowseInserted, false)
    assert.equal(info.uiBrowseInserted, false)
    assert.equal(info.configured, false)
    assert.equal(info.partial, false)
  })

  await t.test('首次注入完整补丁，且连续多次调用保持严格幂等去重（不产生重复块）', () => {
    const baseYaml = [
      '- insert:',
      '    - id: remote-mobile',
      "      name: 'dsh-remote-mobile'",
      '',
    ].join('\n')

    const first = applyDirectoryPickerBrowsePatch(baseYaml)
    assert.equal(first.changed, true)
    assert.equal(inspectDirectoryPickerPatchContent(first.content).configured, true)

    // 检查各关键 ID 仅出现一次（使用行尾锚点区分 directory-picker 与 directory-picker-browse）
    assert.equal((first.content.match(/id:\s*directory-picker\s*$/gm) || []).length, 1)
    assert.equal((first.content.match(/id:\s*directory-picker-browse\s*$/gm) || []).length, 1)
    assert.equal((first.content.match(/id:\s*ui-directory-picker-browse\s*$/gm) || []).length, 1)

    // 第二次、第三次调用：完全幂等，changed 为 false，内容不变
    const second = applyDirectoryPickerBrowsePatch(first.content)
    assert.equal(second.changed, false)
    assert.equal(second.content, first.content)
  })

  await t.test('去重场景 1：已存在 `- id: directory-picker`（未设 disabled 或 disabled: false）时就地更新，不新增第二个条目', () => {
    const existingAuto = [
      '- id: directory-picker',
      '  disabled: false',
      '- insert:',
      '    - id: remote-mobile',
      "      name: 'dsh-remote-mobile'",
      '',
    ].join('\n')

    const patched = applyDirectoryPickerBrowsePatch(existingAuto)
    assert.equal(patched.changed, true)
    assert.equal(inspectDirectoryPickerPatchContent(patched.content).configured, true)
    assert.equal(
      (patched.content.match(/^-\s*id:\s*directory-picker\s*$/gm) || []).length,
      1,
      '严禁产生重复的 - id: directory-picker 块'
    )
    assert.ok(!patched.content.includes('disabled: false'))
  })

  await t.test('去重场景 2：已手动配置过其中一个 browse 插件时，仅补充缺失的另一项，绝不重复插入', () => {
    const partialYaml = [
      '- id: directory-picker',
      '  disabled: true',
      '- insert:',
      '    - id: remote-mobile',
      "      name: 'dsh-remote-mobile'",
      '    - id: directory-picker-browse',
      "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
      '',
    ].join('\n')

    const infoBefore = inspectDirectoryPickerPatchContent(partialYaml)
    assert.equal(infoBefore.configured, false)
    assert.equal(infoBefore.partial, true)
    assert.equal(infoBefore.autoDisabled, true)
    assert.equal(infoBefore.hostBrowseInserted, true)
    assert.equal(infoBefore.uiBrowseInserted, false)

    const patched = applyDirectoryPickerBrowsePatch(partialYaml)
    assert.equal(patched.changed, true)
    assert.equal(inspectDirectoryPickerPatchContent(patched.content).configured, true)
    assert.equal((patched.content.match(/dsh-host-directory-picker-browse/g) || []).length, 1)
    assert.equal((patched.content.match(/dsh-client-ui-directory-picker-browse/g) || []).length, 1)
    assert.equal((patched.content.match(/^-\s*id:\s*directory-picker\s*$/gm) || []).length, 1)
  })

  await t.test('还原场景：移除补丁后完整保留用户原有的其他插件与配置', () => {
    const original = [
      '- id: locale',
      '  config:',
      '    preference: zh',
      '- insert:',
      '    - id: remote-mobile',
      "      name: 'dsh-remote-mobile'",
      '',
    ].join('\n')

    const applied = applyDirectoryPickerBrowsePatch(original)
    assert.equal(inspectDirectoryPickerPatchContent(applied.content).configured, true)

    const removed = removeDirectoryPickerBrowsePatch(applied.content)
    assert.equal(removed.changed, true)
    assert.equal(inspectDirectoryPickerPatchContent(removed.content).configured, false)
    assert.equal(removed.content, original)
  })

  await t.test('还原场景 2：当 browse 与其他插件共用同一个 - insert: 块时，仅移除 browse 子项并保留共用 insert 块', () => {
    const sharedInsert = [
      '- id: directory-picker',
      '  disabled: true',
      '- insert:',
      '    - id: remote-mobile',
      "      name: 'dsh-remote-mobile'",
      '    - id: directory-picker-browse',
      "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
      '    - id: ui-directory-picker-browse',
      "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'",
      '',
    ].join('\n')

    const removed = removeDirectoryPickerBrowsePatch(sharedInsert)
    assert.equal(removed.changed, true)
    assert.ok(removed.content.includes("name: 'dsh-remote-mobile'"))
    assert.ok(!removed.content.includes('directory-picker-browse'))
    assert.ok(!removed.content.includes('ui-directory-picker-browse'))
    assert.ok(!removed.content.includes('directory-picker'))
  })

  await t.test('运行时 Loader 探测：准确识别 auto 与 browse 激活态及 restartRequired', () => {
    const tmpFile = `/tmp/dsh-dir-picker-test-${Date.now()}.yml`
    writeFileSync(
      tmpFile,
      "- insert:\n    - id: remote-mobile\n      name: 'dsh-remote-mobile'\n",
      'utf8'
    )

    // 模拟运行时仍处于默认 auto 激活态
    const mockCtxAuto = {
      get(name) {
        if (name === 'loader') {
          return {
            entries: () => [
              {
                id: 'directory-picker',
                options: { name: '@deepseek-ai/dsh-host-directory-picker-auto' },
                disabled: false,
              },
            ],
          }
        }
        return undefined
      },
    }

    bindDirectoryPickerRuntime(mockCtxAuto, () => true)
    const statusBefore = getDirectoryPickerStatus(tmpFile)
    assert.equal(statusBefore.patchEnabled, false)
    assert.equal(statusBefore.runtimeActive, false)
    assert.equal(statusBefore.needsWarning, true)

    // 一键写入开启 browse 后：配置文件已开启，但运行时 loader 仍是 auto，因此 restartRequired 为 true，needsWarning 消除
    const enabledRes = enableDirectoryPickerBrowse(tmpFile)
    assert.equal(enabledRes.changed, true)
    assert.equal(enabledRes.patchEnabled, true)
    assert.equal(enabledRes.runtimeActive, false)
    assert.equal(enabledRes.restartRequired, true)
    assert.equal(enabledRes.needsWarning, false)

    // 模拟重启/HMR 后 loader 已加载 browse
    const mockCtxBrowse = {
      get(name) {
        if (name === 'loader') {
          return {
            entries: () => [
              {
                id: 'directory-picker',
                options: { name: '@deepseek-ai/dsh-host-directory-picker-auto' },
                disabled: true,
              },
              {
                id: 'directory-picker-browse',
                options: { name: '@deepseek-ai/dsh-host-directory-picker-browse' },
                disabled: false,
              },
              {
                id: 'ui-directory-picker-browse',
                options: { name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
                disabled: false,
              },
            ],
          }
        }
        return undefined
      },
    }

    bindDirectoryPickerRuntime(mockCtxBrowse, () => true)
    const statusAfterReload = getDirectoryPickerStatus(tmpFile)
    assert.equal(statusAfterReload.patchEnabled, true)
    assert.equal(statusAfterReload.runtimeActive, true)
    assert.equal(statusAfterReload.restartRequired, false)
    assert.equal(statusAfterReload.needsWarning, false)

    // 恢复 PC 原生目录选择器
    const disabledRes = disableDirectoryPickerBrowse(tmpFile)
    assert.equal(disabledRes.changed, true)
    assert.equal(disabledRes.patchEnabled, false)

    bindDirectoryPickerRuntime(null, () => true)
    rmSync(tmpFile, { force: true })
  })

  await t.test('POST /api/remote-mobile/directory-picker 路由开启与关闭闭环', async () => {
    const tmpFile = `/tmp/dsh-dir-picker-route-${Date.now()}.yml`
    writeFileSync(
      tmpFile,
      "- insert:\n    - id: remote-mobile\n      name: 'dsh-remote-mobile'\n",
      'utf8'
    )

    const store = new SessionStore({ devicesFile: `/tmp/dsh-dp-devices-${Date.now()}.json` })
    const routes = createRoutes(store, undefined, { patchFilePath: tmpFile })
    const dpRoute = routes.find((r) => r.path === '/api/remote-mobile/directory-picker')
    assert.ok(dpRoute)

    const callRoute = async (body) => {
      const req = new EventEmitter()
      req.method = 'POST'
      req.headers = {}
      let status = 200
      let raw = ''
      const res = {
        writeHead(code) { status = code },
        end(chunk) { if (chunk) raw += chunk },
      }
      process.nextTick(() => {
        req.emit('data', Buffer.from(JSON.stringify(body)))
        req.emit('end')
      })
      await dpRoute.handler(req, res)
      return { status, json: JSON.parse(raw) }
    }

    // 1. 非布尔值参数返回 400
    const bad = await callRoute({ enabled: 'yes' })
    assert.equal(bad.status, 400)

    // 2. 开启网页目录选择器
    const resEnable = await callRoute({ enabled: true })
    assert.equal(resEnable.status, 200)
    assert.equal(resEnable.json.success, true)
    assert.equal(resEnable.json.changed, true)
    assert.equal(resEnable.json.directoryPicker.patchEnabled, true)

    // 3. 重复开启：幂等不报错，changed 为 false
    const resEnableAgain = await callRoute({ enabled: true })
    assert.equal(resEnableAgain.status, 200)
    assert.equal(resEnableAgain.json.changed, false)
    assert.equal(resEnableAgain.json.directoryPicker.patchEnabled, true)

    // 4. 关闭并恢复原生选择器
    const resDisable = await callRoute({ enabled: false })
    assert.equal(resDisable.status, 200)
    assert.equal(resDisable.json.changed, true)
    assert.equal(resDisable.json.directoryPicker.patchEnabled, false)
    assert.ok(readFileSync(tmpFile, 'utf8').includes('dsh-remote-mobile'))

    rmSync(tmpFile, { force: true })
  })
})
