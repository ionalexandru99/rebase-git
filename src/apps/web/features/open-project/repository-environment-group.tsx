import { IconChevronDown } from "@tabler/icons-react";
import type { JSX } from "react";
import type {
  OpenProjectEnvironment,
  OpenProjectRepository,
} from "#web/features/open-project/open-project.contract";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#web-ui/components/ui/collapsible";
import { RepositoryRow } from "#web-ui/features/open-project/repository-row";

export function RepositoryEnvironmentGroup({
  activeKey,
  environment,
  onActivate,
  onOpenChange,
  onOpenRepository,
  onOpenSettings,
  open,
}: {
  readonly activeKey: string | undefined;
  readonly environment: OpenProjectEnvironment;
  readonly onActivate: (key: string) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenSettings: (repository: OpenProjectRepository) => void;
  readonly onOpenRepository: (repository: OpenProjectRepository) => void;
  readonly open: boolean;
}): JSX.Element {
  const EnvironmentIcon = environment.icon;

  return (
    <Collapsible onOpenChange={onOpenChange} open={open}>
      <div className="grid h-9 min-w-0 grid-cols-[1.75rem_1.125rem_minmax(0,1fr)_auto] items-center gap-[.45rem] px-1 text-muted-foreground">
        <CollapsibleTrigger
          aria-label={`${open ? "Collapse" : "Expand"} ${environment.name}`}
          className="grid size-7 place-items-center rounded-[.4rem] outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <IconChevronDown
            aria-hidden="true"
            className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </CollapsibleTrigger>
        <EnvironmentIcon
          aria-hidden="true"
          className="size-4.5 shrink-0"
          style={{ color: environment.iconColor }}
        />
        <strong className="truncate text-[.83rem] font-medium text-foreground">
          {environment.name}
        </strong>
        {environment.availability === "unavailable" ? (
          <span
            className="truncate text-xs text-status-unavailable"
            role="status"
          >
            {environment.status}
          </span>
        ) : null}
      </div>
      <CollapsibleContent>
        {environment.repositories.map((repository) => {
          const itemKey = `catalog:${environment.id}:${repository.id}`;
          return (
            <RepositoryRow
              active={activeKey === itemKey}
              available={environment.availability === "available"}
              itemKey={itemKey}
              key={repository.id}
              onActivate={onActivate}
              onOpen={onOpenRepository}
              onOpenSettings={onOpenSettings}
              repository={repository}
            />
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
