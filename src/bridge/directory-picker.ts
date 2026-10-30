/**
 * DSH 目录选择器（Directory Picker）配置检测与幂等补丁管理模块
 *
 * 【背景与问题】
 * DSH 官方默认的 `id: directory-picker`（`@deepseek-ai/dsh-host-directory-picker-auto`）
 * 仅在进程启动时根据 `webServer.host` 是否为 127.0.0.1 回环地址来判断“本机 / 远程”：
 * - 本插件默认采用安全接入代理模式（DSH 核心保持 127.0.0.1:3080 回环，由 3081 代理对外）；
 * - `auto` 因此将所有来自手机端 3081 的请求误判为“本机桌面操作”，直接调用 PC 的系统原生文件选择窗（native）；
 * - 最终导致弹窗出现在 PC 屏幕上，手机浏览器一直转圈等待，无法在手机端选择文件夹或添加工作区。
 *
 * 【解决方案】
 * 1. 运行时检测：结合 Cordis loader 激活树与 `~/.dsh/profiles/web/cordis.patch.yml` 配置文件，
 *    精准判断当前是否已启用网页内目录选择器（`browse` 模式）；
 * 2. 幂等补丁写入：支持在设置页一键开启/恢复，写入时对 `directory-picker`、`directory-picker-browse`、
 *    `ui-directory-picker-browse` 三项分别执行严格结构化去重，绝不产生重复条目，且完整保留用户其它配置。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DSH_HOME } from '../auth/token.js'

export const AUTO_DIRECTORY_PICKER_ID = 'directory-picker'
export const AUTO_DIRECTORY_PICKER_PKG = '@deepseek-ai/dsh-host-directory-picker-auto'
export const HOST_DIRECTORY_PICKER_BROWSE_ID = 'directory-picker-browse'
export const HOST_DIRECTORY_PICKER_BROWSE_PKG = '@deepseek-ai/dsh-host-directory-picker-browse'
export const UI_DIRECTORY_PICKER_BROWSE_ID = 'ui-directory-picker-browse'
export const UI_DIRECTORY_PICKER_BROWSE_PKG = '@deepseek-ai/dsh-client-ui-directory-picker-browse'

/** 标准可复制/可注入的 YAML 配置片段 */
export const DIRECTORY_PICKER_YAML_SNIPPET = [
  '# 远程手机访问时固定使用应用内目录浏览器。',
  '#    DSH 的 dsh-host-directory-picker-auto 只根据 DSH 核心是否绑定 127.0.0.1 来判断“本机/远程”；',
  '#    本插件让核心保持回环、由 3081 代理对外，因此手机请求也被 auto 误判成“本机”，于是 native 选择器弹在 PC 上。',
  '#    可以用下面配置强制使用网页目录选择器。',
  '- id: directory-picker',
  '  disabled: true',
  '- insert:',
  '    - id: directory-picker-browse',
  "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
  '    - id: ui-directory-picker-browse',
  "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'",
].join('\n')

export interface DirectoryPickerPatchInspection {
  /** `- id: directory-picker` 是否已设置 `disabled: true` */
  autoDisabled: boolean
  /** 是否存在 `- id: directory-picker` 条目 */
  hasAutoEntry: boolean
  /** `@deepseek-ai/dsh-host-directory-picker-browse` 是否已插入且未禁用 */
  hostBrowseInserted: boolean
  /** `@deepseek-ai/dsh-client-ui-directory-picker-browse` 是否已插入且未禁用 */
  uiBrowseInserted: boolean
  /** 三项配置是否已在 patch 文件中全部就绪 */
  configured: boolean
  /** 是否仅配置了其中一部分（缺失其余项） */
  partial: boolean
}

export interface DirectoryPickerRuntimeInspection {
  /** 是否能够从 Cordis loader 探测到目录选择器相关条目 */
  detected: boolean
  /** 运行时中 `browse` 目录选择器（前后端）是否已激活生效 */
  browseActive: boolean
  /** 运行时中 `auto` 目录选择器是否仍处于启用状态 */
  autoActive: boolean
}

