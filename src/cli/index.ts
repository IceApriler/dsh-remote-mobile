#!/usr/bin/env node
/**
 * dsh-remote-mobile 命令行工具（headless 服务器友好）
 *
 * 【为什么需要它】
 * 配对码只能在「本机 Web UI → 设置 → 远程与移动端」里生成，长期密码同样如此。
 * 在没有图形界面的服务器（systemd / 容器 / SSH-only）上，用户只能手写 curl 去调
 * `http://127.0.0.1:3081/api/remote-mobile/...`，既容易记错端口，也容易把密码留在
 * shell 历史里。本命令把这两件事做成两个一等子命令：
 *
 *   dsh-remote-mobile code        查看/生成配对码（不刷新屏幕上已有的有效码）
 *   dsh-remote-mobile password    设置 / 更新 / 清除长期访问密码
 *
 * 两个命令都优先与「正在运行的 DSH」通信（保证配对码就是服务端真正会接受的那个），
 * 探测不到时 `password` 还能直接以同等强度写入 settings.json，支持「先设密码再起服务」。
 *
 * 使用 `--json` 可获得机器可读输出，方便脚本 / 自动化集成。
 */

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateSecretStrength } from '../auth/crypto.js'
import {
  candidateBaseUrls,
  clearLongTermPassword,
  findEndpoint,
  generatePairingCode,
  readLocalSettings,
  resolveDshHome,
  setLongTermPassword,
  settingsFilePath,
  writePasswordOffline,
  DEFAULT_ACTION_TIMEOUT_MS,
  type CliClientOptions,
  type RemoteMobileStatus,
} from './client.js'

/** 动作请求默认超时（与 client 层保持一致，便于文档与测试引用） */
const DEFAULT_TIMEOUT_MS = DEFAULT_ACTION_TIMEOUT_MS

/** 解析后的命令行 */
export interface ParsedArgs {
  command: 'code' | 'password' | 'help' | 'version' | null
  options: CliClientOptions & {
    newCode?: boolean
    stdin?: boolean
    offline?: boolean
    clear?: boolean
    json?: boolean
  }
  positionals: string[]
  error?: string
}

const USAGE = `dsh-remote-mobile — DSH 远程接入命令行工具（无 GUI 服务器友好）

用法:
  dsh-remote-mobile code [选项]              查看或生成配对码
  dsh-remote-mobile password [选项] [密码]   设置 / 更新 / 清除长期访问密码

通用选项:
  --base-url <url>    直接指定 DSH 地址（如 http://127.0.0.1:3081）
  --port <n>          指定端口（默认按 settings.json 的 proxyPort 与 3080/3081 等探测）
  --host <ip>         指定主机（默认 127.0.0.1 与本机网卡 IP）
  --token <token>     直连模式下携带已配对设备令牌（Authorization: Bearer）
  --timeout <ms>      动作请求超时，默认 8000（探测阶段自动收敛为 2000）
  --dsh-home <path>   DSH 主目录，默认 $DSH_HOME 或 ~/.dsh
  --json              输出机器可读 JSON
  -h, --help          显示帮助
  -V, --version       显示版本

code 选项:
  --new               强制刷新配对码（默认优先显示当前仍然有效的码）

password 选项:
  --stdin             从标准输入读取密码（推荐脚本使用）
  --offline           跳过运行中的服务，直接写入 settings.json
  --clear             清除长期访问密码

示例:
  dsh-remote-mobile code
  dsh-remote-mobile code --json | jq -r .code
  dsh-remote-mobile password --stdin < /run/secrets/dsh-pass
  echo 'MyStr0ngPass' | dsh-remote-mobile password --stdin
  dsh-remote-mobile password --clear
`

