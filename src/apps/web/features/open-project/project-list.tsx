import type { JSX } from "react";
import type { OpenProjectRepository } from "#web/features/open-project/open-project-model.ts";
import {
  formatLastOpened,
  type OpenProjectRepositoryItem,
} from "#web/features/open-project/open-project-state.ts";
import { RepositoryBadge } from "#web/features/repository-catalog/repository-badge.tsx";
import { RepositorySettingsButton } from "#web/features/repository-settings/components/repository-settings-button.tsx";
import { useNow } from "#web/lib/age-label.ts";

export function ProjectList({
  activeKey,
  hiddenCount,
  items,
  onActivate,
  onOpen,
  onOpenSettings,
  onShowAll,
}: {
  readonly activeKey: string | undefined;
  readonly hiddenCount: number;
  readonly items: readonly OpenProjectRepositoryItem[];
  readonly onActivate: (key: string) => void;
  readonly onOpen: (repository: OpenProjectRepository) => void;
  readonly onOpenSettings: (repository: OpenProjectRepository) => void;
  readonly onShowAll: () => void;
}): JSX.Element | null {
  const now = useNow();
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="open-project-projects-heading">
      <OpenProjectSectionHeading id="open-project-projects-heading">
        Projects
      </OpenProjectSectionHeading>
      {items.map((item) => (
        <div
          className="group grid h-11 min-w-0 grid-cols-[minmax(0,1fr)_1.75rem] items-center rounded-control px-2.5 hover:bg-accent has-[[aria-expanded=true]]:bg-accent data-[active=true]:bg-accent data-[available=false]:opacity-40"
          data-active={activeKey === item.key}
          data-available={!item.disabled}
          key={item.key}
        >
          <button
            aria-selected={activeKey === item.key}
            className="grid h-full min-w-0 grid-cols-[1.875rem_minmax(0,1fr)_auto] items-center gap-[.7rem] text-left outline-none disabled:pointer-events-none"
            disabled={item.disabled}
            id={openProjectItemId(item.key)}
            onClick={() => onOpen(item.repository)}
            onFocus={() => onActivate(item.key)}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <RepositoryBadge
              className="size-7.5 rounded-control text-meta"
              color={item.repository.color}
              name={item.repository.name}
            />
            <span className="flex min-w-0 items-baseline gap-[.65rem] max-[650px]:block">
              <strong className="shrink-0 truncate text-body font-medium text-foreground">
                {item.repository.name}
              </strong>
              <span className="block min-w-0 truncate font-mono text-meta leading-[1.45] text-muted-foreground">
                {item.repository.path}
              </span>
            </span>
            <span className="text-meta text-muted-foreground">
              {item.repository.lastOpenedAt === undefined
                ? null
                : formatLastOpened(item.repository.lastOpenedAt, now)}
            </span>
          </button>
          <RepositorySettingsButton
            name={item.repository.name}
            onOpen={() => onOpenSettings(item.repository)}
          />
        </div>
      ))}
      {hiddenCount === 0 ? null : (
        <button
          className="h-8 rounded-control px-2.5 text-body font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={onShowAll}
          type="button"
        >
          Show all {items.length + hiddenCount} projects
        </button>
      )}
    </section>
  );
}

export function OpenProjectSectionHeading({
  children,
  id,
}: {
  readonly children: string;
  readonly id: string;
}): JSX.Element {
  return (
    <h2 className="mb-2 text-meta font-medium text-muted-foreground" id={id}>
      {children}
    </h2>
  );
}

export function openProjectItemId(itemKey: string): string {
  return `open-project-item-${itemKey.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}
