import { IconArrowDown, IconDots } from "@tabler/icons-react";
import { useState } from "react";
import type { RepositoryFetchAction } from "#web/features/repository-history/freshness/repository-fetch-action.contract";
import type {
  RepositoryHistoryReader,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#web-ui/components/ui/popover";
import { RepositoryFetchSettings } from "#web-ui/features/repository-history/freshness/repository-fetch-settings";

export function RepositoryHistoryFetchControls({
  reader,
  snapshot,
  fetchAction,
  fetching = snapshot.freshness?.fetching === true,
  canConfigure = true,
}: {
  readonly reader: RepositoryHistoryReader;
  readonly snapshot: RepositoryHistorySnapshot;
  readonly fetchAction: RepositoryFetchAction;
  readonly fetching?: boolean;
  readonly canConfigure?: boolean;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const freshness = snapshot.freshness;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        aria-keyshortcuts={fetchAction.ariaKeyShortcuts}
        className="gap-1.5 text-xs"
        disabled={fetchAction.disabled || fetching}
        onClick={fetchAction.execute}
        size="sm"
        title={
          fetchAction.disabledReason ??
          (fetchAction.shortcut === undefined
            ? "Fetch"
            : `Fetch (${fetchAction.shortcut})`)
        }
        variant="outline"
      >
        <IconArrowDown aria-hidden="true" className="size-3.5" />
        {fetching ? "Fetching" : "Fetch"}
      </Button>
      <Popover onOpenChange={setSettingsOpen} open={settingsOpen}>
        <PopoverTrigger
          aria-label="Repository fetch settings"
          render={<Button size="icon-sm" variant="ghost" />}
        >
          <IconDots aria-hidden="true" className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          aria-label="Repository fetch settings"
          className="w-72 max-w-[calc(100vw-2rem)]"
        >
          <RepositoryFetchSettings
            defaultIntervalSeconds={freshness?.defaultIntervalSeconds ?? 300}
            disabled={
              !canConfigure ||
              freshness === undefined ||
              snapshot.freshnessError !== undefined
            }
            onSaved={() => setSettingsOpen(false)}
            reader={reader}
            setting={freshness?.setting ?? { _tag: "Inherit" }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