/**
 * 解析命令行参数
 * @param argv - 不含 node 与脚本路径的参数
 * @returns 解析结果
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const options: ParsedArgs['options'] = {}
  const positionals: string[] = []
  let command: ParsedArgs['command'] = null

  const takeValue = (index: number, flag: string): { value?: string; nextIndex: number; error?: string } => {
    const inline = argv[index].includes('=') ? argv[index].slice(argv[index].indexOf('=') + 1) : undefined
    if (inline !== undefined) return { value: inline, nextIndex: index }
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('-')) {
      return { value: undefined, nextIndex: index, error: `${flag} 需要一个值` }
    }
    return { value: next, nextIndex: index + 1 }
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') return { command: 'help', options, positionals }
    if (arg === '-V' || arg === '--version') return { command: 'version', options, positionals }

    if (arg === 'code' || arg === 'password') {
      if (command) return { command, options, positionals, error: `只能指定一个子命令（收到 ${command} 与 ${arg}）` }
      command = arg
      continue
    }

    if (arg.startsWith('--base-url')) {
      const taken = takeValue(i, '--base-url')
      if (taken.error) return { command, options, positionals, error: taken.error }
      options.baseUrl = taken.value
      i = taken.nextIndex
      continue
    }
    if (arg.startsWith('--port')) {
      const taken = takeValue(i, '--port')
      if (taken.error) return { command, options, positionals, error: taken.error }
      const port = Number(taken.value)
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return { command, options, positionals, error: `--port 需要 1-65535 的整数，收到 ${taken.value}` }
      }
      options.port = port
      i = taken.nextIndex
      continue
    }
    if (arg.startsWith('--host')) {
      const taken = takeValue(i, '--host')
      if (taken.error) return { command, options, positionals, error: taken.error }
      options.host = taken.value
      i = taken.nextIndex
      continue
    }
    if (arg.startsWith('--token')) {
      const taken = takeValue(i, '--token')
      if (taken.error) return { command, options, positionals, error: taken.error }
      options.token = taken.value
      i = taken.nextIndex
      continue
    }
    if (arg.startsWith('--timeout')) {
      const taken = takeValue(i, '--timeout')
      if (taken.error) return { command, options, positionals, error: taken.error }
      const timeout = Number(taken.value)
      if (!Number.isInteger(timeout) || timeout <= 0) {
        return { command, options, positionals, error: `--timeout 需要正整数毫秒，收到 ${taken.value}` }
      }
      options.timeoutMs = timeout
      i = taken.nextIndex
      continue
    }
    if (arg.startsWith('--dsh-home')) {
      const taken = takeValue(i, '--dsh-home')
      if (taken.error) return { command, options, positionals, error: taken.error }
      options.dshHome = taken.value
      i = taken.nextIndex
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--new') {
      options.newCode = true
      continue
    }
    if (arg === '--stdin') {
      options.stdin = true
      continue
    }
    if (arg === '--offline') {
      options.offline = true
      continue
    }
    if (arg === '--clear') {
      options.clear = true
      continue
    }
    if (arg.startsWith('-')) {
      return { command, options, positionals, error: `未知选项 ${arg}（用 --help 查看用法）` }
    }
    positionals.push(arg)
  }

  return { command, options, positionals }
}

/**
 * 把毫秒格式化为「x 分 y 秒」
 * @param ms - 剩余毫秒
 * @returns 可读时长
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes <= 0) return `${seconds} 秒`
  return `${minutes} 分 ${seconds} 秒`
}

/**
 * 把时间戳格式化为 HH:MM:SS
 * @param timestamp - 毫秒时间戳
 * @returns 本地时间
 */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 配对码报告所需的上下文 */
export interface CodeReportContext {
  code: string
  expiresAt: number
  baseUrl: string
  status: RemoteMobileStatus
  /** true 表示这是窥视到的既有有效码，false 表示本次新生成 */
  reused: boolean
  now?: number
}

/**
 * 渲染配对码文本报告（供终端阅读）
 * @param context - 配对码与访问地址上下文
 * @returns 多行文本
 */
export function formatCodeReport(context: CodeReportContext): string {
  const now = context.now ?? Date.now()
  const remaining = Math.max(0, context.expiresAt - now)
  const mode = context.status.proxy?.mode === 'direct' ? 'direct' : 'proxy'
  // direct 模式没有独立代理端口，手机直连的就是核心端口；proxy 模式才是安全接入代理端口
  const corePort = context.status.proxy?.corePort || 3080
  const port = mode === 'direct' ? corePort : context.status.proxy?.activePort || context.status.proxy?.proxyPort || 3081
  const lanIp = context.status.lanIp || ''
  const tsIp = context.status.tailscaleIp || ''
  const lines: string[] = []

  lines.push(`配对码   ${context.code}`)
  lines.push(`有效期   ${formatDuration(remaining)}（至 ${formatClock(context.expiresAt)}）`)
  lines.push(context.reused ? '来源     当前仍然有效的配对码（未刷新）' : '来源     本次新生成')

  const entries: string[] = []
  if (lanIp && lanIp !== '127.0.0.1') entries.push(`局域网     http://${lanIp}:${port}`)
  if (tsIp) entries.push(`虚拟私网   http://${tsIp}:${port}（Tailscale）`)
  const entryHost = lanIp && lanIp !== '127.0.0.1' ? lanIp : tsIp || '127.0.0.1'
  entries.push(`配对入口   http://${entryHost}:${port}/auth`)

  lines.push('访问地址')
  for (const entry of entries) lines.push(`  ${entry}`)

  lines.push(`服务       ${context.baseUrl}（${mode} 模式，核心端口 ${corePort}）`)
  if (mode === 'proxy' && context.status.proxy?.running === false) {
    lines.push('提示       安全接入代理当前未运行，手机可能无法连接；请检查 3081 端口占用')
  }
  lines.push('')
  lines.push('在手机浏览器打开「配对入口」，输入上面的 6 位配对码即可完成配对。')
  return lines.join('\n')
}

