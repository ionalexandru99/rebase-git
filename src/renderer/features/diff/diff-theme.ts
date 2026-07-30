const DIFF_THEME_STYLE: Record<string, string> = {
  '--diffs-addition-color-override': 'var(--add)',
  '--diffs-deletion-color-override': 'var(--del)',
  '--diffs-bg-addition-override': 'var(--add-bg)',
  '--diffs-bg-deletion-override': 'var(--del-bg)',
  '--diffs-bg-addition-emphasis-override': 'var(--add-word)',
  '--diffs-bg-deletion-emphasis-override': 'var(--del-word)',
  '--diffs-bg-separator-override': 'var(--card-2)',
  '--diffs-bg-selection-override': 'var(--brand)',
  '--diffs-bg-selection-number-override': 'var(--brand)',
  '--diffs-bg-hover-override': 'var(--brand)',
  '--diffs-fg-conflict-marker-override': 'var(--orange)',
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-font-size': '14px',
  '--diffs-line-height': '24px',
  '--diffs-min-number-column-width': '44px'
}

export function diffThemeStyle(): Record<string, string> {
  return DIFF_THEME_STYLE
}

export const DIFF_UNSAFE_CSS = `
[data-column-number] {
  border-right: 1px solid var(--diffs-bg-separator);
}

[data-gutter-buffer] {
  border-right: 1px solid var(--diffs-bg-separator);
}

[data-indicators="bars"] [data-line-type="change-addition"][data-column-number]::before,
[data-indicators="bars"] [data-line-type="change-deletion"][data-column-number]::before {
  width: 5px;
}

[data-separator="simple"] {
  min-height: 5px;
}

[data-separator="line-info"],
[data-separator="line-info-basic"],
[data-separator="metadata"] {
  height: 28px;
}
`
