import { IconArrowDown, IconDots } from "@tabler/icons-react";
import { type ReactNode, useId, useState } from "react";
import type { RepositoryFetchAction } from "#web/features/repository-history/freshness/repository-fetch-action.contract";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "#web-ui/components/ui/dropdown-menu";
import { useCommitGraphToolbar } from "#web-ui/features/commit-graph/components/commit-graph-toolbar-provider";

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2">
      {children}
    </header>
  );
}
function Title({ repositoryName }: { readonly repositoryName: string }) {
  return (
    <h1
      className="mr-auto min-w-0 max-w-48 truncate text-[13px] font-semibold text-foreground"
      title={repositoryName}
    >
      {repositoryName}
    </h1>
  );
}
function Order({
  order,
  onOrderChange,
}: {
  readonly order: RepositoryHistoryQuery["order"];
  readonly onOrderChange: (order: RepositoryHistoryQuery["order"]) => void;
}) {
  return (
    <select
      aria-label="History ordering"
      className="h-7 rounded-sm border border-border bg-background px-2 text-[11px] text-foreground"
      value={order}
      onChange={(event) =>
        onOrderChange(
          event.currentTarget.value === "chronological"
            ? "chronological"
            : "topological",
        )
      }
    >
      <option value="topological">Topological</option>
      <option value="chronological">Chronological</option>
    </select>
  );
}
function Fetch({
  fetchAction,
  fetching,
}: {
  readonly fetchAction: RepositoryFetchAction;
  readonly fetching: boolean;
}) {
  return (
    <Button
      aria-keyshortcuts={fetchAction.ariaKeyShortcuts}
      className="h-7 gap-1.5 text-xs"
      disabled={fetchAction.disabled || fetching}
      onClick={fetchAction.execute}
      size="sm"
      title={
        fetchAction.disabledReason ??
        (fetchAction.shortcut === undefined
          ? "Fetch"
          : `Fetch (${fetchAction.shortcut})`)
      }
      variant="ghost"
    >
      <IconArrowDown aria-hidden="true" className="size-3.5" />
      {fetching ? "Fetching" : "Fetch"}
    </Button>
  );
}
function Options({
  fetchSettingsAvailable,
  cacheAvailable,
}: {
  readonly fetchSettingsAvailable: boolean;
  readonly cacheAvailable: boolean;
}) {
  const { showDialog } = useCommitGraphToolbar();
  const optionsId = useId();
  const [options, setOptions] = useState<{
    readonly anchor: HTMLButtonElement;
    readonly focusKey?: "ArrowUp" | "ArrowDown";
  }>();
  return (
    <>
      {" "}
      <Button
        aria-label="History options"
        aria-controls={options === undefined ? undefined : optionsId}
        aria-expanded={options !== undefined}
        aria-haspopup="menu"
        size="icon-sm"
        variant="ghost"
        onClick={(event) => {
          const anchor = event.currentTarget;
          const keyboard = event.detail === 0;
          setOptions((current) =>
            current === undefined
              ? {
                  anchor,
                  ...(keyboard ? { focusKey: "ArrowDown" as const } : {}),
                }
              : undefined,
          );
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOptions({ anchor: event.currentTarget, focusKey: event.key });
          }
        }}
      >
        <IconDots aria-hidden="true" className="size-4" />
      </Button>
      {options === undefined ? null : (
        <DropdownMenu
          open
          onOpenChange={(open) => {
            if (!open) {
              options.anchor.focus();
              setOptions(undefined);
            }
          }}
        >
          <DropdownMenuContent
            align="end"
            anchor={options.anchor}
            id={optionsId}
            finalFocus={false}
            aria-label="History options"
            onFocus={(event) => {
              if (
                event.target === event.currentTarget &&
                options.focusKey !== undefined
              )
                event.currentTarget.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    bubbles: true,
                    key: options.focusKey,
                  }),
                );
            }}
          >
            <DropdownMenuItem
              disabled={!fetchSettingsAvailable}
              onClick={() => showDialog("fetch")}
            >
              Fetch settings
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!cacheAvailable}
              onClick={() => showDialog("cache")}
            >
              History storage
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

export const CommitGraphToolbar = { Frame, Title, Order, Fetch, Options };
