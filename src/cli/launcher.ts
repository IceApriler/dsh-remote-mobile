/**
 * 命令行工具自动落位（让「一行安装」真的能用）
 *
 * 【要解决的问题】
 * 插件通过 `dsh plugin --profile web add dsh-remote-mobile` 安装后，可执行文件只会被
 * 链接到 `<profile>/node_modules/.bin/`——那个目录并不在用户的 `PATH` 里。于是即便
 * `package.json` 声明了 `bin`，用户在服务器上敲 `dsh-remote-mobile` 依然得到
 * `未找到命令`，只能手动 `cd` 到 profile 目录 `npx`，或自己写包装脚本。
 *
 * 【做法】
 * 插件激活时把 CLI「落位」到用户级 bin 目录（POSIX 平台默认 `~/.local/bin`，
 * 现代发行版的 `~/.profile` 已默认把它加入 `PATH`）：
 *
 * - 写入一个**三行包装脚本**而不是软链接：软链接指向的 `.js` 需要可执行位，
 *   `file:` 安装 / 手工拷贝 / 后续升级都可能把权限位丢掉；包装脚本只 `exec node <绝对路径>`，
 *   不依赖目标文件的可执行位，也不受 shebang 解析影响。
 * - **幂等且自愈**：内容一致则完全不动文件；路径变了（换 profile、升级后目录变化）
 *   则重写。全局安装 `npm i -g` 的场景下本函数不会覆盖已有的 `bin`。
 * - **绝不阻断启动**：任何异常（只读 HOME、权限不足、容器只读层）都只是返回失败原因，
 *   由调用方在 Banner 里提示手动命令，不影响插件本身。
 * - Windows 跳过：`~/.local/bin` 不在 PATH 体系内，那边用 `npx dsh-remote-mobile` 或全局安装。
 */

import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 落位结果 */
export interface CliLauncherResult {
  /** 是否已有一个可直接执行的 dsh-remote-mobile 命令就绪 */
  ok: boolean
  /** 是否本次新写入/更新了包装脚本（false 表示原本就一致） */
  updated?: boolean
  /** 包装脚本路径 */
  path?: string
  /** 包装脚本指向的 CLI 入口绝对路径 */
  target?: string
  /** 该目录是否已在 PATH 中（不在时调用方应提示用户） */
  onPath?: boolean
  /** 落位位置：与 dsh 同目录（PATH 与 dsh 完全一致）/ 用户级 ~/.local/bin */
  location?: 'dsh-bin' | 'user-bin'
  /** 跳过或失败的原因 */
  reason?: string
}

/** 落位选项（测试可注入，生产一律用默认值） */
export interface CliLauncherOptions {
  /** 当前平台，默认 process.platform */
  platform?: NodeJS.Platform
  /** 用户主目录，默认 os.homedir() */
  home?: string
  /** 本包根目录，默认由 import.meta.url 推导 */
  packageRoot?: string
  /** 当前 PATH，默认 process.env.PATH */
  pathEnv?: string
  /** 目标目录名，默认 .local/bin（相对 home） */
  binDirRelative?: string
  /**
   * 强制指定「dsh 所在目录」：`undefined` 时按 PATH 自动探测，传字符串则据此判断可写性，
   * 传 null 表示禁用该策略（仅测试使用）
   */
  dshBinDir?: string | null
}

/** 可执行文件名 */
export const CLI_LAUNCHER_NAME = 'dsh-remote-mobile'

/**
 * 推导本包根目录（`lib/cli/launcher.js` → 包根）
 * @returns 包根绝对路径
 */
export function resolvePackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

/**
 * 在 PATH 中找到 `dsh` 可执行文件所在目录
 *
 * 目的：把 CLI 放到**和 `dsh` 同一个目录**，它的可达性就与 `dsh` 完全一致
 * （包括 `ssh host 'cmd'` 这类非登录 shell、systemd、cron）。典型可写场景是
 * nvm / volta / 用户级 npm prefix（`npm i -g` 装到 `~/.npm-global/bin`）等。
 *
 * @param pathEnv - 待搜索的 PATH
 * @param dshName - 可执行文件名，默认 dsh
 * @returns 目录绝对路径；找不到返回 null
 */
