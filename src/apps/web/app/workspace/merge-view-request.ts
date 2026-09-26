import { useMemo, useState } from "react";

export interface MergeViewRequest {
  readonly path: string | null;
  readonly open: (path: string) => void;
  readonly close: () => void;
}

export function useMergeViewRequest(worktreePath: string): MergeViewRequest {
  const [opened, setOpened] = useState<{
    readonly worktreePath: string;
    readonly path: string;
  } | null>(null);
  const path = opened?.worktreePath === worktreePath ? opened.path : null;
  return useMemo(
    () => ({
      path,
      open: (path) => setOpened({ worktreePath, path }),
      close: () => setOpened(null),
    }),
    [path, worktreePath],
  );
}
