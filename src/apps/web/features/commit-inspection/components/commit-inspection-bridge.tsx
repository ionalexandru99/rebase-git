import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { CommitGraphHandle } from "#web/features/commit-graph/index";
import type { CommitInspectionClient } from "#web/features/commit-inspection/commit-inspection.contract";
import { createCommitInspectionController } from "#web/features/commit-inspection/commit-inspection-controller";
import { CommitInspection } from "#web-ui/features/commit-inspection/commit-inspection";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/workspace-panel-provider";

interface InspectionGraphActions {
  readonly graphRef: RefObject<CommitGraphHandle | null>;
  readonly open: (oid: string) => void;
  readonly select: (oid: string | undefined) => void;
  readonly content: ReactNode;
}

export function CommitInspectionBridge({
  client,
  repositoryId,
  worktreePath,
  connected,
  children,
}: {
  readonly client: CommitInspectionClient | undefined;
  readonly repositoryId: string | undefined;
  readonly worktreePath: string;
  readonly connected: boolean;
  readonly children: (actions: InspectionGraphActions) => ReactNode;
}) {
  const panel = useWorkspacePanel();
  const graphRef = useRef<CommitGraphHandle>(null);
  const selected = useRef<string | undefined>(undefined);
  const controller = useMemo(
    () =>
      client && repositoryId
        ? createCommitInspectionController(client, {
            repositoryId,
            worktreePath,
          })
        : undefined,
    [client, repositoryId, worktreePath],
  );
  useEffect(() => {
    controller?.start();
    return () => controller?.stop();
  }, [controller]);
  const hadTab = useRef(false);
  useEffect(() => {
    const hasTab = panel.state.tabs.includes("commit");
    if (hadTab.current && !hasTab) graphRef.current?.focusSelection();
    hadTab.current = hasTab;
    controller?.selectCommit(
      hasTab && panel.state.open && connected ? selected.current : undefined,
    );
  }, [controller, panel.state.tabs, panel.state.open, connected]);
  const open = useCallback(
    (oid: string) => {
      selected.current = oid;
      panel.execute({ type: "open", kind: "commit" });
      if (connected) controller?.selectCommit(oid);
    },
    [panel.execute, connected, controller],
  );
  const select = useCallback(
    (oid: string | undefined) => {
      selected.current = oid;
      const state = panel.store.getSnapshot();
      if (state.open && state.tabs.includes("commit") && connected)
        controller?.selectCommit(oid);
    },
    [panel.store, connected, controller],
  );
  return children({
    graphRef,
    open,
    select,
    content: controller ? (
      <CommitInspection controller={controller} connected={connected} />
    ) : (
      <p className="p-4 text-sm text-muted-foreground">
        Connect to the environment to inspect commits.
      </p>
    ),
  });
}
