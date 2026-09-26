import type { LinePick } from "#web/features/merge-view/merge-model";

export type PickMode = "add" | "remove";

export function pickPosition(picks: readonly LinePick[], pick: LinePick) {
  return picks.findIndex(
    ({ side, index }) => side === pick.side && index === pick.index,
  );
}

export function pickModeFor(
  picks: readonly LinePick[],
  pick: LinePick,
): PickMode {
  return pickPosition(picks, pick) === -1 ? "add" : "remove";
}

export function applyPick(
  picks: readonly LinePick[],
  pick: LinePick,
  mode: PickMode,
): readonly LinePick[] {
  const position = pickPosition(picks, pick);
  if (mode === "add") return position === -1 ? [...picks, pick] : picks;
  return position === -1
    ? picks
    : picks.filter((_, candidate) => candidate !== position);
}

export function applyPickRange(
  picks: readonly LinePick[],
  side: LinePick["side"],
  from: number,
  to: number,
  mode: PickMode,
): readonly LinePick[] {
  const step = to >= from ? 1 : -1;
  let next = picks;
  for (let index = from; index !== to + step; index += step)
    next = applyPick(next, { side, index }, mode);
  return next;
}
