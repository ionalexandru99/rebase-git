import type { ChangeSection, ChangeSelection } from "@rebase/contracts";
import { lazy, Suspense, useState } from "react";
import { Button } from "#web/components/ui/button";
import { Confirmation } from "#web/components/ui/confirmation";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web/components/ui/resizable";
import { OperationHeader } from "#web/features/operation-recovery/components/operation-header";
import { ChangeFileTree } from "#web/features/working-changes/components/change-file-tree";
import { CommitEditor } from "#web/features/working-changes/components/commit-editor";
import { ConflictViewer } from "#web/features/working-changes/conflicts/components/conflict-viewer";
import {
  type ChangeAction,
  useWorkingChangesView,
  type WorkingChangesTarget,
} from "#web/features/working-changes/hooks/use-working-changes-view";

interface DiscardRequest {
  readonly section: ChangeSection;
  readonly selection: ChangeSelection;
  readonly revision: string;
}

const ChangeDiffViewer = lazy(
  () => import("#web/features/working-changes/components/change-diff-viewer"),
);

export function WorkingChanges({
  target,
  writable,
  openMergeView,
}: {
  readonly target: WorkingChangesTarget;
  readonly writable: boolean;
  readonly openMergeView: (path: string) => void;
}) {
  const view = useWorkingChangesView(target);
  const [discard, setDiscard] = useState<DiscardRequest | null>(null);
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
          action="Discard changes"
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
          {describeDiscard(discard.selection)} This cannot be undone. Unrelated
          edits will be preserved; overlapping edits will stop the operation.
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
      {view.notice ? (
        <div
          role="status"
          className="shrink-0 border-border border-b px-3 py-2 text-xs text-muted-foreground"
        >
          {view.notice}
        </div>
      ) : null}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="change-diff" defaultSize="70%" minSize="12rem">
          {view.selection?.section === "conflicts" ? (
            <ConflictViewer
              view={view}
              writable={writable}
              openMergeView={openMergeView}
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
                key={`${view.selection?.section}:${view.selection?.path}:${view.diff?.revision}`}
                view={view}
                writable={writable}
                act={act}
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
    return `Discard ${selection.lines.length} selected changed lines in ${selection.path}.`;
  if (selection._tag === "Files")
    return `Discard changes in ${selection.paths.length} selected ${selection.paths.length === 1 ? "file" : "files"}.`;
  return "Discard every change in this section, including files hidden by the filter.";
}