/** 执行码命令的选项 */
export interface RunCodeOptions {
  options: ParsedArgs['options']
  stdout: (text: string) => void
  stderr: (text: string) => void
}

/**
 * 执行 `code` 子命令
 * @param params - 解析后的选项与输出通道
 * @returns 进程退出码
 */
export async function runCodeCommand(params: RunCodeOptions): Promise<number> {
  const { options, stdout, stderr } = params
  const dshHome = resolveDshHome(options.dshHome)
  const endpoint = await findEndpoint(options)

  if (!endpoint) {
    const tried = candidateBaseUrls(options)
    stderr('未找到正在运行的 DSH（dsh-remote-mobile 服务无法连接）。\n')
    stderr('已尝试以下地址：\n')
    for (const url of tried.slice(0, 8)) stderr(`  • ${url}\n`)
    if (tried.length > 8) stderr(`  …共 ${tried.length} 个地址\n`)
    stderr('\n排查建议：\n')
    stderr('  1. 确认 DSH 正在运行（dsh web / systemd 服务）；\n')
    stderr('  2. 自定义端口时用 --port 或 --base-url 指定，例如 --port 3081；\n')
    stderr(`  3. 配置文件位于 ${settingsFilePath(dshHome)}（proxyPort 会作为首选候选端口）。\n`)
    return 1
  }

  const { baseUrl, status } = endpoint
  const existing = status.pairingCode
  const now = Date.now()

  let code = ''
  let expiresAt = 0
  let reused = false

  if (!options.newCode && existing && existing.code && existing.expiresAt > now) {
    code = String(existing.code)
    expiresAt = Number(existing.expiresAt)
    reused = true
  } else {
    const generated = await generatePairingCode(baseUrl, options)
    if (!generated.ok || !generated.code) {
      stderr(`生成配对码失败：${generated.error || '未知错误'}\n`)
      return 1
    }
    code = generated.code
    expiresAt = generated.expiresAt || now
  }

  if (options.json) {
    const mode = status.proxy?.mode === 'direct' ? 'direct' : 'proxy'
    const corePort = status.proxy?.corePort || 3080
    const port =
      mode === 'direct' ? corePort : status.proxy?.activePort || status.proxy?.proxyPort || 3081
    const host = status.lanIp && status.lanIp !== '127.0.0.1' ? status.lanIp : status.tailscaleIp || '127.0.0.1'
    stdout(
      JSON.stringify(
        {
          ok: true,
          code,
          expiresAt,
          expiresInSeconds: Math.max(0, Math.round((expiresAt - now) / 1000)),
          reused,
          baseUrl,
          mode,
          port,
          accessUrls: {
            lan: status.lanIp ? `http://${status.lanIp}:${port}` : null,
            tailscale: status.tailscaleIp ? `http://${status.tailscaleIp}:${port}` : null,
            auth: `http://${host}:${port}/auth`,
          },
        },
        null,
        2
      ) + '\n'
    )
    return 0
  }

  stdout(formatCodeReport({ code, expiresAt, baseUrl, status, reused, now }) + '\n')
  return 0
}

/** 执行密码命令的选项 */
export interface RunPasswordOptions {
  options: ParsedArgs['options']
  secret?: string
  stdout: (text: string) => void
  stderr: (text: string) => void
}

/**
 * 执行 `password` 子命令
 * @param params - 解析后的选项、明文密码与输出通道
 * @returns 进程退出码
 */
