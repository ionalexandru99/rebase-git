import { lazy, Suspense, useState } from "react";
import type {
  ChangeSection,
  ChangeSelection,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
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
import {
  type ChangeAction,
  useWorkingChangesView,
  type WorkingChangesTarget,
} from "#web/features/working-changes/hooks/use-working-changes-view.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";

interface DiscardRequest {
  readonly section: ChangeSection;
  readonly selection: ChangeSelection;
  readonly revision: string;
}

const ChangeDiffViewer = lazy(
  () =>
    import("#web/features/working-changes/components/change-diff-viewer.tsx"),
);

export function WorkingChanges({
  target,
  writable,
}: {
  readonly target: WorkingChangesTarget;
  readonly writable: boolean;
}) {
  const view = useWorkingChangesView(target);
  const [discard, setDiscard] = useState<DiscardRequest | null>(null);
  const [hunk, setHunk] = useState<{
    readonly file: string;
    readonly index: number;
  } | null>(null);
  const file = `${view.selection?.section}:${view.selection?.path}`;
  const act: ChangeAction = (action, section, selection) => {
    if (action === "discard" && view.changes !== undefined)
      setDiscard({ section, selection, revision: view.changes.revision });
    else view.act(action, section, selection);
  };
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label="Working changes"
      aria-busy={view.busy}
    >
      <OperationHeader scope={target} />
      {discard === null ? null : (
        <Confirmation
          title={`Discard ${discard.section} changes?`}
          action="Discard"
          disabled={view.busy || view.loading}
          onCancel={() => setDiscard(null)}
          onConfirm={() => {
            setDiscard(null);
            view.act(
              "discard",
              discard.section,
              discard.selection,
              discard.revision,
            );
          }}
          className="shrink-0 border-border border-b p-3"
        >
          {describeDiscard(discard.selection)} This cannot be undone.
        </Confirmation>
      )}
      {view.error ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-destructive/30 border-b bg-destructive/10 px-3 py-2 text-xs"
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
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="change-diff" defaultSize="70%" minSize="12rem">
          {view.selection?.section === "conflicts" ? (
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
                <p className="p-4 text-xs text-muted-foreground">
                  Loading diff viewer…
                </p>
              }
            >
              <ChangeDiffViewer
                key={`${file}:${view.diff?.revision}`}
                view={view}
                writable={writable}
                act={act}
                hunk={hunk?.file === file ? hunk.index : null}
                onHunk={(index) =>
                  setHunk(index === null ? null : { file, index })
                }
              />
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
              <ChangeFileTree view={view} writable={writable} act={act} />
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

function describeDiscard(selection: ChangeSelection) {
  if (selection._tag === "Lines")
    return `${selection.lines.length} selected lines in ${selection.path}.`;
  if (selection._tag === "Files")
    return `${selection.paths.length} selected ${selection.paths.length === 1 ? "file" : "files"}.`;
  return "Includes files hidden by the filter.";
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
          }}
          writable={connected && writable}
        />
      </div>
    </DiffWorkerPool>
  );
}

function Disconnected() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      Connect to the repository to review changes.
    </div>
  );
}
