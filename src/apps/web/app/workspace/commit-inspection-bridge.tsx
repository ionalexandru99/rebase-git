import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { CommitGraphHandle } from "#web/features/commit-graph/commit-graph-model";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider";

export interface InspectionGraphActions {
  readonly graphRef: RefObject<CommitGraphHandle | null>;
  readonly open: (oid: string) => void;
  readonly select: (oid: string | undefined) => void;
}

export function CommitInspectionBridge({
  connected,
  children,
}: {
  readonly connected: boolean;
  readonly children: (actions: InspectionGraphActions) => ReactNode;
}) {
  const panel = useWorkspacePanel();
  const graphRef = useRef<CommitGraphHandle>(null);
  const selection = useRef<{ readonly oid: string | undefined }>(undefined);
  const hadTab = useRef(false);
  useEffect(() => {
    const hasTab = panel.state.tabs.includes("commit");
    if (hadTab.current && !hasTab) graphRef.current?.focusSelection();
    hadTab.current = hasTab;
  }, [panel.state.tabs]);
  const open = useCallback(
    (oid: string) => {
      panel.execute({ type: "input", kind: "commit", input: oid });
      panel.execute({ type: "open", kind: "commit" });
    },
    [panel.execute],
  );
  const select = useCallback(
    (oid: string | undefined) => {
      if (oid === undefined) {
        return;
      }
      const previous = selection.current;
      selection.current = { oid };
      if (previous === undefined || previous.oid === oid) {
        return;
      }
      const state = panel.store.getSnapshot();
      if (state.open && state.tabs.includes("commit") && connected)
        panel.store.dispatch({ type: "input", kind: "commit", input: oid });
    },
    [panel.store, connected],
  );
  return children({
    graphRef,
    open,
    select,
  });
}
