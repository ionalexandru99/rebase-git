import type { DiffLine } from '@shared/schemas/git'
import { describe, expect, it } from 'vitest'
import {
  alignHunkTokens,
  highlightHunk,
  hunkHighlightKey,
  languageForFile
} from '@/lib/diff-highlight'

const line = (kind: DiffLine['kind'], text: string): DiffLine => ({
  kind,
  text,
  oldLine: null,
  newLine: null
})

describe('languageForFile', () => {
  it('maps common extensions to bundled languages', () => {
    expect(languageForFile('src/app.ts')).toBe('ts')
    expect(languageForFile('src/components/Panel.tsx')).toBe('tsx')
    expect(languageForFile('script.py')).toBe('python')
    expect(languageForFile('main.rs')).toBe('rust')
    expect(languageForFile('config.yml')).toBe('yaml')
    expect(languageForFile('deploy.sh')).toBe('shellscript')
    expect(languageForFile('include/types.h')).toBe('c')
  })

  it('maps well-known filenames without extensions', () => {
    expect(languageForFile('Dockerfile')).toBe('docker')
    expect(languageForFile('sub/dir/Makefile')).toBe('make')
  })

  it('returns null for unknown or missing extensions', () => {
    expect(languageForFile('LICENSE')).toBeNull()
    expect(languageForFile('data.unknownext')).toBeNull()
    expect(languageForFile('.gitignore')).toBeNull()
  })
})

describe('alignHunkTokens', () => {
  const tok = (text: string) => [{ content: text, lightColor: '', darkColor: '' }]

  it('routes del lines to the old side, add lines to the new side, context to both', () => {
    const lines = [
      line('context', 'shared'),
      line('del', 'removed'),
      line('add', 'inserted'),
      line('context', 'tail')
    ]
    const oldSide = [tok('shared'), tok('removed'), tok('tail')]
    const newSide = [tok('shared'), tok('inserted'), tok('tail')]
    expect(alignHunkTokens(lines, oldSide, newSide)).toEqual([
      tok('shared'),
      tok('removed'),
      tok('inserted'),
      tok('tail')
    ])
  })

  it('returns null for meta lines without consuming side tokens', () => {
    const lines = [line('meta', '\\ No newline at end of file'), line('add', 'added')]
    expect(alignHunkTokens(lines, [], [tok('added')])).toEqual([null, tok('added')])
  })
})

describe('highlightHunk', () => {
  it('returns null when the language is unknown', async () => {
    expect(await highlightHunk('LICENSE', [line('add', 'some text')])).toBeNull()
  })

  it('returns null when a line is too long to highlight', async () => {
    const huge = line('add', 'x'.repeat(5000))
    expect(await highlightHunk('src/app.ts', [huge])).toBeNull()
  })

  it('tokenizes each side and keeps colors aligned to the hunk lines', async () => {
    const lines = [
      line('context', 'function run() {'),
      line('del', '  const old = 1'),
      line('add', '  const fresh = 2'),
      line('context', '}')
    ]
    const result = await highlightHunk('src/app.ts', lines)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(4)
    const rebuilt = result?.map((tokens) => tokens?.map((token) => token.content).join(''))
    expect(rebuilt).toEqual(lines.map((diffLine) => diffLine.text))
    const addLine = result?.[2]
    const keyword = addLine?.find((token) => token.content === 'const')
    expect(keyword?.lightColor).toBe('#A631BE')
    expect(keyword?.darkColor).toBe('#D568EA')
  })
})

describe('hunkHighlightKey', () => {
  const hunk = (lines: DiffLine[]) => ({
    header: '@@ -1,2 +1,2 @@',
    oldStart: 1,
    oldCount: 2,
    newStart: 1,
    newCount: 2,
    lines
  })

  it('is stable for identical content and changes when content changes', () => {
    const a = hunk([line('add', 'alpha'), line('del', 'beta')])
    const b = hunk([line('add', 'alpha'), line('del', 'beta')])
    const c = hunk([line('add', 'alpha'), line('del', 'gamma')])
    expect(hunkHighlightKey(a)).toBe(hunkHighlightKey(b))
    expect(hunkHighlightKey(a)).not.toBe(hunkHighlightKey(c))
  })

  it('distinguishes kind changes with identical text', () => {
    const a = hunk([line('add', 'alpha')])
    const b = hunk([line('del', 'alpha')])
    expect(hunkHighlightKey(a)).not.toBe(hunkHighlightKey(b))
  })
})
