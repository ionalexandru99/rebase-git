import type {
  ConflictDocument,
  ConflictSide,
  ConflictSides,
} from "@rebase/contracts";
import { IconFileDiff } from "@tabler/icons-react";
import { Fragment, useMemo } from "react";
import { Button } from "#web/components/ui/button";
import { sideNames } from "#web/features/merge-view/components/pane-lines";
import { mergeModel } from "#web/features/merge-view/conflict-document";
import { WholeFileMenu } from "#web/features/working-changes/conflicts/components/whole-file-menu";
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
  readonly openMergeView: (path: string) => void;
}) {
  const { conflicts, selection } = view;
  const path = selection?.section === "conflicts" ? selection.path : null;
  const file = conflicts.rows.find((row) => row.path === path)?.file;
  const document =
    conflicts.document?.file.path === path ? conflicts.document : undefined;
  const openMerge = () => path !== null && openMergeView(path);
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label="Conflict"
    >
      <fieldset
        className="flex shrink-0 flex-wrap items-center gap-1 border-border border-b p-2"
        aria-label="Conflict versions"
      >
        {sides.map((side) => (
          <Button
            key={side}
            size="xs"
            variant="ghost"
            className="font-mono"
            disabled={!file?.stages.some((stage) => stage.side === side)}
            onClick={openMerge}
          >
            {versionLabel(side, conflicts.sides)}
          </Button>
        ))}
        <div className="ml-auto flex">
          <Button size="xs" variant="ghost" onClick={openMerge}>
            Merge view
          </Button>
          {file ? (
            <WholeFileMenu
              choices={file.choices}
              disabled={!writable || view.busy || view.loading}
              onChoose={(choice) => conflicts.choose(file.path, choice)}
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
      {document !== undefined && document.regions.length > 0 ? (
        <WorkingFile document={document} />
      ) : file !== undefined &&
        (document !== undefined ||
          conflicts.wholeFileOnly ||
          conflicts.documentProblem !== null) ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground">
          <IconFileDiff className="size-8" />
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
            {sides.map((side) => {
              const stage = file.stages.find(
                (candidate) => candidate.side === side,
              );
              return (
                <Fragment key={side}>
                  <dt className="text-left font-mono">
                    {versionLabel(side, conflicts.sides)}
                  </dt>
                  <dd className="text-right">
                    {stage === undefined
                      ? "No file"
                      : `${stage.binary ? "Binary · " : ""}${stage.bytes.toLocaleString()} bytes`}
                  </dd>
                </Fragment>
              );
            })}
          </dl>
        </div>
      ) : conflicts.documentProblem !== null ? null : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading conflict…
        </div>
      )}
    </section>
  );
}

function WorkingFile({ document }: { readonly document: ConflictDocument }) {
  const segments = useMemo(() => {
    const { segments } = mergeModel(document);
    let ordinal = 0;
    return segments.map((segment, index) =>
      segment.kind === "region"
        ? { key: segment.region.id, region: ++ordinal, lines: segment.marker }
        : { key: `text-${index}`, region: null, lines: segment.lines },
    );
  }, [document]);
  return (
    <section aria-label="Working file" className="min-h-0 flex-1 overflow-auto">
      <div className="min-w-fit py-2 pr-3 font-mono text-xs leading-5 whitespace-pre">
        {segments.map(({ key, region, lines }) =>
          region === null ? (
            <div key={key} className="min-h-5 pl-3">
              {lines.join("\n")}
            </div>
          ) : (
            <fieldset
              key={key}
              aria-label={`Region ${region}`}
              className="border-foreground/15 border-l-2 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/4%)_0_5px,transparent_5px_12px)] pl-2.5"
            >
              {lines.join("\n")}
            </fieldset>
          ),
        )}
      </div>
    </section>
  );
}

function versionLabel(side: ConflictSide, sides: ConflictSides | undefined) {
  const identity = sides?.[side].commit?.slice(0, 8) ?? sides?.[side].ref;
  return identity ? `${sideNames[side]} ${identity}` : sideNames[side];
}
