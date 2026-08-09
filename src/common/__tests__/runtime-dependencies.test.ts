import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type Runtime = 'agent' | 'common' | 'electron' | 'server' | 'web'

const repositoryRoot = process.cwd()
const sourceRoot = path.join(repositoryRoot, 'src')
const runtimeDirectories: Record<Runtime, string[]> = {
  agent: ['agent', 'sidecar'],
  common: ['common', 'shared'],
  electron: ['electron', 'main', 'preload'],
  server: ['server'],
  web: ['web', 'renderer']
}
const runtimeByDirectory = new Map(
  Object.entries(runtimeDirectories).flatMap(([runtime, directories]) =>
    directories.map((directory) => [directory, runtime as Runtime])
  )
)
const nodeModules = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

function listSourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(filePath))
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(filePath)
    }
  }
  return files
}

function isProductionSource(filePath: string): boolean {
  return (
    !filePath.includes(`${path.sep}__tests__${path.sep}`) &&
    !/\.(?:integration\.)?(?:test|spec)\.(?:ts|tsx)$/.test(filePath)
  )
}

function runtimeForPath(filePath: string): Runtime | undefined {
  const relativePath = path.relative(sourceRoot, filePath)
  return runtimeByDirectory.get(relativePath.split(path.sep)[0])
}

function resolveLocalImport(sourceFile: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(sourceFile), specifier)
  }
  const aliases: Record<string, string> = {
    '@': 'renderer',
    '@common': 'common',
    '@main': 'main',
    '@shared': 'shared'
  }
  const alias = Object.keys(aliases).find(
    (candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`)
  )
  if (!alias) {
    return undefined
  }
  const suffix = specifier === alias ? '' : specifier.slice(alias.length + 1)
  return path.join(sourceRoot, aliases[alias], suffix)
}

function importedSpecifiers(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf8')
  return ts.preProcessFile(source, true, true).importedFiles.map(({ fileName }) => fileName)
}

function collectDependencyViolations(): string[] {
  const violations: string[] = []
  for (const sourceFile of listSourceFiles(sourceRoot).filter(isProductionSource)) {
    const sourceRuntime = runtimeForPath(sourceFile)
    if (!sourceRuntime) {
      continue
    }
    const relativeSource = path.relative(repositoryRoot, sourceFile)
    const runtimeLocalCommon = new RegExp(
      `^src[/\\\\]${sourceRuntime}[/\\\\](?:.*[/\\\\])?common[/\\\\]`
    ).test(relativeSource)

    for (const specifier of importedSpecifiers(sourceFile)) {
      if (sourceRuntime === 'web' && (specifier === 'electron' || nodeModules.has(specifier))) {
        violations.push(`${relativeSource} imports Web-incompatible module '${specifier}'`)
      }

      const targetPath = resolveLocalImport(sourceFile, specifier)
      if (!targetPath) {
        continue
      }
      const targetRuntime = runtimeForPath(targetPath)
      if (targetRuntime && targetRuntime !== sourceRuntime && targetRuntime !== 'common') {
        violations.push(
          `${relativeSource} (${sourceRuntime}) imports ${path.relative(repositoryRoot, targetPath)} (${targetRuntime})`
        )
      }
      if (sourceRuntime === 'common' && targetRuntime && targetRuntime !== 'common') {
        violations.push(
          `${relativeSource} (common) imports ${path.relative(repositoryRoot, targetPath)} (${targetRuntime})`
        )
      }
      if (runtimeLocalCommon && targetPath.includes(`${path.sep}features${path.sep}`)) {
        violations.push(`${relativeSource} imports runtime feature '${specifier}'`)
      }
      if (
        sourceRuntime === 'agent' &&
        targetRuntime === 'common' &&
        /[/\\\\]environments?(?:[/\\\\]|\.|-)/i.test(targetPath)
      ) {
        violations.push(
          `${relativeSource} imports Server-owned Environment definition '${specifier}'`
        )
      }
    }
  }
  return violations
}

describe('runtime dependency directions', () => {
  it('keeps runtime implementations independent and Web browser-only', () => {
    expect(collectDependencyViolations()).toEqual([])
  })
})