export interface DirectoryPickerStatus {
  /** 配置文件中是否已完整开启 browse 补丁 */
  patchEnabled: boolean
  /** 配置文件中是否仅开启了部分项 */
  patchPartial: boolean
  /** 当前运行时中网页目录选择器是否已生效 */
  runtimeActive: boolean
  /** 配置已变更但当前进程尚未生效（需要重启 DSH 或等待 HMR 重载） */
  restartRequired: boolean
  /** 当前是否需要向用户展示醒目提醒（回环核心且未开启 browse 时为 true） */
  needsWarning: boolean
  /** 目标 cordis.patch.yml 的绝对路径 */
  patchFilePath: string
  /** 标准可复制的 YAML 配置片段 */
  yamlSnippet: string
}

/** 运行时上下文绑定状态（由插件主入口 apply 注入） */
let boundCtx: any = null
let boundIsLoopbackCore: () => boolean = () => true

/**
 * 绑定 Cordis 运行时上下文与回环核心判定函数（供 /status 路由实时查询）
 */
export function bindDirectoryPickerRuntime(ctx: any, isLoopbackCore?: () => boolean): void {
  boundCtx = ctx
  if (typeof isLoopbackCore === 'function') {
    boundIsLoopbackCore = isLoopbackCore
  }
}

/**
 * 定位当前 DSH 的 web profile `cordis.patch.yml` 路径
 *
 * 优先使用 `~/.dsh/profiles/web/cordis.patch.yml`；若存在其他单 profile 则按优先级兜底。
 */
export function resolveDirectoryPickerPatchPath(customPath?: string): string {
  if (customPath && typeof customPath === 'string') return customPath

  const webPatch = join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')
  if (existsSync(webPatch)) return webPatch

  try {
    const profilesDir = join(DSH_HOME, 'profiles')
    if (existsSync(profilesDir)) {
      const dirs = readdirSync(profilesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
      if (dirs.includes('web')) return webPatch
      for (const d of dirs) {
        const candidate = join(profilesDir, d, 'cordis.patch.yml')
        if (existsSync(candidate)) return candidate
      }
    }
  } catch {}

  return webPatch
}

/**
 * 去除 YAML 标量值两端的单双引号与行尾注释
 */
function stripYamlScalar(raw: string): string {
  let val = raw.trim()
  // 若未加引号且带注释，剥离 # 注释
  if (!val.startsWith("'") && !val.startsWith('"') && val.includes('#')) {
    val = val.split('#')[0].trim()
  }
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.slice(1, -1).trim()
  }
  return val
}

interface ParsedSubItem {
  startLine: number
  endLine: number
  id: string
  name: string
  disabled: boolean | null
}

interface ParsedTopBlock {
  kind: 'entry' | 'insert' | 'other'
  startLine: number
  endLine: number
  id: string
  name: string
  disabled: boolean | null
  disabledLineIndex: number
  hasOtherKeys: boolean
  subItems: ParsedSubItem[]
}

/**
 * 将 cordis.patch.yml 按顶层列表项（`- ...`）解析为结构化块，便于精确检查、去重与移除
 */
