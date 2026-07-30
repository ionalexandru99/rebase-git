export interface GraphMetrics {
  rootPx: number
  rowHeight: number
  columnWidth: number
  railPadding: number
  dotRadius: number
  mergeDotRadius: number
  mergeStroke: number
  mergeGlyphArm: number
  mergeGlyphStroke: number
}

const FALLBACK_ROOT_PX = 16

function buildGraphMetrics(rootPx: number): GraphMetrics {
  return {
    rootPx,
    rowHeight: Math.round(rootPx * 2.5),
    columnWidth: Math.round(rootPx),
    railPadding: Math.round(rootPx * 0.875),
    dotRadius: rootPx * 0.3125,
    mergeDotRadius: rootPx * 0.25,
    mergeStroke: Math.max(1, rootPx * 0.1),
    mergeGlyphArm: rootPx * 0.2,
    mergeGlyphStroke: Math.max(1, rootPx * 0.09)
  }
}

let cachedMetrics = buildGraphMetrics(FALLBACK_ROOT_PX)

export function graphMetricsFor(rootPx: number): GraphMetrics {
  if (rootPx !== cachedMetrics.rootPx) {
    cachedMetrics = buildGraphMetrics(rootPx)
  }
  return cachedMetrics
}

export function readRootFontSize(): number {
  if (typeof document === 'undefined') {
    return FALLBACK_ROOT_PX
  }
  const measured = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_ROOT_PX
}

export function readGraphMetrics(): GraphMetrics {
  return graphMetricsFor(readRootFontSize())
}
