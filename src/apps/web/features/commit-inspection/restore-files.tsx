import { useState } from "react";
import {
  type CommitInspection,
  CommitInspectionApi,
  maximumRestorePaths,
  type RestoreFiles,
  type RestoreOverwrites,
  type RestoreSource,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import {
  type CommandTarget,
  useCommand,
} from "#web/platform/query/use-command.ts";

export interface RestorePreview {
  readonly source: RestoreSource;
  readonly path: string;
}

type RestoreRequest = Pick<
  RestoreFiles,
  "oid" | "parentOid" | "source" | "paths"
>;

interface PendingRestore {
  readonly request: RestoreRequest;
  readonly failure: RestoreOverwrites;
}

export interface RestoreActions {
  readonly actionsFor: (
    paths: readonly string[],
    anchor: string,
  ) => readonly Action[];
  readonly preview: RestorePreview | undefined;
  readonly endPreview: () => void;
  readonly pending: PendingRestore | undefined;
  readonly running: boolean;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

const sources: readonly {
  readonly source: RestoreSource;
  readonly label: string;
}[] = [
  { source: "commit", label: "This commit" },
  { source: "parent", label: "Before this commit" },
];
const listedOverwrites = 3;

export type RestoreSubject = Pick<
  CommitInspection,
  "oid" | "parentOid" | "files"
>;

export function useRestoreFiles(
  target: CommandTarget,
  details: RestoreSubject | undefined,
  writable: boolean,
): RestoreActions {
  const command = useCommand(CommitInspectionApi.restore, { target });
  const errorToast = useErrorToast();
  const [preview, setPreview] = useState<RestorePreview>();
  const [pending, setPending] = useState<PendingRestore>();

  const run = async (request: RestoreRequest, overwrite?: string) => {
    const result = await command.run({
      ...request,
      ...(overwrite === undefined ? {} : { overwrite }),
    });
    const failure = result._tag === "Rejected" ? result.failure : undefined;
    setPending(
      failure?._tag === "RestoreOverwrites" ? { request, failure } : undefined,
    );
    if (failure?._tag !== "RestoreOverwrites")
      errorToast.failure("restore", result);
  };

  const actionsFor = (paths: readonly string[], anchor: string) => {
    if (!writable || details === undefined) return [];
    const selected = new Set(paths);
    const files = details.files
      .filter((file) => selected.has(file.path))
      .flatMap((file) =>
        file.previousPath === null
          ? [file.path]
          : [file.path, file.previousPath],
      );
    if (files.length === 0) return [];
    const reason =
      files.length > maximumRestorePaths
        ? `Over ${maximumRestorePaths.toLocaleString()} files`
        : command.running
          ? "Restoring…"
          : undefined;
    const highlight = (source: RestoreSource) => (highlighted: boolean) =>
      setPreview((current) =>
        highlighted
          ? { source, path: anchor }
          : current?.source === source && current.path === anchor
            ? undefined
            : current,
      );
    const choices = sources
      .filter(({ source }) => source === "commit" || details.parentOid !== null)
      .map(
        ({ source, label }): Action => ({
          id: `restore.${source}`,
          label,
          enabled: reason === undefined,
          ...(reason === undefined ? {} : { reason }),
          onHighlight: highlight(source),
          run: () =>
            void run({
              oid: details.oid,
              ...(details.parentOid === null
                ? {}
                : { parentOid: details.parentOid }),
              source,
              paths: files,
            }),
        }),
      );
    const [only] = choices;
    return choices.length === 1 && only !== undefined
      ? [{ ...only, id: "restore", label: "Restore" }]
      : [submenu({ id: "restore", label: "Restore" }, choices)];
  };

  return {
    actionsFor,
    preview,
    endPreview: () => setPreview(undefined),
    pending,
    running: command.running,
    confirm: () => {
      if (pending !== undefined)
        void run(pending.request, pending.failure.fingerprint);
    },
    cancel: () => setPending(undefined),
  };
}

export function RestoreConfirmation({
  restore,
}: {
  readonly restore: RestoreActions;
}) {
  const { pending } = restore;
  if (pending === undefined) return null;
  const { paths, count, fingerprint } = pending.failure;
  const hidden = count - Math.min(count, listedOverwrites);
  return (
    <PersistentNotification>
      <Confirmation
        action="Replace and restore"
        busy={restore.running}
        className="px-3 py-2"
        key={fingerprint}
        onCancel={restore.cancel}
        onConfirm={restore.confirm}
        title={
          count === 1
            ? `Replace uncommitted edits in ${paths[0]}?`
            : `Replace uncommitted edits in ${count} files?`
        }
      >
        <p>Your edits will be lost. Staged changes stay.</p>
        {count === 1 ? null : (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {paths.slice(0, listedOverwrites).map((path) => (
              <li className="truncate font-mono text-foreground" key={path}>
                {path}
              </li>
            ))}
          </ul>
        )}
        {hidden === 0 ? null : <p className="mt-0.5">and {hidden} more</p>}
      </Confirmation>
    </PersistentNotification>
  );
}
