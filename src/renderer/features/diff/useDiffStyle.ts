import { useCallback, useState } from 'react'

export type DiffStyle = 'unified' | 'split'

const DIFF_STYLE_KEY = 'rebase:diff-style'

function loadDiffStyle(): DiffStyle {
  try {
    return localStorage.getItem(DIFF_STYLE_KEY) === 'split' ? 'split' : 'unified'
  } catch {
    return 'unified'
  }
}

export function useDiffStyle(): [DiffStyle, (style: DiffStyle) => void] {
  const [diffStyle, setStoredDiffStyle] = useState<DiffStyle>(loadDiffStyle)

  const setDiffStyle = useCallback((style: DiffStyle) => {
    setStoredDiffStyle(style)
    try {
      localStorage.setItem(DIFF_STYLE_KEY, style)
    } catch {}
  }, [])

  return [diffStyle, setDiffStyle]
}
