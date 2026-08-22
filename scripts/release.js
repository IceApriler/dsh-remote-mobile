#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync as run } from 'node:child_process'
import readline from 'node:readline'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, '..')
const pkgPath = resolve(rootDir, 'package.json')

const REGISTRY = 'https://registry.npmjs.org/'

function print(msg, icon = '🚀') {
  console.log(`\n${icon} ${msg}`)
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((res) => {
    rl.question(question, (ans) => {
      rl.close()
      res(ans.trim())
    })
  })
}

async function main() {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const currentVersion = pkg.version

  print(`当前插件版本: v${currentVersion}`, '📦')

  // 1. 检查 npm 登录状态
  print('检查 npm 登录状态...', '🔑')
  try {
    const whoami = run(`npm whoami --registry=${REGISTRY}`, { encoding: 'utf8' }).trim()
    console.log(`✅ 已登录 npm 账号: ${whoami}`)
  } catch {
    console.error('❌ 未登录 npm 官方源，请先执行: npm login --registry=https://registry.npmjs.org/')
    process.exit(1)
  }

  // 2. 确定版本升级类型
  let releaseType = process.argv[2]
  if (!releaseType) {
    console.log('\n请选择发布模式:')
    console.log(`  1) patch   (小版本修复，例如: ${bump(currentVersion, 'patch')})`)
    console.log(`  2) minor   (新功能特性，例如: ${bump(currentVersion, 'minor')})`)
    console.log(`  3) major   (重大架构变更，例如: ${bump(currentVersion, 'major')})`)
    console.log(`  4) current (保持当前版本 ${currentVersion} 直接发布)`)

    const choice = await ask('\n请输入选项 (1/2/3/4，默认 1): ')
    if (choice === '2') releaseType = 'minor'
    else if (choice === '3') releaseType = 'major'
    else if (choice === '4') releaseType = 'current'
    else releaseType = 'patch'
  }

  let nextVersion = currentVersion
  if (releaseType !== 'current') {
    nextVersion = bump(currentVersion, releaseType)
    print(`准备升级版本: v${currentVersion} -> v${nextVersion}`, '⬆️')

    // 更新 package.json
    pkg.version = nextVersion
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  } else {
    print(`保持当前版本: v${currentVersion}`, '📌')
  }

  // 3. 执行编译与自动化测试
  print('开始执行构建与全套自动化测试 (npm run build && npm test)...', '🔨')
  try {
    run('npm run build', { stdio: 'inherit', cwd: rootDir })
    run('npm test', { stdio: 'inherit', cwd: rootDir })
  } catch (e) {
    console.error('\n❌ 构建或测试未通过，发布已终止！')
    process.exit(1)
  }

  // 4. Git 提交版本变更
  if (releaseType !== 'current') {
    try {
      run(`git add package.json package-lock.json src/client/version.js lib/`, { stdio: 'ignore', cwd: rootDir })
      run(`git commit -m "chore(release): v${nextVersion}"`, { stdio: 'inherit', cwd: rootDir })
      run(`git tag v${nextVersion}`, { stdio: 'ignore', cwd: rootDir })
      console.log(`✅ 已自动创建 Git Commit 与 Tag: v${nextVersion}`)
    } catch {}
  }

  // 5. 执行 npm 发布
  print(`开始发布 dsh-remote-mobile@${nextVersion} 到 npm 官方源...`, '🚀')
  try {
    run(`npm publish --access=public --registry=${REGISTRY}`, {
      stdio: 'inherit',
      cwd: rootDir,
    })
    print(`🎉 恭喜！dsh-remote-mobile@${nextVersion} 发布成功！`, '✅')
    console.log(`\n📌 可在 npm 查看: https://www.npmjs.com/package/dsh-remote-mobile`)
    console.log(`📌 提示: 可执行 git push --follow-tags 将发布记录推送到 GitHub`)
  } catch (e) {
    console.error('\n❌ 发布失败，请检查网络或版本冲突！')
    process.exit(1)
  }
}

function bump(version, type) {
  const parts = version.split('.').map((n) => parseInt(n, 10))
  if (type === 'major') return `${parts[0] + 1}.0.0`
  if (type === 'minor') return `${parts[0]}.${parts[1] + 1}.0`
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
