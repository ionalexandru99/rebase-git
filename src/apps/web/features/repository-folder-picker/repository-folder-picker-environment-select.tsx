import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import type { JSX } from "react";
import type { RepositoryFolderPickerEnvironment } from "#web/features/repository-folder-picker/repository-folder-picker.contract";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#web-ui/components/ui/dropdown-menu";

export function RepositoryFolderPickerEnvironmentSelect({
  environments,
  onSelect,
  selected,
}: {
  readonly environments: readonly RepositoryFolderPickerEnvironment[];
  readonly onSelect: (environmentId: string) => void;
  readonly selected: RepositoryFolderPickerEnvironment;
}): JSX.Element {
  const SelectedIcon = selected.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Select Environment"
        className="flex h-8 max-w-64 items-center gap-2 rounded-md border border-border bg-white/[.03] px-2.5 text-xs font-medium text-foreground/85 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <SelectedIcon
          aria-hidden="true"
          className="size-4 shrink-0"
          style={{ color: selected.iconColor }}
        />
        <span className="truncate">{selected.name}</span>
        <IconChevronDown
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {environments.map((environment) => {
          const EnvironmentIcon = environment.icon;
          const unavailable = environment.availability !== "available";
          return (
            <DropdownMenuItem
              className="h-auto min-h-9"
              key={environment.id}
              onClick={() => onSelect(environment.id)}
            >
              <EnvironmentIcon
                aria-hidden="true"
                style={{ color: environment.iconColor }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{environment.name}</span>
                {unavailable ? (
                  <span className="mt-0.5 block truncate text-[.66rem] text-muted-foreground">
                    {environment.status}
                  </span>
                ) : null}
              </span>
              {environment.id === selected.id ? (
                <IconCheck aria-hidden="true" className="text-primary" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
