import type { JSX } from "react";
import type { OpenProjectRepository } from "#web/features/open-project/open-project.contract";
import { repositoryInitials } from "#web/features/open-project/open-project-state";
import { RepositoryContextMenu } from "#web-ui/features/open-project/repository-context-menu";

export function RepositoryRow({
  active,
  available,
  itemKey,
  onActivate,
  onCopyPath,
  onOpen,
  onRemove,
  onReveal,
  repository,
  revealAvailable,
}: {
  readonly active: boolean;
  readonly available: boolean;
  readonly itemKey: string;
  readonly onActivate: (key: string) => void;
  readonly onCopyPath: (repository: OpenProjectRepository) => void;
  readonly onOpen: (repository: OpenProjectRepository) => void;
  readonly onRemove: (repository: OpenProjectRepository) => void;
  readonly onReveal: (repository: OpenProjectRepository) => void;
  readonly repository: OpenProjectRepository;
  readonly revealAvailable: boolean;
}): JSX.Element {
  return (
    <div
      className="group ml-8 grid h-11 min-w-0 grid-cols-[minmax(0,1fr)_1.75rem] items-center rounded-md px-2.5 hover:bg-accent has-[[aria-expanded=true]]:bg-accent data-[active=true]:bg-accent data-[available=false]:opacity-42"
      data-active={active}
      data-available={available}
    >
      <button
        aria-selected={active}
        className="grid h-full min-w-0 grid-cols-[1.875rem_minmax(0,1fr)] items-center gap-[.7rem] text-left outline-none disabled:pointer-events-none"
        disabled={!available}
        id={openProjectItemId(itemKey)}
        onClick={() => onOpen(repository)}
        onFocus={() => onActivate(itemKey)}
        role="option"
        tabIndex={-1}
        type="button"
      >
        <span className="grid size-7.5 place-items-center rounded-[.45rem] bg-secondary text-[.67rem] font-semibold text-secondary-foreground">
          {repositoryInitials(repository.name)}
        </span>
        <span className="flex min-w-0 items-baseline gap-[.65rem] max-[650px]:block">
          <strong className="shrink-0 truncate text-[.8rem] font-medium text-foreground">
            {repository.name}
          </strong>
          <span className="block min-w-0 truncate font-mono text-[.69rem] leading-[1.45] text-muted-foreground">
            {repository.path}
          </span>
        </span>
      </button>
      <RepositoryContextMenu
        available={available}
        onCopyPath={onCopyPath}
        onRemove={onRemove}
        onReveal={onReveal}
        repository={repository}
        revealAvailable={revealAvailable}
      />
    </div>
  );
}

export function openProjectItemId(itemKey: string): string {
  return `open-project-item-${itemKey.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}
