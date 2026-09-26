import { useState } from "react";
import type { MergeModel } from "#web/features/merge-view/merge-model";
import {
  type SideSegment,
  sideSegments,
} from "#web/features/merge-view/pane-rows";

export function useSideSegments(model: MergeModel | null) {
  const [segments, setSegments] = useState<readonly SideSegment[]>([]);
  const next = model === null ? segments : sideSegments(model, segments);
  if (next !== segments) setSegments(next);
  return next;
}
