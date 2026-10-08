import { useEffect, useRef } from "react";
import type { CommitGraphHandle } from "#web/features/commit-graph/commit-graph.tsx";
import {
  type CodeMatchTarget,
  type CommitInput,
  commitInputOid,
} from "#web/features/commit-inspection/commit-input.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";

export function useCommitInspection(connected: boolean) {
  const { state, execute, store } = useWorkspacePanel();
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
    open: (input: CommitInput) => {
      execute({ type: "input", kind: "commit", input });
      execute({ type: "open", kind: "commit" });
    },
    openMatch: (oid: string, match: CodeMatchTarget) => {
      store.dispatch({ type: "input", kind: "commit", input: { oid, match } });
      store.dispatch({ type: "open", kind: "commit" });
    },
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
        store.dispatch({ type: "input", kind: "commit", input: oid });
    },
  };
}
