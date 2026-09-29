import { IconFileDiff } from "@tabler/icons-react";
import { Fragment, useEffect, useRef } from "react";
import type {
  ConflictFile,
  ConflictScope,
  ConflictSide,
  ConflictSides,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { ConflictMerge } from "#web/features/working-changes/conflicts/components/conflict-merge.tsx";
import { WholeFileMenu } from "#web/features/working-changes/conflicts/components/whole-file-menu.tsx";
import type { WorkingChangesView } from "#web/features/working-changes/hooks/use-working-changes-view.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";

type ConflictView = Pick<
  WorkingChangesView,
  "conflicts" | "selection" | "select" | "busy" | "loading"
>;

const sides = ["current", "incoming", "base"] as const;

const sideNames: Record<ConflictSide, string> = {
  base: "Base",
  current: "Current",
  incoming: "Incoming",
};

export function ConflictViewer({
  view,
  scope,
  writable,
}: {
  readonly view: ConflictView;
  readonly scope: ConflictScope;
  readonly writable: boolean;
}) {
  const { conflicts, selection } = view;
  const path = selection?.section === "conflicts" ? selection.path : null;
  const file = conflicts.rows.find((row) => row.path === path)?.file;
  const document =
    conflicts.document?.file.path === path ? conflicts.document : undefined;
  useExpandedWhile(file !== undefined && mergesInline(file));
  if (document !== undefined)
    return (
      <ConflictMerge
        key={document.file.path}
        view={view}
        input={{ ...scope, path: document.file.path }}
        document={document}
        writable={writable}
      />
    );
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label="Conflict"
    >
      <div className="flex shrink-0 justify-end border-border border-b p-2">
        {file ? (
          <WholeFileMenu
            choices={file.choices}
            disabled={!writable || view.busy || view.loading}
            onChoose={(choice) => conflicts.choose(file.path, choice)}
          />
        ) : null}
      </div>
      {conflicts.documentProblem ? (
        <p
          role="alert"
          className="shrink-0 border-border border-b px-3 py-2 text-xs text-destructive"
        >
          {conflicts.documentProblem}
        </p>
      ) : null}
      {file !== undefined &&
      (conflicts.wholeFileOnly || conflicts.documentProblem !== null) ? (
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

function useExpandedWhile(active: boolean) {
  const panel = usePanelFeature();
  const expanded = useRef(panel?.expanded === true);
  expanded.current = panel?.expanded === true;
  const expand = panel?.expand;
  useEffect(() => {
    if (!active || expand === undefined || expanded.current) return;
    expand(true);
    return () => expand(false);
  }, [active, expand]);
}

function mergesInline(file: ConflictFile) {
  const present = new Set(file.stages.map((stage) => stage.side));
  return (
    present.has("current") &&
    present.has("incoming") &&
    file.stages.every((stage) => !stage.binary)
  );
}

function versionLabel(side: ConflictSide, sides: ConflictSides | undefined) {
  const identity = sides?.[side].commit?.slice(0, 8) ?? sides?.[side].ref;
  return identity ? `${sideNames[side]} ${identity}` : sideNames[side];
}
