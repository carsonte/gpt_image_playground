import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const configFile = join(root, '.deploy.local')

if (!existsSync(configFile)) {
  console.error('缺少 .deploy.local，请先复制 .deploy.local.example 并填写 SSH 连接信息。')
  process.exit(1)
}

const config = Object.fromEntries(readFileSync(configFile, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const idx = line.indexOf('=')
    return idx < 0 ? [line, ''] : [line.slice(0, idx), line.slice(idx + 1)]
  }))

const host = config.DEPLOY_SSH_HOST?.trim()
const port = config.DEPLOY_SSH_PORT?.trim() || '22'
const user = config.DEPLOY_SSH_USER?.trim() || 'root'
const key = config.DEPLOY_SSH_KEY?.trim()
const appRoot = config.DEPLOY_APP_ROOT?.trim() || '/www/wwwroot/img2.blackengine.top'
const dryRun = process.argv.includes('--dry-run')

if (!host || !/^\d+$/.test(port) || !appRoot.startsWith('/') || appRoot === '/') {
  console.error('.deploy.local 中的服务器地址、端口或部署目录无效。')
  process.exit(1)
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...opts,
  })
  if (result.error) {
    console.error(`无法运行 ${command}：${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false })
  if (result.error || result.status !== 0) {
    console.error(result.stderr || result.error?.message || `无法运行 ${command}`)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

const sshArgs = ['-p', port]
const scpArgs = ['-P', port]
if (key) {
  sshArgs.push('-i', key)
  scpArgs.push('-i', key)
}

if (!process.argv.includes('--skip-verify')) run('npm', ['run', 'verify:release'])

const workDir = mkdtempSync(join(tmpdir(), 'gpt-image-deploy-'))
const bundle = join(workDir, 'release.tgz')
const remoteId = `${Date.now()}-${process.pid}`
const remoteBundle = `/tmp/gpt-image-release-${remoteId}.tgz`
const remoteScript = `/tmp/gpt-image-update-${remoteId}.sh`
const candidates = [
  '.dockerignore',
  '.env.server.local.example',
  '.gitignore',
  'index.html',
  'package.json',
  'package-lock.json',
  'postcss.config.js',
  'tailwind.config.js',
  'tsconfig.json',
  'vite.config.ts',
  'public',
  'src',
  'server',
  'scripts',
  'deploy',
  'docs',
]
const entries = candidates.filter((entry) => existsSync(join(root, entry)))

try {
  console.log('\n[1/3] 打包已验证的代码。')
  run('tar', ['-czf', bundle, ...entries])
  const archiveEntries = capture('tar', ['-tzf', bundle]).split(/\r?\n/).filter(Boolean)
  const forbidden = archiveEntries.find((entry) => /(^|\/)(\.env\.server|\.env\.server\.local|\.deploy\.local|app\.db|data|node_modules|dist|\.git)(\/|$)/.test(entry))
  if (forbidden || !archiveEntries.includes('package.json') || !archiveEntries.includes('deploy/server.Dockerfile')) {
    console.error(`更新包内容校验失败${forbidden ? `：${forbidden}` : ''}`)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`演练完成，更新包大小：${Math.ceil(readFileSync(bundle).byteLength / 1024)} KB`)
  } else {
    console.log('\n[2/3] 上传更新包。')
    run('scp', [...scpArgs, bundle, `${user}@${host}:${remoteBundle}`])
    run('scp', [...scpArgs, join(root, 'deploy', 'update-from-bundle.sh'), `${user}@${host}:${remoteScript}`])

    console.log('\n[3/3] 服务器备份、构建并切换版本。')
    const safeRoot = `'${appRoot.replaceAll("'", "'\\''")}'`
    run('ssh', [...sshArgs, `${user}@${host}`, `DEPLOY_APP_ROOT=${safeRoot} bash '${remoteScript}' '${remoteBundle}'`])
    console.log('\n一键更新完成：https://img2.blackengine.top')
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
