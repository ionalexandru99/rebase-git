import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const hostPlatform = platform()
const hostArch = arch()

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

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    ...options
  })
  if (result.status === 0) {
    return
  }
  throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
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

function extractZip(zipPath, destination) {
  if (hostPlatform === 'darwin') {
    runChecked('ditto', ['-x', '-k', zipPath, destination])
    return
  }
  if (hostPlatform === 'win32') {
    runChecked('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(
        destination
      )} -Force`
    ])
    return
  }
  runChecked('python3', [
    '-c',
    'import os, sys, zipfile; os.makedirs(sys.argv[2], exist_ok=True); zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
    zipPath,
    destination
  ])
}

function downloadElectronRuntime(electronDir, version) {
  const tempDir = mkdtempSync(join(tmpdir(), 'rebase-electron-'))
  const zipName = `electron-v${version}-${hostPlatform}-${hostArch}.zip`
  const zipPath = join(tempDir, zipName)

  try {
    runChecked('curl', [
      '-fsSL',
      `https://github.com/electron/electron/releases/download/v${version}/${zipName}`,
      '-o',
      zipPath
    ])
    rmSync(join(electronDir, 'dist'), { recursive: true, force: true })
    rmSync(join(electronDir, 'path.txt'), { force: true })
    extractZip(zipPath, join(electronDir, 'dist'))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function ensureElectronRuntime() {
  const electronPackageJsonPath = require.resolve('electron/package.json')
  const electronPackageJson = JSON.parse(readFileSync(electronPackageJsonPath, 'utf8'))
  const electronDir = dirname(electronPackageJsonPath)
  const platformPath = getPlatformPath()
  const electronPath = join(electronDir, 'dist', platformPath)

  if (missingRuntimePaths(electronDir, platformPath).length > 0) {
    runElectronInstaller(electronDir)
  }

  if (missingRuntimePaths(electronDir, platformPath).length > 0) {
    downloadElectronRuntime(electronDir, electronPackageJson.version)
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
