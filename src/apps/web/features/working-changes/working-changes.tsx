import { lazy, Suspense, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web/components/ui/resizable.tsx";
import { DiffWorkerPool } from "#web/features/file-diff/components/diff-worker-pool.tsx";
import { OperationHeader } from "#web/features/operation-recovery/components/operation-controls.tsx";
import { ChangeFileTree } from "#web/features/working-changes/components/change-file-tree.tsx";
import { CommitEditor } from "#web/features/working-changes/components/commit-editor.tsx";
import { ConflictViewer } from "#web/features/working-changes/conflicts/components/conflict-viewer.tsx";
import { viewedChange } from "#web/features/working-changes/hooks/use-change-selection.ts";
import {
  useWorkingChangesView,
  type WorkingChangesTarget,
} from "#web/features/working-changes/hooks/use-working-changes-view.ts";
import { IgnoreConfirmation } from "#web/features/working-changes/ignore-paths.tsx";
import { isShowChangeInput } from "#web/features/working-changes/show-change.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";

const ChangeDiffViewer = lazy(
  () =>
    import("#web/features/working-changes/components/change-diff-viewer.tsx"),
);
const FolderDiff = lazy(
  () => import("#web/features/working-changes/components/folder-diff.tsx"),
);

export function WorkingChanges({
  target,
  writable,
}: {
  readonly target: WorkingChangesTarget;
  readonly writable: boolean;
}) {
  const view = useWorkingChangesView(target);
  const [hunk, setHunk] = useState<{
    readonly file: string;
    readonly index: number;
  } | null>(null);
  const { selection } = view;
  const viewed = viewedChange(selection);
  const file = `${viewed?.section}:${viewed?.path}`;
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label="Working changes"
      aria-busy={view.busy}
    >
      <OperationHeader scope={target} />
      {view.error ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-destructive/30 border-b bg-destructive/10 px-3 py-2 text-meta"
        >
          <span className="flex-1">{view.error}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={view.refresh}
            disabled={view.busy}
          >
            Refresh
          </Button>
        </div>
      ) : null}
      <IgnoreConfirmation ignore={view.ignore} busy={view.busy} />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="change-diff" defaultSize="70%" minSize="12rem">
          {selection?.section === "conflicts" ? (
            <ConflictViewer
              view={view}
              scope={{
                repositoryId: target.repositoryId,
                worktreePath: target.worktreePath,
              }}
              writable={writable}
            />
          ) : (
            <Suspense
              fallback={
                <p className="p-4 text-meta text-muted-foreground">
                  Loading diff viewer…
                </p>
              }
            >
              {selection !== null && "folder" in selection ? (
                <FolderDiff
                  key={`${selection.section}:${selection.folder}`}
                  view={view}
                  folder={selection}
                />
              ) : (
                <ChangeDiffViewer
                  key={`${file}:${view.diff?.revision}`}
                  view={view}
                  writable={writable}
                  act={view.act}
                  hunk={hunk?.file === file ? hunk.index : null}
                  onHunk={(index) =>
                    setHunk(index === null ? null : { file, index })
                  }
                />
              )}
            </Suspense>
          )}
        </ResizablePanel>
        <ResizableHandle aria-label="Resize changed-file tree" />
        <ResizablePanel
          id="change-tree"
          defaultSize="21rem"
          groupResizeBehavior="preserve-pixel-size"
          minSize="12.5rem"
          maxSize="26rem"
        >
          <ResizablePanelGroup
            orientation="vertical"
            className="border-border border-l"
          >
            <ResizablePanel id="change-files" minSize="10rem">
              <ChangeFileTree view={view} writable={writable} act={view.act} />
            </ResizablePanel>
            <ResizableHandle aria-label="Resize commit editor" />
            <ResizablePanel
              id="change-composer"
              defaultSize="12.25rem"
              minSize="9rem"
              maxSize="60%"
            >
              <CommitEditor view={view} writable={writable} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  );
}

export function WorkingChangesPanel() {
  const feature = usePanelFeature();
  if (feature?.scope === undefined || feature.environment === undefined)
    return <Disconnected />;
  const { active, environment, scope } = feature;
  const { connected, writable } = environment;
  const { environmentId, repositoryId, worktreePath } = scope;
  return (
    <DiffWorkerPool>
      {connected ? null : <Disconnected />}
      <div className="h-full min-h-0" hidden={!connected}>
        <WorkingChanges
          target={{
            repositoryId,
            worktreePath,
            draftKey: JSON.stringify([
              environmentId,
              repositoryId,
              worktreePath,
            ]),
            active: connected && active,
            requested: isShowChangeInput(feature.input)
              ? feature.input
              : undefined,
          }}
          writable={connected && writable}
        />
      </div>
    </DiffWorkerPool>
  );
}

function Disconnected() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-body text-muted-foreground">
      Connect to the repository to review changes.
    </div>
  );
}
