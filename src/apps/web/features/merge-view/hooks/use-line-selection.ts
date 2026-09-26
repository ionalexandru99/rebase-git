import type { ConflictSide } from "@rebase/contracts";
import { useEffect, useMemo, useRef } from "react";
import {
  applyPick,
  applyPickRange,
  type PickMode,
  pickModeFor,
} from "#web/features/merge-view/line-picks";
import type { LinePick } from "#web/features/merge-view/merge-model";

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
}

type Choose = (
  regionId: string,
  update: (picks: readonly LinePick[]) => readonly LinePick[],
) => void;

interface Drag {
  readonly target: LineTarget;
  readonly mode: PickMode;
}

export function useLineSelection(
  choose: Choose,
  selectRegion: (regionId: string) => void,
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
    }),
    [choose, selectRegion],
  );
}

function linePick({ side, index }: LineTarget): LinePick {
  return { side, index };
}
