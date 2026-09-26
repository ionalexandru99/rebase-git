import type {
  ConflictFile,
  ConflictSide,
  ConflictSides,
} from "@rebase/contracts";
import { IconFileDiff } from "@tabler/icons-react";
import { Button } from "#web/components/ui/button";
import { ConflictResult } from "#web/features/working-changes/conflicts/components/conflict-result";
import { WholeFileMenu } from "#web/features/working-changes/conflicts/components/whole-file-menu";
import { versionLabel } from "#web/features/working-changes/conflicts/conflict-labels";
import type { WorkingChangesView } from "#web/features/working-changes/hooks/use-working-changes-view";

type ConflictView = Pick<
  WorkingChangesView,
  "conflicts" | "selection" | "busy" | "loading"
>;

const sides = ["current", "incoming", "base"] as const;

export function ConflictViewer({
  view,
  writable,
  openMergeView,
}: {
  readonly view: ConflictView;
  readonly writable: boolean;
  readonly openMergeView: ((path: string) => void) | undefined;
}) {
  const { conflicts, selection } = view;
  const path = selection?.section === "conflicts" ? selection.path : null;
  const file = conflicts.rows.find((row) => row.path === path)?.file;
  const document = conflicts.document;
  const labels = document?.sides ?? conflicts.list?.sides;
  const disabled = !writable || view.busy || view.loading;
  const openMerge =
    path !== null && openMergeView !== undefined
      ? () => openMergeView(path)
      : undefined;
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label="Conflict"
    >
      <fieldset
        className="flex shrink-0 flex-wrap items-center gap-1 border-border border-b p-2"
        aria-label="Conflict versions"
      >
        <Button
          size="xs"
          variant="ghost"
          aria-pressed
          className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
        >
          Result
        </Button>
        {sides.map((side) => (
          <Button
            key={side}
            size="xs"
            variant="ghost"
            className="font-mono"
            disabled={
              openMerge === undefined ||
              !file?.stages.some((stage) => stage.side === side)
            }
            onClick={openMerge}
          >
            {labels ? versionLabel(side, labels[side]) : side}
          </Button>
        ))}
        <div className="ml-auto flex">
          <Button
            size="xs"
            variant="ghost"
            disabled={openMerge === undefined}
            onClick={openMerge}
          >
            Merge view
          </Button>
          {file ? (
            <WholeFileMenu
              choices={file.choices}
              mergeTool={(conflicts.list?.mergeTool ?? null) !== null}
              disabled={disabled}
              onChoose={(choice) => conflicts.choose(file.path, choice)}
              onResolve={() => conflicts.resolve(file.path, false)}
              onMergeTool={() => conflicts.openMergeTool(file.path)}
            />
          ) : null}
        </div>
      </fieldset>
      {conflicts.documentProblem ? (
        <p
          role="alert"
          className="shrink-0 border-border border-b px-3 py-2 text-xs text-destructive"
        >
          {conflicts.documentProblem}
        </p>
      ) : null}
      {document !== undefined &&
      document.file.path === path &&
      document.regions.length > 0 ? (
        <ConflictResult content={document.content} />
      ) : file !== undefined &&
        (document !== undefined ||
          conflicts.wholeFileOnly ||
          conflicts.documentProblem !== null) ? (
        <ConflictStages file={file} labels={labels} />
      ) : conflicts.documentProblem !== null ? null : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading conflict…
        </div>
      )}
    </section>
  );
}

function ConflictStages({
  file,
  labels,
}: {
  readonly file: ConflictFile;
  readonly labels: ConflictSides | undefined;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground">
      <IconFileDiff className="size-8" />
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
        {sides.map((side) => (
          <StageFacts key={side} side={side} file={file} labels={labels} />
        ))}
      </dl>
    </div>
  );
}

function StageFacts({
  side,
  file,
  labels,
}: {
  readonly side: ConflictSide;
  readonly file: ConflictFile;
  readonly labels: ConflictSides | undefined;
}) {
  const stage = file.stages.find((candidate) => candidate.side === side);
  return (
    <>
      <dt className="text-left font-mono">
        {labels ? versionLabel(side, labels[side]) : side}
      </dt>
      <dd className="text-right">
        {stage === undefined
          ? "No file"
          : `${stage.binary ? "Binary · " : ""}${stage.bytes.toLocaleString()} bytes`}
      </dd>
    </>
  );
}
