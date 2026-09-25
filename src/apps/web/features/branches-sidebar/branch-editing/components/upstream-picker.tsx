import { Combobox } from "@base-ui/react/combobox";
import type {
  BranchUpstreamTarget,
  LocalBranch,
  RemoteBranch,
} from "@rebase/contracts";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import { useMemo } from "react";

interface UpstreamChoice {
  readonly label: string;
  readonly upstream: BranchUpstreamTarget | null;
}

const noUpstream: UpstreamChoice = { label: "None", upstream: null };
const visibleChoices = 100;

export function UpstreamPicker({
  anchor,
  branch,
  onChoose,
  onClose,
  remoteBranches,
}: {
  readonly anchor: () => Element | null;
  readonly branch: LocalBranch;
  readonly onChoose: (upstream: BranchUpstreamTarget | null) => void;
  readonly onClose: () => void;
  readonly remoteBranches: readonly RemoteBranch[];
}) {
  const choices = useMemo(
    () => [
      ...remoteBranches.map(
        ({ name, remote }): UpstreamChoice => ({
          label: `${remote}/${name}`,
          upstream: { name, remote },
        }),
      ),
      noUpstream,
    ],
    [remoteBranches],
  );
  const current =
    choices.find((choice) => choice.label === branch.upstream?.name) ??
    noUpstream;
  return (
    <Combobox.Root
      autoHighlight
      isItemEqualToValue={(item, value) => item.label === value.label}
      itemToStringLabel={(item) => item.label}
      items={choices}
      limit={visibleChoices}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onValueChange={(choice) => {
        if (choice === null) return;
        onChoose(choice.upstream);
      }}
      open
      value={current}
    >
      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          anchor={anchor}
          className="isolate z-50"
          sideOffset={4}
        >
          <Combobox.Popup
            aria-label={`Upstream for ${branch.name}`}
            className="w-80 max-w-[var(--available-width)] rounded-[.55rem] border border-border bg-popover p-[.3rem] text-popover-foreground shadow-[0_.75rem_2.5rem_rgb(0_0_0/45%)] outline-none"
          >
            <div className="-mx-[.3rem] -mt-[.3rem] mb-1 flex items-center gap-2 border-border border-b px-2.5">
              <IconSearch
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <Combobox.Input
                aria-label="Filter remote branches"
                className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                placeholder="Filter remote branches"
              />
            </div>
            <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">
              No remote branches match.
            </Combobox.Empty>
            <Combobox.List className="max-h-72 overflow-y-auto">
              {(choice: UpstreamChoice) => (
                <Combobox.Item
                  className="flex h-8 cursor-default items-center gap-2 rounded-[.35rem] px-2 text-xs text-foreground/80 outline-none select-none data-highlighted:bg-accent data-highlighted:text-foreground"
                  key={choice.label}
                  value={choice}
                >
                  <span className="grid size-3.5 shrink-0 place-items-center text-primary">
                    <Combobox.ItemIndicator>
                      <IconCheck aria-hidden="true" className="size-3.5" />
                    </Combobox.ItemIndicator>
                  </span>
                  <span className="truncate">{choice.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
