import { useCallback, useMemo, useState } from "react";
import type {
  CommitGraphToolbarDialog,
  CommitGraphToolbarModel,
} from "#web/features/commit-graph/commit-graph-toolbar.contract";

export function useCommitGraphToolbarModel(): CommitGraphToolbarModel {
  const [dialog, showDialog] = useState<CommitGraphToolbarDialog>();
  const closeDialog = useCallback(() => showDialog(undefined), []);
  return useMemo(
    () => ({ dialog, showDialog, closeDialog }),
    [dialog, closeDialog],
  );
}
