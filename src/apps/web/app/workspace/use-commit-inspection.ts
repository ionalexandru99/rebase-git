import { useEffect, useRef } from "react";
import type { CommitGraphHandle } from "#web/features/commit-graph/commit-graph.tsx";
import {
  type CodeMatchTarget,
  type CommitInput,
  commitInputOid,
} from "#web/features/commit-inspection/commit-input.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";

export function useCommitInspection(connected: boolean) {
  const { state, dispatch, store } = useWorkspacePanel();
  const graphRef = useRef<CommitGraphHandle>(null);
  const selection = useRef<string | undefined>(undefined);
  const hadTab = useRef(false);
  useEffect(() => {
    const hasTab = state.tabs.includes("commit");
    if (hadTab.current && !hasTab) graphRef.current?.focusSelection();
    hadTab.current = hasTab;
  }, [state.tabs]);
  return {
    graphRef,
    open: (input: CommitInput) =>
      dispatch({ type: "open", kind: "commit", input }),
    openMatch: (oid: string, match: CodeMatchTarget) =>
      dispatch({
        type: "open",
        kind: "commit",
        input: { oid, match },
        focus: false,
      }),
    select: (oid: string | undefined) => {
      if (oid === undefined) {
        return;
      }
      const previous = selection.current;
      selection.current = oid;
      if (previous === undefined || previous === oid) {
        return;
      }
      const snapshot = store.getSnapshot();
      if (
        snapshot.open &&
        snapshot.tabs.includes("commit") &&
        connected &&
        commitInputOid(snapshot.inputs?.commit) !== oid
      )
        dispatch({ type: "input", kind: "commit", input: oid });
    },
  };
}
