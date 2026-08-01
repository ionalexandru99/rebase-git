export const LIST_PANE_MIN_WIDTH = 300
export const LIST_PANE_MAX_WIDTH = 820
export const LIST_PANE_DEFAULT_WIDTH = 400

export function clampListPaneWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return LIST_PANE_DEFAULT_WIDTH
  }
  return Math.min(LIST_PANE_MAX_WIDTH, Math.max(LIST_PANE_MIN_WIDTH, width))
}
