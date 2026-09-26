import type { ConflictSide } from "@rebase/contracts";
import { useCallback, useLayoutEffect, useRef } from "react";
import {
  type MergeModel,
  regionSegments,
} from "#web/features/merge-view/merge-model";
import {
  regionLineOffset,
  regionRowOffset,
} from "#web/features/merge-view/pane-rows";

const lineHeight = 20;
const contextRows = 2;

export function useRegionNavigation(
  model: MergeModel | null,
  leftSide: ConflictSide,
  activeRegion: string | null,
  selectRegion: (regionId: string) => void,
) {
  const sidesRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ model, leftSide });
  useLayoutEffect(() => {
    latest.current = { model, leftSide };
  });
  const regions = model === null ? [] : regionSegments(model);
  const activeIndex = regions.findIndex(
    ({ region }) => region.id === activeRegion,
  );

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

  const selectFromSides = useCallback(
    (regionId: string) => {
      selectRegion(regionId);
      revealResult(regionId);
    },
    [revealResult, selectRegion],
  );

  function move(offset: 1 | -1) {
    const target = regions[activeIndex + offset];
    if (target === undefined) return;
    selectRegion(target.region.id);
    revealSides(target.region.id);
    revealResult(target.region.id);
  }

  return {
    sidesRef,
    resultRef,
    hasPrevious: activeIndex > 0,
    hasNext: activeIndex !== -1 && activeIndex < regions.length - 1,
    previous: () => move(-1),
    next: () => move(1),
    selectFromSides,
    selectFromResult: (regionId: string) => {
      selectRegion(regionId);
      revealSides(regionId);
    },
  };
}

function scrollTo(element: HTMLDivElement | null, offset: number | null) {
  if (element === null || offset === null) return;
  element.scrollTop = Math.max(offset - contextRows, 0) * lineHeight;
}
