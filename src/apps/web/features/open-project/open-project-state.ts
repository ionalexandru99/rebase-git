import type {
  GitHostKind,
  HostRepositories,
} from "#contracts/source-control/source-control.contract.ts";
import type {
  OpenProjectEnvironment,
  OpenProjectRepository,
} from "#web/features/open-project/open-project-model.ts";

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

export interface CloneSource {
  readonly key: string;
  readonly name: string;
  readonly label: string;
  readonly url: string;
  readonly private: boolean;
  readonly description?: string;
  readonly updatedAt?: string;
}

export interface CloneGroup {
  readonly id: string;
  readonly kind: GitHostKind;
  readonly account: string;
  readonly sources: readonly CloneSource[];
}

export type OpenProjectKeyboardItem =
  | OpenProjectRepositoryItem
  | { readonly key: string; readonly source: CloneSource };

const sourcesShownWithoutQuery = 8;
const sourcesShownForQuery = 50;

export function cloneGroups(
  hosts: readonly HostRepositories[],
  query: string,
): readonly CloneGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return hosts.map((host) => ({
    id: `host:${host.kind}:${host.account}`,
    kind: host.kind,
    account: host.account,
    sources: host.repositories
      .filter(
        (repository) =>
          normalizedQuery.length === 0 ||
          repository.name.toLocaleLowerCase().includes(normalizedQuery) ||
          (repository.description?.toLocaleLowerCase() ?? "").includes(
            normalizedQuery,
          ),
      )
      .slice(
        0,
        normalizedQuery.length === 0
          ? sourcesShownWithoutQuery
          : sourcesShownForQuery,
      )
      .map((repository) => ({
        key: `clone:${host.kind}:${host.account}:${repository.name}`,
        name: repository.name.split("/").at(-1) ?? repository.name,
        label: repository.name,
        url: repository.url,
        private: repository.private,
        ...(repository.description === undefined
          ? {}
          : { description: repository.description }),
        ...(repository.updatedAt === undefined
          ? {}
          : { updatedAt: repository.updatedAt }),
      })),
  }));
}

export function urlSource(query: string): CloneSource | undefined {
  const url = query.trim();
  const location = remoteLocation(url);
  const name = location?.split("/").at(-1);
  if (location === undefined || name === undefined || name === "")
    return undefined;
  return { key: "clone:url", name, label: location, url, private: false };
}

function remoteLocation(url: string) {
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(\S+)$/.exec(url);
  if (scp !== null) return trimRepositoryPath(`${scp[1]}/${scp[2]}`);
  if (!/^(?:https?|ssh|git):\/\/\S+$/i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    return trimRepositoryPath(`${parsed.host}${parsed.pathname}`);
  } catch {
    return undefined;
  }
}

function trimRepositoryPath(path: string) {
  return path.replace(/\/+$/, "").replace(/\.git$/, "");
}
