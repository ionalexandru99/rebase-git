import type { JSX } from "react";
import type { OpenProjectRepository } from "#web/features/open-project/open-project.contract";
import {
  formatLastOpened,
  type OpenProjectRepositoryItem,
  repositoryInitials,
} from "#web/features/open-project/open-project-state";
import { RepositorySettingsButton } from "#web/features/repository-settings/index";
import { openProjectItemId } from "#web-ui/features/open-project/repository-row";

export function RecentRepositories({
  activeKey,
  items,
  onActivate,
  onOpen,
  onOpenSettings,
}: {
  readonly activeKey: string | undefined;
  readonly items: readonly OpenProjectRepositoryItem[];
  readonly onActivate: (key: string) => void;
  readonly onOpenSettings: (repository: OpenProjectRepository) => void;
  readonly onOpen: (repository: OpenProjectRepository) => void;
}): JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="open-project-recent-heading">
      <h2
        className="mt-[1.85rem] mb-[.55rem] text-xs font-medium text-muted-foreground"
        id="open-project-recent-heading"
      >
        Recent
      </h2>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 max-[650px]:grid-cols-1">
        {items.map((item) => (
          <div
            className="group flex min-w-0 items-center rounded-md pr-1 hover:bg-accent"
            key={item.key}
          >
            <button
              aria-selected={activeKey === item.key}
              className="grid h-16 min-w-0 flex-1 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2.5 text-left text-foreground outline-none hover:bg-accent disabled:opacity-42 data-[active=true]:bg-accent data-[active=true]:shadow-[inset_0_0_0_1px_rgb(124_140_255/48%)]"
              data-active={activeKey === item.key}
              disabled={item.disabled}
              id={openProjectItemId(item.key)}
              onClick={() => onOpen(item.repository)}
              onFocus={() => onActivate(item.key)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <RepositoryInitials name={item.repository.name} />
              <span className="min-w-0">
                <strong className="mb-[.12rem] block truncate text-[.86rem] font-semibold">
                  {item.repository.name}
                </strong>
                <span className="block truncate font-mono text-[.69rem] leading-[1.45] text-muted-foreground">
                  {item.repository.path}
                </span>
              </span>
              <span className="text-right text-[.68rem] text-muted-foreground">
                <span className="mb-[.18rem] block text-foreground/60">
                  {item.environment.name}
                </span>
                <span className="block">
                  {formatLastOpened(item.repository.lastOpenedAt ?? "")}
                </span>
              </span>
            </button>
            <RepositorySettingsButton
              name={item.repository.name}
              onOpen={() => onOpenSettings(item.repository)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function RepositoryInitials({ name }: { readonly name: string }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-[.45rem] bg-secondary text-xs font-semibold text-secondary-foreground">
      {repositoryInitials(name)}
    </span>
  );
}
