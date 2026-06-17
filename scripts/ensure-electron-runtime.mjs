import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { platform } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const hostPlatform = platform()

function getPlatformPath() {
  switch (hostPlatform) {
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      throw new Error(`Electron builds are not available on platform: ${hostPlatform}`)
  }
}

function ensureExecutable(filePath) {
  if (hostPlatform !== 'win32') {
    chmodSync(filePath, 0o755)
  }
}

function missingRuntimePaths(electronDir, platformPath) {
  return [join(electronDir, 'dist', platformPath)].filter((runtimePath) => !existsSync(runtimePath))
}

function repairPathFile(electronDir, platformPath) {
  const pathFile = join(electronDir, 'path.txt')
  const currentPath = existsSync(pathFile) ? readFileSync(pathFile, 'utf8') : undefined
  if (currentPath !== platformPath) {
    writeFileSync(pathFile, platformPath)
  }
}

function runElectronInstaller(electronDir) {
  const env = { ...process.env }
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
  delete env.npm_config_electron_skip_binary_download
  delete env.NPM_CONFIG_ELECTRON_SKIP_BINARY_DOWNLOAD

  const result = spawnSync(process.execPath, ['install.js'], {
    cwd: electronDir,
    env,
    encoding: 'utf8',
    stdio: 'inherit'
  })
  return result.status === 0
}

export function ensureElectronRuntime() {
  const electronPackageJsonPath = require.resolve('electron/package.json')
  const electronDir = dirname(electronPackageJsonPath)
  const platformPath = getPlatformPath()
  const electronPath = join(electronDir, 'dist', platformPath)

  if (missingRuntimePaths(electronDir, platformPath).length > 0) {
    runElectronInstaller(electronDir)
  }

  const missingAfterInstall = missingRuntimePaths(electronDir, platformPath)
  if (missingAfterInstall.length > 0) {
    throw new Error(
      `Electron runtime is incomplete after install:\n${missingAfterInstall
        .map((runtimePath) => `- ${runtimePath}`)
        .join('\n')}`
    )
  }

  ensureExecutable(electronPath)
  repairPathFile(electronDir, platformPath)

  return electronPath
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${ensureElectronRuntime()}\n`)
}