function parsePatchBlocks(lines: string[]): ParsedTopBlock[] {
  const topIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^-\s+/.test(lines[i])) {
      topIndices.push(i)
    }
  }

  const blocks: ParsedTopBlock[] = []

  for (let idx = 0; idx < topIndices.length; idx++) {
    const startLine = topIndices[idx]
    let endLine = idx + 1 < topIndices.length ? topIndices[idx + 1] - 1 : lines.length - 1

    // 末尾的注释或空行如果不属于当前块（例如紧贴下一个块上方的注释），剥离出来
    while (endLine > startLine) {
      const l = lines[endLine].trim()
      if (l === '' || l.startsWith('#')) {
        endLine--
      } else {
        break
      }
    }

    const firstLine = lines[startLine]
    if (/^-\s*insert\s*:\s*(?:#.*)?$/.test(firstLine)) {
      // 解析 - insert: 下的子列表项
      const subStartIndices: number[] = []
      for (let i = startLine + 1; i <= endLine; i++) {
        if (/^\s+-\s+/.test(lines[i])) {
          subStartIndices.push(i)
        }
      }

      const subItems: ParsedSubItem[] = []
      for (let sIdx = 0; sIdx < subStartIndices.length; sIdx++) {
        const sStart = subStartIndices[sIdx]
        let sEnd = sIdx + 1 < subStartIndices.length ? subStartIndices[sIdx + 1] - 1 : endLine
        while (sEnd > sStart && (lines[sEnd].trim() === '' || lines[sEnd].trim().startsWith('#'))) {
          sEnd--
        }

        let itemId = ''
        let itemName = ''
        let itemDisabled: boolean | null = null

        for (let k = sStart; k <= sEnd; k++) {
          const text = lines[k].replace(/^\s*-\s*/, '').trim()
          const idMatch = text.match(/^id\s*:\s*(.+)$/)
          if (idMatch) itemId = stripYamlScalar(idMatch[1])
          const nameMatch = text.match(/^name\s*:\s*(.+)$/)
          if (nameMatch) itemName = stripYamlScalar(nameMatch[1])
          const disMatch = text.match(/^disabled\s*:\s*(.+)$/)
          if (disMatch) {
            const v = stripYamlScalar(disMatch[1]).toLowerCase()
            if (v === 'true') itemDisabled = true
            else if (v === 'false') itemDisabled = false
          }
        }

        subItems.push({
          startLine: sStart,
          endLine: sEnd,
          id: itemId,
          name: itemName,
          disabled: itemDisabled,
        })
      }

      blocks.push({
        kind: 'insert',
        startLine,
        endLine,
        id: '',
        name: '',
        disabled: null,
        disabledLineIndex: -1,
        hasOtherKeys: false,
        subItems,
      })
    } else {
      // 普通顶层条目（如 `- id: directory-picker`）
      let entryId = ''
      let entryName = ''
      let entryDisabled: boolean | null = null
      let disabledLineIndex = -1
      let hasOtherKeys = false

      for (let k = startLine; k <= endLine; k++) {
        const rawLine = lines[k]
        const trimmed = rawLine.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const clean = k === startLine ? rawLine.replace(/^-\s*/, '').trim() : trimmed
        const idMatch = clean.match(/^id\s*:\s*(.+)$/)
        if (idMatch) {
          entryId = stripYamlScalar(idMatch[1])
          continue
        }
        const nameMatch = clean.match(/^name\s*:\s*(.+)$/)
        if (nameMatch) {
          entryName = stripYamlScalar(nameMatch[1])
          continue
        }
        const disMatch = clean.match(/^disabled\s*:\s*(.+)$/)
        if (disMatch) {
          const v = stripYamlScalar(disMatch[1]).toLowerCase()
          if (v === 'true') entryDisabled = true
          else if (v === 'false') entryDisabled = false
          disabledLineIndex = k
          continue
        }
        hasOtherKeys = true
      }

      blocks.push({
        kind: entryId || entryName ? 'entry' : 'other',
        startLine,
        endLine,
        id: entryId,
        name: entryName,
        disabled: entryDisabled,
        disabledLineIndex,
        hasOtherKeys,
        subItems: [],
      })
    }
  }

  return blocks
}

function isHostBrowseItem(item: { id: string; name: string }): boolean {
  return item.name === HOST_DIRECTORY_PICKER_BROWSE_PKG || item.id === HOST_DIRECTORY_PICKER_BROWSE_ID
}

function isUiBrowseItem(item: { id: string; name: string }): boolean {
  return item.name === UI_DIRECTORY_PICKER_BROWSE_PKG || item.id === UI_DIRECTORY_PICKER_BROWSE_ID
}

