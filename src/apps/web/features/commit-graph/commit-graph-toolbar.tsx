import { IconArrowDown, IconDots } from "@tabler/icons-react";
import { type Ref, useState } from "react";
import type { RepositoryHistoryCacheDialogProps } from "#web/features/repository-history/diagnostics/repository-history-cache-dialog.contract";
import type { RepositoryFetchAction } from "#web/features/repository-history/freshness/repository-fetch-action.contract";
import { describeRepositoryFetchError } from "#web/features/repository-history/freshness/repository-fetch-error";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";
import type {
  RepositoryHistorySearchActions,
  RepositoryHistorySearchBindings,
} from "#web/features/repository-history/search/repository-history-search-controls.contract";
import { Button } from "#web-ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "#web-ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#web-ui/components/ui/dropdown-menu";
import { RepositoryHistoryCacheDialog } from "#web-ui/features/repository-history/diagnostics/repository-history-cache-dialog";
import { RepositoryFetchSettings } from "#web-ui/features/repository-history/freshness/repository-fetch-settings";
import { RepositoryHistorySearchControls } from "#web-ui/features/repository-history/search/repository-history-search-controls";

export function CommitGraphToolbar({
  repositoryName,
  reader,
  snapshot,
  order,
  onOrderChange,
  searchRef,
  onNavigate,
  searchBindings,
  offline,
  fetchAction,
  fetching,
  canConfigure,
  cache,
}: {
  readonly repositoryName: string;
  readonly reader: RepositoryHistoryReader | undefined;
  readonly snapshot: RepositoryHistorySnapshot;
  readonly order: RepositoryHistoryQuery["order"];
  readonly onOrderChange: (order: RepositoryHistoryQuery["order"]) => void;
  readonly searchRef: Ref<RepositoryHistorySearchActions>;
  readonly onNavigate: (oid: string) => Promise<void>;
  readonly searchBindings: RepositoryHistorySearchBindings;
  readonly offline: boolean;
  readonly fetchAction: RepositoryFetchAction;
  readonly fetching: boolean;
  readonly canConfigure: boolean;
  readonly cache:
    | Pick<RepositoryHistoryCacheDialogProps, "identity" | "onCacheChanged">
    | undefined;
}) {
  const [dialog, setDialog] = useState<"fetch" | "cache">();
  return (
    <>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2">
        <h1
          className="mr-auto min-w-0 max-w-48 truncate text-[13px] font-semibold text-foreground"
          title={repositoryName}
        >
          {repositoryName}
        </h1>
        {reader === undefined ? null : (
          <RepositoryHistorySearchControls
            ref={searchRef}
            reader={reader}
            snapshot={snapshot}
            onNavigate={onNavigate}
            bindings={searchBindings}
            offline={offline}
          />
        )}
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
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="History options"
            render={<Button size="icon-sm" variant="ghost" />}
          >
            <IconDots aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={reader === undefined}
              onClick={() => setDialog("fetch")}
            >
              Fetch settings
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={reader === undefined || cache === undefined}
              onClick={() => setDialog("cache")}
            >
              History storage
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {reader === undefined || dialog === undefined ? null : (
        <>
          <Dialog
            open={dialog === "fetch"}
            onOpenChange={(open) => {
              if (!open) setDialog(undefined);
            }}
          >
            <DialogContent className="max-w-sm">
              <DialogTitle>Fetch settings</DialogTitle>
              <DialogDescription>{repositoryName}</DialogDescription>
              {dialog === "fetch" ? (
                <RepositoryFetchSettings
                  reader={reader}
                  setting={snapshot.freshness?.setting ?? { _tag: "Inherit" }}
                  defaultIntervalSeconds={
                    snapshot.freshness?.defaultIntervalSeconds ?? 300
                  }
                  disabled={
                    !canConfigure ||
                    snapshot.freshness === undefined ||
                    snapshot.freshnessError !== undefined
                  }
                  disabledReason={
                    offline
                      ? "Reconnect to the server and try again."
                      : snapshot.freshnessError !== undefined
                        ? describeRepositoryFetchError(snapshot.freshnessError)
                        : !canConfigure
                          ? "Connect with repository write access to change fetch settings."
                          : "Loading fetch settings."
                  }
                  onSaved={() => setDialog(undefined)}
                />
              ) : null}
            </DialogContent>
          </Dialog>
          {cache === undefined ? null : (
            <RepositoryHistoryCacheDialog
              reader={reader}
              repositoryName={repositoryName}
              {...cache}
              open={dialog === "cache"}
              onOpenChange={(open) => {
                if (!open) setDialog(undefined);
              }}
            />
          )}
        </>
      )}
    </>
  );
}
