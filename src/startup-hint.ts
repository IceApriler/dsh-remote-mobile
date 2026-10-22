import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DSH_HOME } from './auth/token.js'

const WILDCARD_ERROR_RE =
  /host\s+["']?(?:0\.0\.0\.0|::)["']?\s+is an unspecified \(wildcard\) address|binding every interface would expose remote code execution/i

let installed = false
let sawWildcardError = false

/** 查找配置中 webserver 使用通配地址的 profile patch 文件 */
function findWildcardConfigFile(): string | null {
  const files = [join(DSH_HOME, 'cordis.patch.yml')]
  try {
    for (const entry of readdirSync(join(DSH_HOME, 'profiles'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      files.push(join(DSH_HOME, 'profiles', entry.name, 'cordis.patch.yml'))
    }
  } catch {}

  for (const file of files) {
    if (!existsSync(file)) continue
    let content = ''
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*-\s*id:\s*['"]?webserver['"]?\s*$/.test(lines[i])) continue
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*-\s*id:/.test(lines[j])) break
        if (/^\s*host:\s*['"]?(?:0\.0\.0\.0|::)['"]?\s*$/.test(lines[j])) return file
      }
    }
  }
  return null
}

/**
 * 在 DSH webserver 校验失败退出后追加一条针对通配地址错误的友好提示。
 * 只在 stderr 命中 DSH 的 wildcard 报错时触发，其他启动错误不输出。
 */
export function installStartupFailureHint(): void {
  if (installed) return
  installed = true

  const originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: any, encoding?: any, callback?: any) => {
    try {
      if (WILDCARD_ERROR_RE.test(String(chunk))) sawWildcardError = true
    } catch {}
    return originalWrite(chunk, encoding, callback)
  }) as typeof process.stderr.write

  process.once('exit', () => {
    if (!sawWildcardError) return
    const file = findWildcardConfigFile()

    console.error(`
[dsh-remote-mobile] 启动失败提示：
检测到 DSH webserver 使用了通配地址 0.0.0.0 / ::。
DSH 0.2.1+ 不允许这种监听方式，插件无法在 webserver 校验前接管。
${file ? `请删除或注释 ${file} 中的 webserver 配置块；` : '请删除或注释 profile 的 cordis.patch.yml 中的 webserver 配置块；'}
保持默认 127.0.0.1:3080，然后重启 dsh web。
重启后 dsh-remote-mobile 会自动使用 3081 安全接入代理。
`)
  })
}
