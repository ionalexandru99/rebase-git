import { lazy, Suspense, useState } from "react";
import {
  type ChangeAction,
  useWorkingChangesView,
  type WorkingChangesTarget,
} from "#web/features/working-changes/hooks/use-working-changes-view";
import { Button } from "#web-ui/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import { ChangeFileTree } from "#web-ui/features/working-changes/components/change-file-tree";
import { CommitEditor } from "#web-ui/features/working-changes/components/commit-editor";
import {
  DiscardConfirmation,
  type DiscardRequest,
} from "#web-ui/features/working-changes/components/discard-confirmation";

const ChangeDiffViewer = lazy(
  () =>
    import("#web-ui/features/working-changes/components/change-diff-viewer"),
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
      <DiscardConfirmation
        request={discard}
        confirm={(request) =>
          view.act(
            "discard",
            request.section,
            request.selection,
            request.revision,
          )
        }
        close={() => setDiscard(null)}
      />
    </section>
  );
}
