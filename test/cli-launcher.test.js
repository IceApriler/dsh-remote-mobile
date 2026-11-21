import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  buildLauncherScript,
  ensureCliLauncher,
  isDirOnPath,
  isCliDirReachable,
  describeCliLauncher,
  CLI_LAUNCHER_NAME,
} from '../lib/cli/launcher.js'

/**
 * 命令行工具自动落位测试
 *
 * 背景：`dsh plugin --profile web add dsh-remote-mobile` 只会在 profile 的
 * node_modules/.bin 里建链接，而该目录不在 PATH，用户执行 `dsh-remote-mobile`
 * 会得到「未找到命令」。插件激活时需要把可执行包装脚本落位到 ~/.local/bin。
 */

/** 构造一个「包根 + 假 CLI 入口 + 假 HOME」的临时环境 */
function createEnv({ withCli = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-rm-launcher-'))
  const packageRoot = join(root, 'pkg')
  const home = join(root, 'home')
  mkdirSync(join(packageRoot, 'lib', 'cli'), { recursive: true })
  mkdirSync(home, { recursive: true })
  if (withCli) {
    writeFileSync(join(packageRoot, 'lib', 'cli', 'index.js'), '#!/usr/bin/env node\n', 'utf8')
  }
  return {
    root,
    packageRoot,
    home,
    target: join(packageRoot, 'lib', 'cli', 'index.js'),
    script: join(home, '.local', 'bin', CLI_LAUNCHER_NAME),
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {}
    },
  }
}

test('命令行工具自动落位 (ensureCliLauncher)', async (t) => {
  await t.test('Windows 平台直接跳过（改用 npx / 全局安装）', () => {
    const env = createEnv()
    try {
      const result = ensureCliLauncher({ platform: 'win32', home: env.home, packageRoot: env.packageRoot })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'windows')
      assert.equal(existsSync(env.script), false)
    } finally {
      env.cleanup()
    }
  })

  await t.test('POSIX：在 ~/.local/bin 生成指向本包 CLI 的包装脚本', () => {
    const env = createEnv()
    try {
      const result = ensureCliLauncher({
        platform: 'linux',
        home: env.home,
        packageRoot: env.packageRoot,
        pathEnv: ['/usr/local/bin', '/usr/bin', '/bin'].join(delimiter),
      })
      assert.equal(result.ok, true)
      assert.equal(result.updated, true)
      assert.equal(result.path, env.script)
      assert.equal(result.target, env.target)
      assert.equal(result.onPath, false)

      const content = readFileSync(env.script, 'utf8')
      assert.match(content, /^#!\/bin\/sh/)
      assert.ok(content.includes(JSON.stringify(env.target)), '包装脚本必须指向当前安装位置')
      assert.match(content, /exec node /)
      assert.match(content, /"\$@"/, '必须原样透传参数')
    } finally {
      env.cleanup()
    }
  })

  await t.test('幂等：内容一致时不重写文件', () => {
    const env = createEnv()
    try {
      const first = ensureCliLauncher({ platform: 'linux', home: env.home, packageRoot: env.packageRoot })
      assert.equal(first.updated, true)
      const second = ensureCliLauncher({ platform: 'linux', home: env.home, packageRoot: env.packageRoot })
      assert.equal(second.ok, true)
      assert.equal(second.updated, false)
    } finally {
      env.cleanup()
    }
  })

  await t.test('自愈：安装位置变化时重写脚本', () => {
    const env = createEnv()
    try {
      ensureCliLauncher({ platform: 'linux', home: env.home, packageRoot: env.packageRoot })
      // 模拟旧版本的残留脚本（指向已失效路径）
      writeFileSync(env.script, buildLauncherScript('/old/missing/lib/cli/index.js'), 'utf8')
      const healed = ensureCliLauncher({ platform: 'linux', home: env.home, packageRoot: env.packageRoot })
      assert.equal(healed.updated, true)
      assert.ok(readFileSync(env.script, 'utf8').includes(JSON.stringify(env.target)))
    } finally {
      env.cleanup()
    }
  })

  await t.test('~/.local/bin 已在 PATH 时标记 onPath', () => {
    const env = createEnv()
    try {
      const result = ensureCliLauncher({
        platform: 'darwin',
        home: env.home,
        packageRoot: env.packageRoot,
        pathEnv: ['/usr/bin', join(env.home, '.local', 'bin'), '/bin'].join(delimiter),
      })
      assert.equal(result.ok, true)
      assert.equal(result.onPath, true)
    } finally {
      env.cleanup()
    }
  })

  await t.test('服务进程 PATH 不含但 shell 启动文件追加了 ~/.local/bin 时仍标记就绪', () => {
    // DSH 由 systemd 启动：其 PATH 里没有 ~/.local/bin，但用户登录后 shell 有
    const env = createEnv()
    try {
      writeFileSync(
        join(env.home, '.profile'),
        '# ~/.profile\nif [ -d "$HOME/.local/bin" ] ; then\n    PATH="$HOME/.local/bin:$PATH"\nfi\n',
        'utf8'
      )
      const result = ensureCliLauncher({
        platform: 'linux',
        home: env.home,
        packageRoot: env.packageRoot,
        pathEnv: ['/usr/local/bin', '/usr/bin', '/bin'].join(delimiter),
      })
      assert.equal(result.ok, true)
      assert.equal(result.onPath, true)
    } finally {
      env.cleanup()
    }
  })

  await t.test('CLI 入口缺失时返回 cli-missing，不创建残脚本', () => {
    const env = createEnv({ withCli: false })
    try {
      const result = ensureCliLauncher({ platform: 'linux', home: env.home, packageRoot: env.packageRoot })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'cli-missing')
      assert.equal(existsSync(env.script), false)
    } finally {
      env.cleanup()
    }
  })

  await t.test('主目录不可写时只返回失败原因，绝不抛错', () => {
    const env = createEnv()
    try {
      // 用一个「父级是文件」的假 HOME 触发 ENOTDIR
      const blocked = join(env.root, 'blocked')
      writeFileSync(blocked, 'x', 'utf8')
      const result = ensureCliLauncher({ platform: 'linux', home: blocked, packageRoot: env.packageRoot })
      assert.equal(result.ok, false)
      assert.ok(result.reason)
    } finally {
      env.cleanup()
    }
  })
})

