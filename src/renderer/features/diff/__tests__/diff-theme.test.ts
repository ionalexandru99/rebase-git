import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIFF_UNSAFE_CSS, diffThemeStyle } from '../diff-theme'

const distDirectory = join(process.cwd(), 'node_modules/@pierre/diffs/dist')

function collectJavaScriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath))
    } else if (entry.name.endsWith('.js')) {
      files.push(entryPath)
    }
  }
  return files
}

function supportedCustomPropertyNames(): Set<string> {
  const names = new Set<string>()
  for (const file of collectJavaScriptFiles(distDirectory)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/--diffs-[a-z0-9]+(?:-[a-z0-9]+)*/g)) {
      names.add(match[0])
    }
  }
  return names
}

describe('diffThemeStyle', () => {
  it('only names custom properties the installed @pierre/diffs dist supports', () => {
    const supported = supportedCustomPropertyNames()
    expect(supported.size).toBeGreaterThan(0)
    const unknownNames = Object.keys(diffThemeStyle()).filter((name) => !supported.has(name))
    expect(unknownNames).toEqual([])
  })

  it('maps addition and deletion backgrounds to the app palette', () => {
    const style = diffThemeStyle()
    expect(style['--diffs-bg-addition-override']).toBe('var(--add-bg)')
    expect(style['--diffs-bg-deletion-override']).toBe('var(--del-bg)')
    expect(style['--diffs-bg-addition-emphasis-override']).toBe('var(--add-word)')
    expect(style['--diffs-bg-deletion-emphasis-override']).toBe('var(--del-word)')
  })

  it('pins typography and gutter metrics', () => {
    const style = diffThemeStyle()
    expect(style['--diffs-font-family']).toBe('var(--font-mono)')
    expect(style['--diffs-font-size']).toBe('14px')
    expect(style['--diffs-line-height']).toBe('24px')
    expect(style['--diffs-min-number-column-width']).toBe('44px')
  })
})

describe('DIFF_UNSAFE_CSS', () => {
  it('never relies on !important', () => {
    expect(DIFF_UNSAFE_CSS).not.toContain('!important')
  })

  it('only targets data attributes present in the dist stylesheet', () => {
    const stylesheet = readFileSync(join(distDirectory, 'style.js'), 'utf8')
    const targetedAttributes = new Set(
      [...DIFF_UNSAFE_CSS.matchAll(/\[(data-[a-z-]+)(?:="[a-z-]+")?\]/g)].map((match) => match[1])
    )
    expect(targetedAttributes.size).toBeGreaterThan(0)
    for (const attribute of targetedAttributes) {
      expect(stylesheet).toContain(attribute)
    }
  })
})