function isAutoPickerBlock(block: ParsedTopBlock): boolean {
  return (
    block.kind === 'entry' &&
    (block.id === AUTO_DIRECTORY_PICKER_ID || block.name === AUTO_DIRECTORY_PICKER_PKG)
  )
}

/**
 * 解析 `cordis.patch.yml` 文本内容，检查目录选择器相关配置状态
 */
export function inspectDirectoryPickerPatchContent(content: string): DirectoryPickerPatchInspection {
  if (!content || typeof content !== 'string') {
    return {
      autoDisabled: false,
      hasAutoEntry: false,
      hostBrowseInserted: false,
      uiBrowseInserted: false,
      configured: false,
      partial: false,
    }
  }

  const lines = content.split(/\r?\n/)
  const blocks = parsePatchBlocks(lines)

  let hasAutoEntry = false
  let autoDisabled = false
  let hostBrowseInserted = false
  let uiBrowseInserted = false

  for (const block of blocks) {
    if (isAutoPickerBlock(block)) {
      hasAutoEntry = true
      autoDisabled = block.disabled === true
    } else if (block.kind === 'entry') {
      if (isHostBrowseItem(block) && block.disabled !== true) {
        hostBrowseInserted = true
      }
      if (isUiBrowseItem(block) && block.disabled !== true) {
        uiBrowseInserted = true
      }
    } else if (block.kind === 'insert') {
      for (const sub of block.subItems) {
        if (isHostBrowseItem(sub) && sub.disabled !== true) {
          hostBrowseInserted = true
        }
        if (isUiBrowseItem(sub) && sub.disabled !== true) {
          uiBrowseInserted = true
        }
      }
    }
  }

  const configured = autoDisabled && hostBrowseInserted && uiBrowseInserted
  const partial = !configured && (autoDisabled || hostBrowseInserted || uiBrowseInserted)

  return {
    autoDisabled,
    hasAutoEntry,
    hostBrowseInserted,
    uiBrowseInserted,
    configured,
    partial,
  }
}

/**
 * 检查 Cordis 运行时 loader 中的目录选择器插件激活状态
 */
export function inspectRuntimeDirectoryPicker(ctx: any = boundCtx): DirectoryPickerRuntimeInspection {
  try {
    const loader = typeof ctx?.get === 'function' ? ctx.get('loader') : ctx?.loader
    if (!loader || typeof loader.entries !== 'function') {
      return { detected: false, browseActive: false, autoActive: false }
    }

    const entries = [...loader.entries()]
    let sawPickerEntry = false
    let autoActive = false
    let hostBrowseActive = false
    let uiBrowseActive = false

    for (const entry of entries) {
      try {
        const id = typeof entry?.id === 'string' ? entry.id : ''
        const name = typeof entry?.options?.name === 'string' ? entry.options.name : ''
        const disabled = Boolean(entry?.disabled)

        if (id === AUTO_DIRECTORY_PICKER_ID || name === AUTO_DIRECTORY_PICKER_PKG) {
          sawPickerEntry = true
          if (!disabled) autoActive = true
        }
        if (id === HOST_DIRECTORY_PICKER_BROWSE_ID || name === HOST_DIRECTORY_PICKER_BROWSE_PKG) {
          sawPickerEntry = true
          if (!disabled) hostBrowseActive = true
        }
        if (id === UI_DIRECTORY_PICKER_BROWSE_ID || name === UI_DIRECTORY_PICKER_BROWSE_PKG) {
          sawPickerEntry = true
          if (!disabled) uiBrowseActive = true
        }
      } catch {}
    }

    if (!sawPickerEntry) {
      return { detected: false, browseActive: false, autoActive: false }
    }

    return {
      detected: true,
      browseActive: hostBrowseActive && uiBrowseActive && !autoActive,
      autoActive,
    }
  } catch {
    return { detected: false, browseActive: false, autoActive: false }
  }
}

