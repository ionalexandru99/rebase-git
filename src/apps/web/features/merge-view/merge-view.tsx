import type { ConflictPath, ConflictSide } from "@rebase/contracts";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "#web/components/ui/button";
import { MarkersConfirmation } from "#web/features/merge-view/components/markers-confirmation";
import {
  MergeViewBar,
  RegionNavigation,
} from "#web/features/merge-view/components/merge-view-bar";
import { ResultEditor } from "#web/features/merge-view/components/result-editor";
import { SidePanes } from "#web/features/merge-view/components/side-panes";
import { WholeFileMenu } from "#web/features/merge-view/components/whole-file-menu";
import { useLineSelection } from "#web/features/merge-view/hooks/use-line-selection";
import {
  type MergeSession,
  useMergeSession,
} from "#web/features/merge-view/hooks/use-merge-session";
import { useRegionNavigation } from "#web/features/merge-view/hooks/use-region-navigation";
import { useSideSegments } from "#web/features/merge-view/hooks/use-side-segments";
import { openRegionCount } from "#web/features/merge-view/merge-model";
import {
  conflictReason,
  describeConflictFailure,
} from "#web/features/merge-view/merge-view-messages";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

export interface MergeViewProps {
  readonly path: string;
  readonly onOpen: (path: string) => void;
  readonly onClose: () => void;
  readonly toolbarActions?: ReactNode;
}

export function MergeView({
  path,
  onOpen,
  onClose,
  toolbarActions,
}: MergeViewProps) {
  const scope = useRepositoryScope();
  if (scope === undefined) return null;
  return (
    <MergeViewContent
      key={JSON.stringify([scope.repositoryId, scope.worktreePath, path])}
      input={{
        repositoryId: scope.repositoryId,
        worktreePath: scope.worktreePath,
        path,
      }}
      onOpen={onOpen}
      onClose={onClose}
      toolbarActions={toolbarActions}
    />
  );
}

function MergeViewContent({
  input,
  onOpen,
  onClose,
  toolbarActions,
}: {
  readonly input: ConflictPath;
  readonly onOpen: (path: string) => void;
  readonly onClose: () => void;
  readonly toolbarActions?: ReactNode;
}) {
  const session = useMergeSession({ input, onOpen, onClose });
  const [showBase, setShowBase] = useState(false);
  const leftSide: ConflictSide = showBase ? "base" : "current";
  const { model, resolution, queries } = session;
  const document = queries.document.data;
  const navigation = useRegionNavigation(
    model,
    leftSide,
    session.activeRegion,
    session.selectRegion,
  );
  const selection = useLineSelection(session.choose, session.selectRegion);
  const segments = useSideSegments(model);
  const failure = queries.document.error;
  const reason = conflictReason(failure);
  const wholeFileOnly = reason === "TooLarge" || reason === "Unsupported";
  const listed = queries.list.data?.files.find(
    ({ path }) => path === input.path,
  );
  const panes = !wholeFileOnly && model !== null && document !== undefined;
  const notice =
    session.notice ??
    (failure !== null && !wholeFileOnly
      ? describeConflictFailure(failure)
      : null);

  return (
    <section
      aria-label="Merge view"
      className="flex h-full min-h-0 flex-col bg-repository"
      onKeyDown={(event) =>
        handleKeys(event, session, navigation, resolution, onClose)
      }
    >
      <MergeViewBar path={input.path} onBack={onClose} actions={toolbarActions}>
        {panes && (
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
            {openRegionCount(model)} of {model.regionCount} open
          </span>
        )}
        <span className="flex-1" />
        {panes && (
          <>
            <Button
              variant="outline"
              size="xs"
              aria-pressed={showBase}
              className="aria-pressed:bg-muted aria-pressed:text-foreground"
              onClick={() => setShowBase((shown) => !shown)}
            >
              Base
            </Button>
            <RegionNavigation
              hasPrevious={navigation.hasPrevious}
              hasNext={navigation.hasNext}
              onPrevious={navigation.previous}
              onNext={navigation.next}
            />
          </>
        )}
        <WholeFileMenu
          choices={document?.file.choices ?? listed?.choices ?? []}
          mergeTool={(queries.list.data?.mergeTool ?? null) !== null}
          disabled={resolution.busy}
          onChoose={(choice) => void resolution.chooseWholeFile(choice)}
          onMergeTool={() => void resolution.openMergeTool()}
        />
        {panes && (
          <Button
            size="xs"
            disabled={resolution.busy}
            onClick={() => void resolution.markResolved(false)}
          >
            Mark resolved
          </Button>
        )}
      </MergeViewBar>
      {resolution.confirming && (
        <MarkersConfirmation
          onCancel={resolution.cancelConfirmation}
          onConfirm={() => void resolution.markResolved(true)}
        />
      )}
      {notice !== null && (
        <p
          role="status"
          className="shrink-0 border-border border-b px-3 py-1.5 text-xs text-muted-foreground"
        >
          {notice}
        </p>
      )}
      {panes && (
        <div className="flex min-h-0 flex-1 flex-col">
          <SidePanes
            segments={segments}
            sides={document.sides}
            leftSide={leftSide}
            activeRegion={session.activeRegion}
            selection={selection}
            onRegionClick={navigation.selectFromSides}
            scrollRef={navigation.sidesRef}
          />
          <ResultEditor
            model={model}
            activeRegion={session.activeRegion}
            onEdit={session.edit}
            onUndo={session.undo}
            onRegionClick={navigation.selectFromResult}
            scrollRef={navigation.resultRef}
          />
        </div>
      )}
    </section>
  );
}

function handleKeys(
  event: KeyboardEvent<HTMLElement>,
  session: MergeSession,
  navigation: ReturnType<typeof useRegionNavigation>,
  resolution: MergeSession["resolution"],
  onClose: () => void,
) {
  if (!event.currentTarget.contains(event.target as Node)) return;
  const action = keyAction(event);
  if (action === null) return;
  event.preventDefault();
  switch (action) {
    case "close":
      return resolution.confirming
        ? resolution.cancelConfirmation()
        : onClose();
    case "previous":
      return navigation.previous();
    case "next":
      return navigation.next();
    case "current":
    case "incoming":
      return session.selectSide(action);
  }
}

function keyAction(event: KeyboardEvent<HTMLElement>) {
  if (event.key === "Escape") return "close";
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowUp") return "previous";
  if (event.key === "ArrowDown") return "next";
  if (event.code === "Digit1") return "current";
  if (event.code === "Digit2") return "incoming";
  return null;
}
