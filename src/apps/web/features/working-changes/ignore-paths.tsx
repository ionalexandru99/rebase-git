import type { SkipToken } from "@tanstack/react-query";
import { useState } from "react";
import {
  type IgnorePaths,
  type IgnoreRule,
  type IgnoreTarget,
  type ReadIgnoreRule,
  RepositoryChangesApi,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { fileName } from "#web/features/file-diff/components/file-row-name.tsx";
import { ConfirmNotice } from "#web/features/notifications/components/persistent-notification.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import type { useChangeActions } from "#web/features/working-changes/hooks/use-working-changes.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";

type IgnoreCommand = ReturnType<typeof useChangeActions>["ignore"];
type IgnoreRequest = Pick<IgnorePaths, "target" | "paths">;

interface PendingIgnore {
  readonly request: IgnoreRequest;
  readonly path: string;
  readonly count: number;
}

const targets: readonly {
  readonly target: IgnoreTarget;
  readonly label: string;
}[] = [
  { target: "repository", label: ".gitignore" },
  { target: "local", label: ".git/info/exclude" },
];

export function useIgnorePaths(
  command: IgnoreCommand,
  written: Pick<IgnorePaths, "amend" | "viewed">,
) {
  const errorToast = useErrorToast();
  const [pending, setPending] = useState<PendingIgnore>();
  const run = async (request: IgnoreRequest, untrack: boolean) => {
    const result = await command.run({ ...written, ...request, untrack });
    const failure = result._tag === "Rejected" ? result.failure : undefined;
    setPending(
      failure?._tag === "IgnoreTracked"
        ? {
            request,
            path: failure.path,
            count: failure.count,
          }
        : undefined,
    );
    if (failure?._tag !== "IgnoreTracked") errorToast.failure("ignore", result);
  };
  return {
    actionFor: (paths: readonly string[], enabled: boolean): Action =>
      submenu(
        { id: "ignore", label: "Ignore", group: "edit" },
        targets.map(({ target, label }) => ({
          id: `ignore.${target}`,
          label,
          enabled,
          run: () => void run({ target, paths }, false),
        })),
      ),
    untrack: (path: string) =>
      setPending({
        request: { target: null, paths: [path] },
        path,
        count: 1,
      }),
    pending,
    confirm: () => {
      if (pending !== undefined) void run(pending.request, true);
    },
    cancel: () => setPending(undefined),
  };
}

export type IgnoreActions = ReturnType<typeof useIgnorePaths>;

export function IgnoreConfirmation({
  ignore,
  busy,
}: {
  readonly ignore: IgnoreActions;
  readonly busy: boolean;
}) {
  const { pending } = ignore;
  if (pending === undefined) return null;
  const { request, path, count } = pending;
  const untrackOnly = request.target === null;
  const action = untrackOnly ? "Untrack" : "Ignore and untrack";
  return (
    <ConfirmNotice
      notice="ignore"
      action={action}
      busy={busy ? (untrackOnly ? "Untracking" : "Ignoring") : undefined}
      onCancel={ignore.cancel}
      onConfirm={ignore.confirm}
      title={
        count === 1
          ? `${action} ${fileName(path)}?`
          : `${action} ${count} files?`
      }
    />
  );
}

export function useIgnoreRule(
  input: ReadIgnoreRule | SkipToken,
  revision: string | undefined,
) {
  return (
    useEnvironmentQuery(RepositoryChangesApi.ignoreRule, input, {
      changes: "index",
      staleTime: 0,
      keepPrevious: true,
      ...(revision === undefined ? {} : { version: revision }),
    }).data ?? null
  );
}

export function IgnoreRuleLine({
  rule,
  onOpen,
  untrack,
}: {
  readonly rule: IgnoreRule;
  readonly onOpen?: (path: string, line: number) => void;
  readonly untrack?: { readonly run: () => void; readonly enabled: boolean };
}) {
  const file =
    onOpen !== undefined && rule.inWorktree ? (
      <button
        type="button"
        aria-label={`Open ${rule.file} at line ${rule.line}`}
        className="rounded-control text-foreground underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={() => onOpen(rule.file, rule.line)}
      >
        {rule.file}
      </button>
    ) : (
      <span className="text-foreground">{rule.file}</span>
    );
  return (
    <div className="flex items-start gap-2 text-body text-muted-foreground">
      <p className="min-w-0 flex-1 wrap-anywhere">
        {untrack === undefined ? "Ignored by " : "Matches "}
        <code className="rounded-control bg-muted px-1 font-mono text-meta text-foreground">
          {rule.pattern}
        </code>{" "}
        in {file}, line {rule.line}
        {untrack === undefined ? null : ", but Git still tracks it"}
      </p>
      {untrack === undefined ? null : (
        <Button
          size="xs"
          variant="outline"
          disabled={!untrack.enabled}
          onClick={untrack.run}
        >
          Untrack
        </Button>
      )}
    </div>
  );
}
