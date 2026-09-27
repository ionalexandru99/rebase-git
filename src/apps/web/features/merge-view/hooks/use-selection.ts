import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ConflictRegion,
  ConflictSide,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import {
  applyPick,
  isOpen,
  type LinePick,
  type MergeModel,
  type PickMode,
  type Picks,
  pickMode,
  pickRange,
  regionSegments,
  takeSide,
  togglePick,
} from "#web/features/merge-view/conflict-document.ts";
import type { ChooseRegion } from "#web/features/merge-view/hooks/use-merge-document.ts";

export interface LineTarget extends LinePick {
  readonly regionId: string;
}

export interface LineSelection {
  readonly press: (target: LineTarget, picks: readonly LinePick[]) => void;
  readonly enter: (target: LineTarget, buttons: number) => void;
  readonly toggle: (target: LineTarget) => void;
  readonly extend: (target: LineTarget, index: number) => void;
  readonly take: (region: ConflictRegion, side: ConflictSide) => void;
  readonly focusRegion: (regionId: string) => void;
}

const lineHeight = 20;
const contextRows = 2;

export function useSelection(
  model: MergeModel | null,
  picks: Picks,
  choose: ChooseRegion,
) {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const sidesRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const regions = model === null ? [] : regionSegments(model);
  const active =
    regions.find(({ region }) => region.id === selectedRegion) ??
    regions.find((segment) => isOpen(segment, picks)) ??
    regions[0];
  const activeIndex = active === undefined ? -1 : regions.indexOf(active);
  const focusRegion = useCallback((regionId: string) => {
    setSelectedRegion(regionId);
    reveal(resultRef.current, regionId);
  }, []);
  const lines = useLineSelection(choose, setSelectedRegion, focusRegion);

  const move = (offset: 1 | -1) => {
    const target = regions[activeIndex + offset];
    if (target === undefined) return;
    setSelectedRegion(target.region.id);
    reveal(sidesRef.current, target.region.id);
    reveal(resultRef.current, target.region.id);
  };

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
      if (active !== undefined) lines.take(active.region, side);
    },
    focusFromResult: (regionId: string) => {
      setSelectedRegion(regionId);
      reveal(sidesRef.current, regionId);
    },
  };
}

function useLineSelection(
  choose: ChooseRegion,
  selectRegion: (regionId: string) => void,
  focusRegion: (regionId: string) => void,
): LineSelection {
  const drag = useRef<{ target: LineTarget; mode: PickMode } | null>(null);
  return useMemo(() => {
    const pick = (
      regionId: string,
      update: (picks: readonly LinePick[]) => readonly LinePick[],
    ) => {
      selectRegion(regionId);
      choose(regionId, update);
    };
    return {
      press: (target, picks) => {
        const mode = pickMode(picks, target);
        drag.current = { target, mode };
        pick(target.regionId, (current) => applyPick(current, target, mode));
      },
      enter: (target, buttons) => {
        const current = drag.current;
        if (current === null || (buttons & 1) === 0) {
          drag.current = null;
          return;
        }
        const from = current.target;
        if (
          from.regionId !== target.regionId ||
          from.side !== target.side ||
          from.index === target.index
        )
          return;
        drag.current = { ...current, target };
        const step = target.index > from.index ? 1 : -1;
        choose(target.regionId, (picks) =>
          pickRange(
            picks,
            target.side,
            from.index + step,
            target.index,
            current.mode,
          ),
        );
      },
      toggle: (target) =>
        pick(target.regionId, (picks) => togglePick(picks, target)),
      extend: (target, index) =>
        pick(target.regionId, (picks) =>
          applyPick(
            applyPick(picks, target, "add"),
            { side: target.side, index },
            "add",
          ),
        ),
      take: (region, side) =>
        pick(region.id, (picks) => takeSide(picks, region, side)),
      focusRegion,
    };
  }, [choose, focusRegion, selectRegion]);
}

function reveal(container: HTMLElement | null, regionId: string) {
  const target = container?.querySelector(
    `[data-region="${CSS.escape(regionId)}"]`,
  );
  if (container == null || target == null) return;
  const offset =
    target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop = Math.max(
    container.scrollTop + offset - contextRows * lineHeight,
    0,
  );
}
