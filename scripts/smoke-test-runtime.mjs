import { accessSync, constants } from 'node:fs'
import { resolve } from 'node:path'

export function electronCandidates(rootDir, platform = process.platform) {
  if (platform === 'win32') {
    return [resolve(rootDir, 'node_modules/electron/dist/electron.exe')]
  }
  if (platform === 'darwin') {
    return [
      resolve(rootDir, 'node_modules/.bin/electron'),
      resolve(rootDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    ]
  }
  return [
    resolve(rootDir, 'node_modules/.bin/electron'),
    resolve(rootDir, 'node_modules/electron/dist/electron')
  ]
}

export function findElectron(
  rootDir,
  { platform = process.platform, canExecute = defaultCanExecute } = {}
) {
  const candidates = electronCandidates(rootDir, platform)
  for (const candidate of candidates) {
    if (canExecute(candidate)) {
      return candidate
    }
  }
  throw new Error(`Locked Electron runtime not found. Expected one of: ${candidates.join(', ')}`)
}

function defaultCanExecute(candidate) {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}
