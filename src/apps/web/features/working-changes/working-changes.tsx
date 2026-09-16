import type {
  ChangeSection,
  ChangeSelection,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { RepositoryChangesClient } from "#web/features/working-changes/working-changes.contract";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "#web-ui/components/ui/alert-dialog";
import { Button } from "#web-ui/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import {
  type ChangeAction,
  ChangeFileTree,
} from "#web-ui/features/working-changes/components/change-file-tree";
import { CommitEditor } from "#web-ui/features/working-changes/components/commit-editor";
import {
  useWorkingChanges,
  WorkingChangesProvider,
} from "#web-ui/features/working-changes/working-changes-provider";

const ChangeDiffViewer = lazy(
  () =>
    import("#web-ui/features/working-changes/components/change-diff-viewer"),
);
export function WorkingChanges({
  client,
  environmentId,
  repositoryId,
  worktreePath,
  connected,
  writable,
  onCommitted,
  reviewRequest = 0,
}: {
  readonly client: RepositoryChangesClient | undefined;
  readonly environmentId: string | undefined;
  readonly repositoryId: string | undefined;
  readonly worktreePath: string;
  readonly connected: boolean;
  readonly writable: boolean;
  readonly onCommitted: () => void;
  readonly reviewRequest?: number;
}) {
  if (
    client === undefined ||
    environmentId === undefined ||
    repositoryId === undefined ||
    !connected
  )
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Connect to the repository to review changes.
      </div>
    );
  return (
    <WorkingChangesProvider
      client={client}
      environmentId={environmentId}
      repositoryId={repositoryId}
      worktreePath={worktreePath}
      onCommitted={onCommitted}
    >
      <ChangesLayout writable={writable} reviewRequest={reviewRequest} />
    </WorkingChangesProvider>
  );
}

function ChangesLayout({
  writable,
  reviewRequest,
}: {
  readonly writable: boolean;
  readonly reviewRequest: number;
}) {
  const { state, controller } = useWorkingChanges();
  const section = useRef<HTMLElement>(null);
  const reviewed = useRef(0);
  useEffect(() => {
    if (
      reviewRequest === reviewed.current ||
      state.loading ||
      state.changes === null
    )
      return;
    reviewed.current = reviewRequest;
    const conflict = state.changes.unstaged.find((file) => file.status === "U");
    if (conflict) controller.select("unstaged", conflict.path);
    section.current?.focus();
  }, [reviewRequest, state.loading, state.changes, controller]);
  const [discard, setDiscard] = useState<{
    section: ChangeSection;
    selection: ChangeSelection;
    revision: string;
  } | null>(null);
  const act: ChangeAction = (action, section, selection) => {
    if (action === "discard" && state.changes !== null)
      setDiscard({ section, selection, revision: state.changes.revision });
    else controller.mutate(action, section, selection);
  };
  return (
    <section
      ref={section}
      tabIndex={-1}
      className="flex h-full min-h-0 flex-col"
      aria-label="Working changes"
      aria-busy={state.busy}
    >
      {state.error ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-destructive/30 border-b bg-destructive/10 px-3 py-2 text-xs"
        >
          <span className="flex-1">{state.error}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={controller.refresh}
            disabled={state.busy}
          >
            Refresh
          </Button>
        </div>
      ) : null}
      {state.notice ? (
        <div
          role="status"
          className="shrink-0 border-border border-b px-3 py-2 text-xs text-muted-foreground"
        >
          {state.notice}
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
              key={`${state.selection?.section}:${state.selection?.path}:${state.diff?.revision}`}
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
              <ChangeFileTree writable={writable} act={act} />
            </ResizablePanel>
            <ResizableHandle aria-label="Resize commit editor" />
            <ResizablePanel
              id="change-composer"
              defaultSize="12.25rem"
              minSize="9rem"
              maxSize="60%"
            >
              <CommitEditor writable={writable} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
      <AlertDialog
        open={discard !== null}
        onOpenChange={(open) => {
          if (!open) setDiscard(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            Discard {discard?.section} changes?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {discard?.selection._tag === "Lines"
              ? `Discard ${discard.selection.lines.length} selected changed lines in ${discard.selection.path}.`
              : discard?.selection._tag === "Files"
                ? `Discard changes in ${discard.selection.paths.length} selected ${discard.selection.paths.length === 1 ? "file" : "files"}.`
                : "Discard every change in this section, including files hidden by the filter."}{" "}
            This cannot be undone. Unrelated edits will be preserved;
            overlapping edits will stop the operation.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (discard)
                  controller.mutate(
                    "discard",
                    discard.section,
                    discard.selection,
                    discard.revision,
                  );
                setDiscard(null);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
