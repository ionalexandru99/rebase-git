import type {
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";
import type {
  GraphCommandContext,
  GraphCommandId,
  GraphCommandRegistry,
} from "#web/features/commit-commands/graph-command.contract";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#web-ui/components/ui/dropdown-menu";

export function CommitRefLabels({
  labels,
  context,
  registry,
  execute,
  restoreFocus,
}: {
  readonly labels: readonly RepositoryHistoryRefTarget[];
  readonly context: (
    label: RepositoryHistoryRefTarget,
  ) => GraphCommandContext | undefined;
  readonly registry: GraphCommandRegistry;
  readonly execute: (
    id: GraphCommandId,
    context: GraphCommandContext,
  ) => Promise<void>;
  readonly restoreFocus: () => void;
}) {
  if (labels.length === 0) return null;
  return (
    <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
      {labels.map((label) => {
        const target = context(label);
        const command =
          target === undefined
            ? undefined
            : registry
                .commands(target)
                .find(({ id }) => id === "history.toggleRef");
        const className = `max-w-40 truncate rounded-sm border px-1.5 py-0.5 font-mono text-[9px] leading-none ${label.type === "tag" ? "border-status-connecting/35 bg-status-connecting/10 text-status-connecting" : "border-primary/30 bg-primary/8 text-foreground"}`;
        if (command === undefined || target === undefined)
          return (
            <span className={className} key={`${label.type}\0${label.name}`}>
              {label.name}
            </span>
          );
        return (
          <DropdownMenu
            key={`${label.type}\0${label.name}`}
            onOpenChange={(open) => {
              if (!open) restoreFocus();
            }}
          >
            <DropdownMenuTrigger
              className={className}
              aria-label={`Actions for ${label.name}`}
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {label.name}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                disabled={!command.enabled}
                title={command.disabledReason}
                onClick={(event) => {
                  event.stopPropagation();
                  void execute(command.id, target);
                }}
              >
                {command.label}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </span>
  );
}

export function historyLabelTarget(
  label: RepositoryHistoryRefTarget,
): RepositoryRefTarget | undefined {
  if (label.type === "branch") return { _tag: "LocalBranch", name: label.name };
  if (label.type === "tag") return { _tag: "Tag", name: label.name };
  if (label.type === "remote-branch") {
    const separator = label.name.indexOf("/");
    if (separator > 0)
      return {
        _tag: "RemoteBranch",
        remote: label.name.slice(0, separator),
        name: label.name.slice(separator + 1),
      };
  }
  return undefined;
}