export function findDshBinDir(pathEnv = process.env.PATH || '', dshName = 'dsh'): string | null {
  for (const entry of pathEnv.split(delimiter)) {
    const dir = entry.trim()
    if (!dir) continue
    try {
      accessSync(join(dir, dshName), constants.X_OK)
      return dir
    } catch {}
  }
  return null
}

/**
 * 判断目录对当前用户是否可写（可写才敢往里放文件）
 * @param dir - 目录绝对路径
 * @returns 是否可写
 */
export function isDirWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 生成包装脚本内容
 * @param target - CLI 入口绝对路径
 * @returns POSIX shell 脚本文本
 */
export function buildLauncherScript(target: string): string {
  return [
    '#!/bin/sh',
    '# 由 dsh-remote-mobile 插件自动生成：无需手动配置 PATH，插件升级后本脚本自动跟随。',
    '# 卸载插件后可安全删除本文件。',
    `exec node ${JSON.stringify(target)} "$@"`,
    '',
  ].join('\n')
}

/**
 * 判断某个目录是否已在 PATH 中
 * @param dir - 绝对目录
 * @param pathEnv - PATH 字符串
 * @returns 是否命中
 */
export function isDirOnPath(dir: string, pathEnv = process.env.PATH || ''): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+$/, '')
  const wanted = normalize(dir)
  // 用平台分隔符切分（POSIX ':' / Windows ';'）：Windows 盘符自带冒号，不能按 ':' 切
  return pathEnv
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => normalize(entry) === wanted)
}

/** 会在交互式登录时执行的 shell 启动文件（按常见发行版与 shell 排序） */
const SHELL_STARTUP_FILES = ['.profile', '.bash_profile', '.bash_login', '.bashrc', '.zprofile', '.zshrc']

/**
 * 判断目录是否会出现在用户的「登录 shell」PATH 中
 *
 * DSH 通常由 systemd / 守护进程启动，其 `PATH` 与用户登录 shell 的 `PATH` 并不相同：
 * Ubuntu 等发行版的 `~/.profile` 会自动追加 `~/.local/bin`，而 systemd 进程的 PATH 里没有。
 * 只按进程 `PATH` 判断会把「用户登录后其实能直接敲」误报成「不在 PATH」，
 * 因此这里额外检查 shell 启动文件：出现 `$HOME/.local/bin` 这类路径即认为可达。
 *
 * @param dir - 目标目录绝对路径
 * @param home - 用户主目录
 * @param pathEnv - 当前进程 PATH（默认 process.env.PATH）
 * @returns 交互式登录后是否可直接执行
 */
export function isCliDirReachable(
  dir: string,
  home: string,
  pathEnv = process.env.PATH || ''
): boolean {
  if (isDirOnPath(dir, pathEnv)) return true
  const needle = '.local/bin'
  if (!dir.replace(/\\/g, '/').includes(needle)) return false
  for (const file of SHELL_STARTUP_FILES) {
    try {
      if (readFileSync(join(home, file), 'utf8').includes(needle)) return true
    } catch {}
  }
  return false
}

/**
 * 把 CLI 落位到用户级 bin 目录（幂等）
 *
 * @param options - 可注入的平台、主目录、包根与 PATH（仅测试使用）
 * @returns 落位结果；任何失败都以 `ok: false` 返回，绝不抛出
 */