export async function runPasswordCommand(params: RunPasswordOptions): Promise<number> {
  const { options, stdout, stderr } = params
  const dshHome = resolveDshHome(options.dshHome)
  const clearing = options.clear === true

  let secret = (params.secret || '').trim()
  if (!clearing) {
    if (!secret) {
      stderr('未提供密码：请用交互式输入、--stdin 或位置参数传入。\n')
      return 2
    }
    const check = validateSecretStrength(secret)
    if (!check.valid) {
      stderr(`密码强度不足：${check.reason || '请使用更复杂的密码'}\n`)
      return 1
    }
  }

  const endpoint = options.offline ? null : await findEndpoint(options)

  if (endpoint) {
    const result = clearing
      ? await clearLongTermPassword(endpoint.baseUrl, options)
      : await setLongTermPassword(endpoint.baseUrl, secret, options)
    if (!result.ok) {
      stderr(`设置失败：${result.error || '未知错误'}\n`)
      return 1
    }
    if (options.json) {
      stdout(JSON.stringify({ ok: true, cleared: clearing, baseUrl: endpoint.baseUrl, applied: 'live' }, null, 2) + '\n')
      return 0
    }
    stdout(clearing ? `已清除长期访问密码（${endpoint.baseUrl}，立即生效）\n` : `长期访问密码已更新（${endpoint.baseUrl}，立即生效）\n`)
    return 0
  }

  const written = writePasswordOffline(dshHome, clearing ? '' : secret)
  if (!written.ok) {
    stderr(`写入配置失败：${written.error || '未知错误'}\n`)
    return 1
  }
  if (options.json) {
    stdout(
      JSON.stringify(
        {
          ok: true,
          cleared: clearing,
          path: written.path,
          applied: 'offline',
          note: 'DSH 未在运行或端口不可达，配置已写入文件；下次启动 dsh web 后生效',
        },
        null,
        2
      ) + '\n'
    )
    return 0
  }
  stdout(
    (clearing ? '已清除长期访问密码' : '长期访问密码已写入') +
      `：${written.path}\n` +
      '注意：未连接到运行中的 DSH，该改动将在下次启动 dsh web 时生效。\n' +
      '      如果 DSH 其实正在运行，请用 --port / --base-url 指定正确端口后重试，以免配置被运行中的进程覆盖。\n'
  )
  return 0
}

/**
 * 隐藏回显读取密码（仅 TTY 可用）
 * @param prompt - 提示文本
 * @returns 输入的明文
 */
export async function promptHidden(prompt: string): Promise<string> {
  const stdin = process.stdin
  const stdout = process.stdout
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('当前不是交互式终端，请改用 --stdin 或位置参数')
  }
  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')

  return new Promise<string>((resolve, reject) => {
    let value = ''
    const cleanup = () => {
      try {
        stdin.setRawMode(false)
      } catch {}
      stdin.pause()
      stdin.removeListener('data', onData)
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup()
          stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') {
          cleanup()
          stdout.write('\n')
          reject(new Error('已取消'))
          return
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += char
      }
    }
    stdin.on('data', onData)
  })
}

/**
 * 从标准输入读取全部内容（去掉结尾换行）
 * @returns 明文
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

/**
 * CLI 主入口
 * @param argv - 不含 node 与脚本路径的参数
 * @returns 进程退出码
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv)

  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}`)
    return 2
  }

  if (parsed.command === 'help' || (!parsed.command && argv.length === 0)) {
    process.stdout.write(USAGE)
    return 0
  }
  if (parsed.command === 'version') {
    process.stdout.write(`${readCliVersion()}\n`)
    return 0
  }

  const stdout = (text: string) => process.stdout.write(text)
  const stderr = (text: string) => process.stderr.write(text)

  if (parsed.command === 'code') {
    return runCodeCommand({ options: parsed.options, stdout, stderr })
  }

  // password
  let secret = parsed.positionals[0]
  const fromPositionalArg = Boolean(secret)
  if (!parsed.options.clear && !secret) {
    if (parsed.options.stdin) {
      secret = (await readStdin()).trim()
    } else if (process.stdin.isTTY) {
      try {
        const first = await promptHidden('请输入新的长期访问密码（输入不回显）：')
        const second = await promptHidden('请再次输入以确认：')
        if (first !== second) {
          stderr('两次输入不一致，已取消。\n')
          return 1
        }
        secret = first
      } catch (error: any) {
        stderr(`${error?.message || error}\n`)
        return 2
      }
    }
  }

  // 仅位置参数会把明文留在 shell 历史里；--stdin 与交互式输入不应触发该提示
  if (fromPositionalArg) {
    stderr('提示：密码通过命令行参数传入会留在 shell 历史中，建议改用交互式输入或 --stdin。\n')
  }

  return runPasswordCommand({ options: parsed.options, secret, stdout, stderr })
}

/** 读取本包版本号（失败时返回 unknown，绝不因读取失败影响命令可用性） */
function readCliVersion(): string {
  try {
    // 与 index.ts 一致：从安装包 package.json 读取，避免重复维护版本常量
    const version = process.env.DSH_REMOTE_MOBILE_VERSION
    if (version) return version
    const manifest = fileURLToPath(new URL('../../package.json', import.meta.url))
    return String(JSON.parse(readFileSync(manifest, 'utf8')).version || 'unknown')
  } catch {
    return 'unknown'
  }
}

/** 判断当前模块是否作为可执行入口被直接运行（被 import 时不自动执行） */
function isDirectRun(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectRun()) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(`dsh-remote-mobile: ${error?.message || error}\n`)
      process.exitCode = 1
    })
}

export { DEFAULT_TIMEOUT_MS, readLocalSettings }