/**
 * 幂等合并网页目录选择器配置到 `cordis.patch.yml` 内容中（严格去重）
 *
 * 去重规则：
 * 1. 若已存在一个或多个 `- id: directory-picker`：就地将其设为 `disabled: true`，合并重复项；
 * 2. 若已存在 `directory-picker-browse` 或 `ui-directory-picker-browse`（无论在哪个 `insert` 块下）：
 *    不重复插入，仅补充缺失的那一项（若原项被设为 `disabled: true` 则移除禁用标记）；
 * 3. 若三项均已就绪，原样返回，`changed: false`。
 */
export function applyDirectoryPickerBrowsePatch(rawContent: string): { content: string; changed: boolean } {
  const initialInspection = inspectDirectoryPickerPatchContent(rawContent)
  if (initialInspection.configured) {
    return { content: rawContent, changed: false }
  }

  const lines = rawContent ? rawContent.split(/\r?\n/) : []
  const blocks = parsePatchBlocks(lines)
  const linesToRemove = new Set<number>()

  // 1. 处理已有的 `- id: directory-picker` 块（就地更新首块，清除多余重复块）
  const autoBlocks = blocks.filter(isAutoPickerBlock)
  let autoHandledInPlace = false

  if (autoBlocks.length > 0) {
    const primary = autoBlocks[0]
    autoHandledInPlace = true
    if (primary.disabled !== true) {
      if (primary.disabledLineIndex !== -1) {
        lines[primary.disabledLineIndex] = '  disabled: true'
      } else {
        lines[primary.startLine] = `${lines[primary.startLine]}\n  disabled: true`
      }
    }
    // 若用户此前手误写了多个重复的 `- id: directory-picker`，清理后续重复项
    for (let i = 1; i < autoBlocks.length; i++) {
      const dup = autoBlocks[i]
      for (let k = dup.startLine; k <= dup.endLine; k++) {
        linesToRemove.add(k)
      }
    }
  }

  // 2. 检查已有的 browse 条目是否有被设为 disabled: true 的，若有则解除禁用
  for (const block of blocks) {
    if (block.kind === 'insert') {
      for (const sub of block.subItems) {
        if ((isHostBrowseItem(sub) || isUiBrowseItem(sub)) && sub.disabled === true) {
          for (let k = sub.startLine; k <= sub.endLine; k++) {
            if (/^\s*disabled\s*:\s*true\b/i.test(lines[k])) {
              linesToRemove.add(k)
            }
          }
        }
      }
    }
  }

  const filteredLines = lines.filter((_, idx) => !linesToRemove.has(idx))
  let intermediate = filteredLines.join('\n')
  const afterInPlace = inspectDirectoryPickerPatchContent(intermediate)

  const needAuto = !autoHandledInPlace && !afterInPlace.autoDisabled
  const needHostBrowse = !afterInPlace.hostBrowseInserted
  const needUiBrowse = !afterInPlace.uiBrowseInserted

  const appendLines: string[] = []
  const hasHeaderComment = intermediate.includes('dsh-host-directory-picker-auto') ||
    intermediate.includes('远程手机访问时固定使用应用内目录浏览器')

  if ((needAuto || needHostBrowse || needUiBrowse) && !hasHeaderComment) {
    appendLines.push(
      '# 远程手机访问时固定使用应用内目录浏览器。',
      '#    DSH 的 dsh-host-directory-picker-auto 只根据 DSH 核心是否绑定 127.0.0.1 来判断“本机/远程”；',
      '#    本插件让核心保持回环、由 3081 代理对外，因此手机请求也被 auto 误判成“本机”，于是 native 选择器弹在 PC 上。',
      '#    可以用下面配置强制使用网页目录选择器。'
    )
  }

  if (needAuto) {
    appendLines.push('- id: directory-picker', '  disabled: true')
  }

  if (needHostBrowse || needUiBrowse) {
    appendLines.push('- insert:')
    if (needHostBrowse) {
      appendLines.push(
        `    - id: ${HOST_DIRECTORY_PICKER_BROWSE_ID}`,
        `      name: '${HOST_DIRECTORY_PICKER_BROWSE_PKG}'`
      )
    }
    if (needUiBrowse) {
      appendLines.push(
        `    - id: ${UI_DIRECTORY_PICKER_BROWSE_ID}`,
        `      name: '${UI_DIRECTORY_PICKER_BROWSE_PKG}'`
      )
    }
  }

  if (appendLines.length > 0) {
    const trimmedBase = intermediate.replace(/\s+$/, '')
    intermediate = trimmedBase
      ? `${trimmedBase}\n\n${appendLines.join('\n')}\n`
      : `${appendLines.join('\n')}\n`
  } else if (intermediate && !intermediate.endsWith('\n')) {
    intermediate += '\n'
  }

  return {
    content: intermediate,
    changed: intermediate !== rawContent,
  }
}