export function ensureCliLauncher(options: CliLauncherOptions = {}): CliLauncherResult {
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  const packageRoot = options.packageRoot ?? resolvePackageRoot()
  const pathEnv = options.pathEnv ?? process.env.PATH ?? ''
  const binDirRelative = options.binDirRelative ?? join('.local', 'bin')

  if (platform === 'win32') {
    return { ok: false, reason: 'windows' }
  }
  if (!home) {
    return { ok: false, reason: 'no-home' }
  }

  const target = join(packageRoot, 'lib', 'cli', 'index.js')
  if (!existsSync(target)) {
    return { ok: false, reason: 'cli-missing', target }
  }

  // 优先放到「dsh 自己所在的目录」：这样可达性与 dsh 完全一致（含非登录 shell / systemd / cron）。
  // 该目录通常属于 root（/usr/bin）不可写，此时退回用户级 ~/.local/bin。
  const dshBinDir = options.dshBinDir === undefined ? findDshBinDir(pathEnv) : options.dshBinDir
  let binDir = join(home, binDirRelative)
  let location: 'dsh-bin' | 'user-bin' = 'user-bin'
  if (dshBinDir && isDirWritable(dshBinDir)) {
    binDir = dshBinDir
    location = 'dsh-bin'
  }

  const scriptPath = join(binDir, CLI_LAUNCHER_NAME)
  const script = buildLauncherScript(target)

  try {
    if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true })
    let updated = false
    if (!existsSync(scriptPath) || readFileSync(scriptPath, 'utf8') !== script) {
      writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o755 })
      updated = true
    }
    // 某些文件系统（Windows 挂载盘、只读层）会忽略 mode，显式补一次权限
    try {
      chmodSync(scriptPath, 0o755)
    } catch {}
    return {
      ok: true,
      updated,
      path: scriptPath,
      target,
      location,
      // 与 dsh 同目录时天然在 PATH 内；否则再兼顾一下登录 shell 的 startup 文件
      onPath: location === 'dsh-bin' ? true : isCliDirReachable(binDir, home, pathEnv),
    }
  } catch (error: any) {
    // 与 dsh 同目录但写入失败（例如只读 /usr/bin）时，退回用户级目录再试一次
    if (location === 'dsh-bin') {
      try {
        const fallbackDir = join(home, binDirRelative)
        if (!existsSync(fallbackDir)) mkdirSync(fallbackDir, { recursive: true })
        const fallbackPath = join(fallbackDir, CLI_LAUNCHER_NAME)
        writeFileSync(fallbackPath, script, { encoding: 'utf8', mode: 0o755 })
        try {
          chmodSync(fallbackPath, 0o755)
        } catch {}
        return {
          ok: true,
          updated: true,
          path: fallbackPath,
          target,
          location: 'user-bin',
          onPath: isCliDirReachable(fallbackDir, home, pathEnv),
        }
      } catch {}
    }
    return { ok: false, reason: error?.message || String(error), path: scriptPath, target }
  }
}

/**
 * 把落位结果转成人类可读的一行说明（供启动 Banner 使用）
 * @param result - 落位结果
 * @returns 说明文本
 */
export function describeCliLauncher(result: CliLauncherResult): string {
  if (!result.ok) {
    if (result.reason === 'windows') return `CLI      Windows 请用 npx ${CLI_LAUNCHER_NAME}（或 npm i -g）`
    const hint = process.env.DSH_HOME
      ? `npx --prefix "$DSH_HOME/profiles/web" ${CLI_LAUNCHER_NAME}`
      : `npx ${CLI_LAUNCHER_NAME}`
    return `CLI      自动落位未成功（${result.reason || '未知原因'}），可临时用：${hint}`
  }
  if (result.location === 'dsh-bin' && result.onPath) {
    return `CLI      ${CLI_LAUNCHER_NAME} 已就绪（与 dsh 同目录，所有 shell 均可用）`
  }
  if (result.onPath) {
    return `CLI      ${CLI_LAUNCHER_NAME} 已就绪：直接执行 ${CLI_LAUNCHER_NAME} code / password`
  }
  return `CLI      已生成 ${result.path}，但该目录不在 PATH，请执行：echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc`
}
