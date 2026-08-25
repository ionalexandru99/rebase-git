import type {
  OpenProjectEnvironment,
  OpenProjectRepository,
} from "#web/features/open-project/open-project.contract";

const repositoryNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export interface OpenProjectRepositoryItem {
  readonly disabled: boolean;
  readonly environment: OpenProjectEnvironment;
  readonly key: string;
  readonly repository: OpenProjectRepository;
}

export function filterOpenProjectEnvironments(
  environments: readonly OpenProjectEnvironment[],
  query: string,
): readonly OpenProjectEnvironment[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return environments.map((environment) => {
    const environmentMatches = environment.name
      .toLocaleLowerCase()
      .includes(normalizedQuery);
    const repositories = sortedRepositories(environment.repositories).filter(
      (repository) =>
        normalizedQuery.length === 0 ||
        environmentMatches ||
        repository.name.toLocaleLowerCase().includes(normalizedQuery) ||
        repository.path.toLocaleLowerCase().includes(normalizedQuery),
    );

    return { ...environment, repositories };
  });
}

export function recentRepositoryItems(
  environments: readonly OpenProjectEnvironment[],
): readonly OpenProjectRepositoryItem[] {
  return environments
    .flatMap((environment) =>
      environment.repositories.map((repository) => ({
        disabled: environment.availability !== "available",
        environment,
        key: `recent:${environment.id}:${repository.id}`,
        repository,
      })),
    )
    .filter((item) => item.repository.lastOpenedAt !== undefined)
    .sort(compareRecentRepositories)
    .slice(0, 4);
}

export function catalogRepositoryItems(
  environments: readonly OpenProjectEnvironment[],
  expandedEnvironmentIds: ReadonlySet<string>,
): readonly OpenProjectRepositoryItem[] {
  return environments.flatMap((environment) =>
    expandedEnvironmentIds.has(environment.id)
      ? sortedRepositories(environment.repositories).map((repository) => ({
          disabled: environment.availability !== "available",
          environment,
          key: `catalog:${environment.id}:${repository.id}`,
          repository,
        }))
      : [],
  );
}

export function keyboardRepositoryItems(
  recent: readonly OpenProjectRepositoryItem[],
  catalog: readonly OpenProjectRepositoryItem[],
): readonly OpenProjectRepositoryItem[] {
  return [...recent, ...catalog].filter((item) => !item.disabled);
}

export function repositoryInitials(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part[0])
    .filter((character): character is string => character !== undefined)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatLastOpened(
  lastOpenedAt: string,
  now: Date = new Date(),
): string {
  const openedAt = new Date(lastOpenedAt);
  const elapsedMilliseconds = Math.max(0, now.getTime() - openedAt.getTime());
  const elapsedHours = Math.floor(elapsedMilliseconds / 3_600_000);

  if (elapsedHours < 1) {
    const elapsedMinutes = Math.max(
      1,
      Math.floor(elapsedMilliseconds / 60_000),
    );
    return `${elapsedMinutes}m`;
  }

  if (elapsedHours < 24 && sameCalendarDay(openedAt, now)) {
    return `${elapsedHours}h`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameCalendarDay(openedAt, yesterday)) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: openedAt.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(openedAt);
}

function sortedRepositories(
  repositories: readonly OpenProjectRepository[],
): readonly OpenProjectRepository[] {
  return repositories.toSorted((left, right) =>
    repositoryNameCollator.compare(left.name, right.name),
  );
}

function compareRecentRepositories(
  left: OpenProjectRepositoryItem,
  right: OpenProjectRepositoryItem,
): number {
  const recency =
    new Date(right.repository.lastOpenedAt ?? 0).getTime() -
    new Date(left.repository.lastOpenedAt ?? 0).getTime();
  return (
    recency ||
    repositoryNameCollator.compare(left.repository.name, right.repository.name)
  );
}

function sameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