/**
 * 判断一行注释是否属于目录选择器补丁自带的说明注释
 */
function isDirectoryPickerPatchComment(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('#')) return false
  return (
    trimmed.includes('远程手机访问时固定使用应用内目录浏览器') ||
    trimmed.includes('dsh-host-directory-picker-auto') ||
    trimmed.includes('native 选择器弹在 PC 上') ||
    trimmed.includes('强制使用网页目录选择器') ||
    trimmed.includes('directory-picker-browse')
  )
}

/**
 * 从 `cordis.patch.yml` 内容中安全移除网页目录选择器补丁（恢复 PC 原生目录选择器）
 *
 * 仅移除与 directory-picker 相关的禁用项与两个 browse 插入项，100% 保留用户其他配置。
 */
export function removeDirectoryPickerBrowsePatch(rawContent: string): { content: string; changed: boolean } {
  if (!rawContent || typeof rawContent !== 'string') {
    return { content: rawContent || '', changed: false }
  }

  const lines = rawContent.split(/\r?\n/)
  const blocks = parsePatchBlocks(lines)
  const linesToRemove = new Set<number>()

  // 1. 移除目录选择器补丁专属的说明注释行
  for (let i = 0; i < lines.length; i++) {
    if (isDirectoryPickerPatchComment(lines[i])) {
      linesToRemove.add(i)
    }
  }

  // 2. 处理各个结构化块
  for (const block of blocks) {
    if (isAutoPickerBlock(block)) {
      if (block.hasOtherKeys) {
        // 如果用户在 directory-picker 下还写了其他属性（如 config），仅移除 disabled 行
        if (block.disabledLineIndex !== -1) {
          linesToRemove.add(block.disabledLineIndex)
        }
      } else {
        for (let k = block.startLine; k <= block.endLine; k++) {
          linesToRemove.add(k)
        }
      }
    } else if (block.kind === 'entry' && (isHostBrowseItem(block) || isUiBrowseItem(block))) {
      for (let k = block.startLine; k <= block.endLine; k++) {
        linesToRemove.add(k)
      }
    } else if (block.kind === 'insert') {
      let remainingSubCount = 0
      for (const sub of block.subItems) {
        if (isHostBrowseItem(sub) || isUiBrowseItem(sub)) {
          for (let k = sub.startLine; k <= sub.endLine; k++) {
            linesToRemove.add(k)
          }
        } else {
          remainingSubCount++
        }
      }
      // 若该 `- insert:` 块下的所有子项均已被移除，则连同 `- insert:` 头一起清理
      if (remainingSubCount === 0 && block.subItems.length > 0) {
        for (let k = block.startLine; k <= block.endLine; k++) {
          linesToRemove.add(k)
        }
      }
    }
  }

  if (linesToRemove.size === 0) {
    return { content: rawContent, changed: false }
  }

  const keptLines = lines.filter((_, idx) => !linesToRemove.has(idx))
  // 折叠连续超过 2 行的空白行，保持文件整洁
  const normalizedLines: string[] = []
  let blankRun = 0
  for (const line of keptLines) {
    if (line.trim() === '') {
      blankRun++
      if (blankRun <= 1) normalizedLines.push('')
    } else {
      blankRun = 0
      normalizedLines.push(line)
    }
  }

  const joined = normalizedLines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '')
  const finalContent = joined ? `${joined}\n` : ''

  return {
    content: finalContent,
    changed: finalContent !== rawContent,
  }
}