test('PATH 判定与 Banner 文案 (isDirOnPath / describeCliLauncher)', async (t) => {
  await t.test('isDirOnPath 处理尾斜杠、多段与空段', () => {
    const dir = '/home/u/.local/bin'
    // 用平台分隔符拼接：Windows 下 PATH 用 ';'，且盘符自带冒号不能按 ':' 切
    assert.equal(isDirOnPath(dir, ['/usr/bin', dir, '/bin'].join(delimiter)), true)
    assert.equal(isDirOnPath(`${dir}/`, ['/usr/bin', dir].join(delimiter)), true)
    assert.equal(isDirOnPath(dir, ['/usr/bin', '', '/bin'].join(delimiter)), false)
    assert.equal(isDirOnPath(dir, ''), false)
  })

  await t.test('isCliDirReachable 兼顾 shell 启动文件（systemd 进程 PATH 与登录 shell 不同）', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rm-path-'))
    try {
      const bin = join(root, '.local', 'bin')
      // 没有 ~/.profile：进程 PATH 也没有该目录 → 不可达
      assert.equal(isCliDirReachable(bin, root, ''), false)
      // 进程 PATH 含该目录 → 可达
      assert.equal(isCliDirReachable(bin, root, ['/usr/bin', bin].join(delimiter)), true)
      // 进程 PATH 不含，但 ~/.bashrc 追加了 → 交互式登录后可达
      writeFileSync(join(root, '.bashrc'), 'export PATH="$HOME/.local/bin:$PATH"', 'utf8')
      assert.equal(isCliDirReachable(bin, root, ['/usr/bin'].join(delimiter)), true)
      // 非 .local/bin 布局不做启发式，只看进程 PATH
      assert.equal(isCliDirReachable(join(root, 'opt', 'bin'), root, ''), false)
    } finally {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {}
    }
  })

  await t.test('就绪且已在 PATH 时提示可直接使用', () => {
    const text = describeCliLauncher({ ok: true, onPath: true, path: '/home/u/.local/bin/dsh-remote-mobile' })
    assert.match(text, new RegExp(`${CLI_LAUNCHER_NAME} code / password`))
  })

  await t.test('落位成功但不在 PATH 时给出可直接粘贴的 PATH 命令', () => {
    const text = describeCliLauncher({ ok: true, onPath: false, path: '/home/u/.local/bin/dsh-remote-mobile' })
    assert.match(text, /\/home\/u\/\.local\/bin\/dsh-remote-mobile/)
    assert.match(text, /export PATH="\$HOME\/\.local\/bin:\$PATH"/)
  })

  await t.test('Windows 与失败场景给出 npx 兜底路径', () => {
    assert.match(describeCliLauncher({ ok: false, reason: 'windows' }), /npx dsh-remote-mobile/)
    const failed = describeCliLauncher({ ok: false, reason: 'EACCES' })
    assert.match(failed, /自动落位未成功（EACCES）/)
    assert.match(failed, /npx/)
  })
})
