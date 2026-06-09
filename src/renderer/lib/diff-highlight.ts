import pierreDark from '@pierre/theme/pierre-dark'
import pierreLight from '@pierre/theme/pierre-light'
import type { DiffHunk, DiffLine } from '@shared/schemas/git'
import {
  bundledLanguages,
  createHighlighter,
  createJavaScriptRegexEngine,
  type HighlighterGeneric,
  type ThemeRegistrationRaw
} from 'shiki'

export interface TokenSpan {
  content: string
  lightColor: string
  darkColor: string
}

export type LineTokens = TokenSpan[]

const LIGHT_THEME = pierreLight.name ?? 'Pierre Light'
const DARK_THEME = pierreDark.name ?? 'Pierre Dark'
const MAX_HIGHLIGHT_LINE_LENGTH = 2000

const EXTENSION_LANGUAGE_OVERRIDES: Record<string, string> = {
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  cts: 'typescript',
  h: 'c',
  hpp: 'cpp',
  hh: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  kt: 'kotlin',
  kts: 'kotlin',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  sh: 'shellscript',
  zsh: 'shellscript',
  bash: 'shellscript',
  ps1: 'powershell',
  md: 'markdown',
  mdx: 'mdx',
  gql: 'graphql',
  htm: 'html',
  svg: 'xml',
  plist: 'xml'
}

const FILENAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'docker',
  makefile: 'make',
  '.npmrc': 'ini',
  '.editorconfig': 'ini'
}

export function languageForFile(filePath: string): string | null {
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1).toLowerCase()
  const byName = FILENAME_LANGUAGES[fileName]
  if (byName && byName in bundledLanguages) {
    return byName
  }
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return null
  }
  const extension = fileName.slice(dotIndex + 1)
  const language = EXTENSION_LANGUAGE_OVERRIDES[extension] ?? extension
  return language in bundledLanguages ? language : null
}

type DiffHighlighter = HighlighterGeneric<string, string>

let highlighterPromise: Promise<DiffHighlighter> | null = null
const loadedLanguages = new Set<string>()

function getHighlighter(): Promise<DiffHighlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [pierreLight, pierreDark] as unknown as ThemeRegistrationRaw[],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true })
  }) as Promise<DiffHighlighter>
  return highlighterPromise
}

export function alignHunkTokens(
  lines: DiffLine[],
  oldSideTokens: LineTokens[],
  newSideTokens: LineTokens[]
): Array<LineTokens | null> {
  let oldIndex = 0
  let newIndex = 0
  return lines.map((line) => {
    if (line.kind === 'meta') {
      return null
    }
    if (line.kind === 'del') {
      return oldSideTokens[oldIndex++] ?? null
    }
    if (line.kind === 'add') {
      return newSideTokens[newIndex++] ?? null
    }
    oldIndex++
    return newSideTokens[newIndex++] ?? null
  })
}

export async function highlightHunk(
  filePath: string,
  lines: DiffLine[]
): Promise<Array<LineTokens | null> | null> {
  const language = languageForFile(filePath)
  if (!language) {
    return null
  }
  const contentLines = lines.filter((line) => line.kind !== 'meta')
  if (contentLines.some((line) => line.text.length > MAX_HIGHLIGHT_LINE_LENGTH)) {
    return null
  }
  const highlighter = await getHighlighter()
  if (!loadedLanguages.has(language)) {
    await highlighter.loadLanguage(language)
    loadedLanguages.add(language)
  }
  const tokenizeSide = (sideLines: DiffLine[]): LineTokens[] => {
    if (sideLines.length === 0) {
      return []
    }
    const code = sideLines.map((line) => line.text).join('\n')
    const { tokens } = highlighter.codeToTokens(code, {
      lang: language,
      themes: { light: LIGHT_THEME, dark: DARK_THEME },
      defaultColor: false
    })
    return tokens.map((lineTokens) => {
      const spans: TokenSpan[] = []
      for (const token of lineTokens) {
        const style = (token.htmlStyle ?? {}) as Record<string, string>
        const lightColor = style['--shiki-light'] ?? ''
        const darkColor = style['--shiki-dark'] ?? ''
        const previous = spans.at(-1)
        if (previous && previous.lightColor === lightColor && previous.darkColor === darkColor) {
          previous.content += token.content
        } else {
          spans.push({ content: token.content, lightColor, darkColor })
        }
      }
      return spans
    })
  }
  const oldSide = tokenizeSide(contentLines.filter((line) => line.kind !== 'add'))
  const newSide = tokenizeSide(contentLines.filter((line) => line.kind !== 'del'))
  return alignHunkTokens(lines, oldSide, newSide)
}

export function hunkHighlightKey(hunk: DiffHunk): string {
  let hash = 0x811c9dc5
  const mix = (input: string) => {
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  for (const line of hunk.lines) {
    mix(line.kind)
    mix(line.text)
    mix('\n')
  }
  return `${hunk.lines.length}:${hash.toString(36)}`
}