/**
 * 原子写入目标 `cordis.patch.yml` 文件
 */
function atomicWritePatchFile(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(tmpPath, content, 'utf8')
    renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {}
    throw err
  }
}

/**
 * 获取目录选择器当前综合状态（供 `/api/remote-mobile/status` 与设置页消费）
 */
export function getDirectoryPickerStatus(customPatchPath?: string): DirectoryPickerStatus {
  const patchFilePath = resolveDirectoryPickerPatchPath(customPatchPath)
  let rawContent = ''
  try {
    if (existsSync(patchFilePath)) {
      rawContent = readFileSync(patchFilePath, 'utf8')
    }
  } catch {}

  const patchInfo = inspectDirectoryPickerPatchContent(rawContent)
  const runtimeInfo = inspectRuntimeDirectoryPicker()
  const isLoopback = boundIsLoopbackCore()

  // 若运行时 loader 可探测到目录选择器条目，则以 loader 实际状态为准；否则以配置文件状态为准
  const runtimeActive = runtimeInfo.detected ? runtimeInfo.browseActive : patchInfo.configured
  const restartRequired = runtimeInfo.detected ? patchInfo.configured !== runtimeInfo.browseActive : false

  // 当核心绑定在本地回环（如默认 proxy 模式）且既未在配置中开启 browse、运行时也未激活 browse 时，展示醒目提醒
  const needsWarning = isLoopback && !patchInfo.configured && !runtimeActive

  return {
    patchEnabled: patchInfo.configured,
    patchPartial: patchInfo.partial,
    runtimeActive,
    restartRequired,
    needsWarning,
    patchFilePath,
    yamlSnippet: DIRECTORY_PICKER_YAML_SNIPPET,
  }
}

/**
 * 在目标 `cordis.patch.yml` 中一键开启网页目录选择器（幂等去重）
 */
export function enableDirectoryPickerBrowse(customPatchPath?: string): DirectoryPickerStatus & { changed: boolean } {
  const patchFilePath = resolveDirectoryPickerPatchPath(customPatchPath)
  let rawContent = ''
  try {
    if (existsSync(patchFilePath)) {
      rawContent = readFileSync(patchFilePath, 'utf8')
    }
  } catch {}

  const { content, changed } = applyDirectoryPickerBrowsePatch(rawContent)
  if (changed || !existsSync(patchFilePath)) {
    atomicWritePatchFile(patchFilePath, content)
  }

  return {
    ...getDirectoryPickerStatus(patchFilePath),
    changed,
  }
}

/**
 * 从目标 `cordis.patch.yml` 中移除网页目录选择器配置（恢复 PC 原生目录选择器）
 */
export function disableDirectoryPickerBrowse(customPatchPath?: string): DirectoryPickerStatus & { changed: boolean } {
  const patchFilePath = resolveDirectoryPickerPatchPath(customPatchPath)
  if (!existsSync(patchFilePath)) {
    return {
      ...getDirectoryPickerStatus(patchFilePath),
      changed: false,
    }
  }

  const rawContent = readFileSync(patchFilePath, 'utf8')
  const { content, changed } = removeDirectoryPickerBrowsePatch(rawContent)
  if (changed) {
    atomicWritePatchFile(patchFilePath, content)
  }

  return {
    ...getDirectoryPickerStatus(patchFilePath),
    changed,
  }
}

