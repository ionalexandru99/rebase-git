import type { ConflictSide } from "@rebase/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { regionRowOffset } from "#web/features/merge-view/aligned-rows";
import {
  type LinePick,
  type MergeModel,
  regionSegments,
} from "#web/features/merge-view/conflict-document";
import type { ChooseRegion } from "#web/features/merge-view/hooks/use-merge-document";
import { regionLineOffset } from "#web/features/merge-view/result-text";

export interface LineTarget {
  readonly regionId: string;
  readonly side: ConflictSide;
  readonly index: number;
}

export interface LineSelection {
  readonly press: (target: LineTarget, picks: readonly LinePick[]) => void;
  readonly enter: (target: LineTarget) => void;
  readonly toggle: (target: LineTarget) => void;
  readonly extend: (target: LineTarget, index: number) => void;
  readonly focusRegion: (regionId: string) => void;
}

type PickMode = "add" | "remove";

interface Drag {
  readonly target: LineTarget;
  readonly mode: PickMode;
}

const lineHeight = 20;
const contextRows = 2;

export function useSelection(
  model: MergeModel | null,
  choose: ChooseRegion,
  leftSide: ConflictSide,
) {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const sidesRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ model, leftSide });
  useLayoutEffect(() => {
    latest.current = { model, leftSide };
  });
  const regions = model === null ? [] : regionSegments(model);
  const active =
    regions.find(({ region }) => region.id === selectedRegion) ??
    regions.find(({ choice }) => choice.kind === "open") ??
    regions[0];
  const activeIndex = active === undefined ? -1 : regions.indexOf(active);

  const revealSides = useCallback((regionId: string) => {
    const { model, leftSide } = latest.current;
    if (model !== null)
      scrollTo(
        sidesRef.current,
        regionRowOffset(model, regionId, leftSide, "incoming"),
      );
  }, []);
  const revealResult = useCallback((regionId: string) => {
    const { model } = latest.current;
    if (model !== null)
      scrollTo(resultRef.current, regionLineOffset(model, regionId));
  }, []);
  const focusRegion = useCallback(
    (regionId: string) => {
      setSelectedRegion(regionId);
      revealResult(regionId);
    },
    [revealResult],
  );
  const lines = useLineSelection(choose, setSelectedRegion, focusRegion);

  function move(offset: 1 | -1) {
    const target = regions[activeIndex + offset];
    if (target === undefined) return;
    setSelectedRegion(target.region.id);
    revealSides(target.region.id);
    revealResult(target.region.id);
  }

  return {
    lines,
    sidesRef,
    resultRef,
    activeRegion: active?.region.id ?? null,
    hasPrevious: activeIndex > 0,
    hasNext: activeIndex !== -1 && activeIndex < regions.length - 1,
    previous: () => move(-1),
    next: () => move(1),
    takeActive: (side: ConflictSide) => {
      if (active !== undefined)
        choose(active.region.id, () =>
          active.region[side].map((_, index) => ({ side, index })),
        );
    },
    focusFromResult: (regionId: string) => {
      setSelectedRegion(regionId);
      revealSides(regionId);
    },
  };
}

export type Selection = ReturnType<typeof useSelection>;

function useLineSelection(
  choose: ChooseRegion,
  selectRegion: (regionId: string) => void,
  focusRegion: (regionId: string) => void,
): LineSelection {
  const drag = useRef<Drag | null>(null);
  useEffect(() => {
    const end = () => {
      drag.current = null;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);
  return useMemo(
    () => ({
      press: (target, picks) => {
        const mode = pickModeFor(picks, linePick(target));
        drag.current = { target, mode };
        selectRegion(target.regionId);
        choose(target.regionId, (current) =>
          applyPick(current, linePick(target), mode),
        );
      },
      enter: (target) => {
        const current = drag.current;
        if (
          current === null ||
          current.target.regionId !== target.regionId ||
          current.target.side !== target.side ||
          current.target.index === target.index
        )
          return;
        drag.current = { ...current, target };
        const step = target.index > current.target.index ? 1 : -1;
        choose(target.regionId, (picks) =>
          applyPickRange(
            picks,
            target.side,
            current.target.index + step,
            target.index,
            current.mode,
          ),
        );
      },
      toggle: (target) => {
        selectRegion(target.regionId);
        choose(target.regionId, (picks) =>
          applyPick(
            picks,
            linePick(target),
            pickModeFor(picks, linePick(target)),
          ),
        );
      },
      extend: (target, index) => {
        selectRegion(target.regionId);
        choose(target.regionId, (picks) =>
          applyPick(
            applyPick(picks, linePick(target), "add"),
            { side: target.side, index },
            "add",
          ),
        );
      },
      focusRegion,
    }),
    [choose, focusRegion, selectRegion],
  );
}

function linePick({ side, index }: LineTarget): LinePick {
  return { side, index };
}

function scrollTo(element: HTMLDivElement | null, offset: number | null) {
  if (element === null || offset === null) return;
  element.scrollTop = Math.max(offset - contextRows, 0) * lineHeight;
}

export function pickPosition(picks: readonly LinePick[], pick: LinePick) {
  return picks.findIndex(
    ({ side, index }) => side === pick.side && index === pick.index,
  );
}

function pickModeFor(picks: readonly LinePick[], pick: LinePick): PickMode {
  return pickPosition(picks, pick) === -1 ? "add" : "remove";
}

function applyPick(
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

function applyPickRange(
  picks: readonly LinePick[],
  side: ConflictSide,
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
