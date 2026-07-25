import { accessSync, constants, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

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

export function findWindowIcon(
  outMainDir,
  { listImages = defaultListImages, readMainBundle = defaultReadMainBundle } = {}
) {
  const bundle = readMainBundle(outMainDir)
  const images = listImages(outMainDir)
  const referenced = images.find((relativePath) => bundle.includes(relativePath.split(sep).join('/')))
  if (!referenced) {
    throw new Error(
      `Built main bundle references no window icon asset. Found: ${images.join(', ') || '(none)'}`
    )
  }
  return resolve(outMainDir, referenced)
}

function defaultReadMainBundle(outMainDir) {
  return readFileSync(resolve(outMainDir, 'index.js'), 'utf8')
}

function defaultListImages(outMainDir) {
  const images = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
      } else if (entry.name.endsWith('.png')) {
        images.push(relative(outMainDir, entryPath))
      }
    }
  }
  walk(outMainDir)
  return images
}

function defaultCanExecute(candidate) {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}
