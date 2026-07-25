import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { electronCandidates, findElectron, findWindowIcon } from './smoke-test-runtime.mjs'

describe('smoke-test Electron runtime discovery', () => {
  it('selects the locked Windows Electron executable directly', () => {
    const rootDir = resolve('fixture-root')
    const expected = resolve(rootDir, 'node_modules/electron/dist/electron.exe')
    const canExecute = vi.fn((candidate) => candidate === expected)

    expect(findElectron(rootDir, { platform: 'win32', canExecute })).toBe(expected)
    expect(canExecute).toHaveBeenCalledWith(expected)
  })

  it('selects the first executable Unix candidate', () => {
    const rootDir = resolve('fixture-root')
    const candidates = electronCandidates(rootDir, 'linux')
    const canExecute = vi.fn((candidate) => candidate === candidates[1])

    expect(findElectron(rootDir, { platform: 'linux', canExecute })).toBe(candidates[1])
    expect(canExecute).toHaveBeenCalledTimes(2)
  })

  it('falls back to the packaged macOS Electron executable', () => {
    const rootDir = resolve('fixture-root')
    const expected = resolve(
      rootDir,
      'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    )
    const canExecute = vi.fn((candidate) => candidate === expected)

    expect(findElectron(rootDir, { platform: 'darwin', canExecute })).toBe(expected)
    expect(canExecute).toHaveBeenCalledTimes(2)
  })

  it('fails explicitly when the locked Electron runtime is absent', () => {
    const rootDir = resolve('missing-root')

    expect(() => findElectron(rootDir, { platform: 'win32', canExecute: () => false })).toThrow(
      'Locked Electron runtime not found'
    )
  })
})

describe('smoke-test window icon discovery', () => {
  const outMainDir = resolve('fixture-root/out/main')

  it('resolves the icon asset the built main bundle points at', () => {
    const icon = findWindowIcon(outMainDir, {
      listImages: () => [join('chunks', 'icon-Bc80r2AL.png'), join('chunks', 'other-DEADBEEF.png')],
      readMainBundle: () => 'const appIcon = join(__dirname, "./chunks/icon-Bc80r2AL.png");'
    })

    expect(icon).toBe(resolve(outMainDir, 'chunks/icon-Bc80r2AL.png'))
  })

  it('fails when the build ships no icon asset', () => {
    expect(() =>
      findWindowIcon(outMainDir, {
        listImages: () => [],
        readMainBundle: () => 'const win = new BrowserWindow({});'
      })
    ).toThrow('references no window icon asset')
  })

  it('fails when a shipped icon asset is unreferenced by the main bundle', () => {
    expect(() =>
      findWindowIcon(outMainDir, {
        listImages: () => [join('chunks', 'icon-Bc80r2AL.png')],
        readMainBundle: () => 'const win = new BrowserWindow({});'
      })
    ).toThrow('references no window icon asset')
  })
})
