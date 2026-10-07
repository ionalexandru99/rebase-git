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
  readonly key: string;
  readonly repository: OpenProjectRepository;
}

export function projectItems(
  environments: readonly OpenProjectEnvironment[],
  query: string,
): readonly OpenProjectRepositoryItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return environments
    .flatMap((environment) =>
      environment.repositories
        .filter(
          (repository) =>
            repository.name.toLocaleLowerCase().includes(normalizedQuery) ||
            repository.path.toLocaleLowerCase().includes(normalizedQuery),
        )
        .map((repository) => ({
          disabled: environment.availability !== "available",
          key: `project:${environment.id}:${repository.id}`,
          repository,
        })),
    )
    .sort(compareRecentRepositories);
}

export function formatLastOpened(
  lastOpenedAt: string,
  nowMilliseconds: number,
): string {
  const now = new Date(nowMilliseconds);
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
  readonly visibility?: "Private" | "Public";
  readonly description?: string;
  readonly updatedAt?: string;
}

export interface CloneGroup {
  readonly id: string;
  readonly kind: GitHostKind;
  readonly account: string;
  readonly server?: string;
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
  return hosts.map((host) => {
    const ownPrefix = `${host.account.toLocaleLowerCase()}/`;
    const markedPrivate = minorityVisibility(host);
    return {
      id: `host:${host.kind}:${host.host}:${host.account}`,
      kind: host.kind,
      account: host.account,
      ...(hosts.filter(
        ({ kind, repositories }) =>
          kind === host.kind && repositories.length > 0,
      ).length > 1
        ? { server: host.host }
        : {}),
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
          key: `clone:${host.kind}:${host.host}:${host.account}:${repository.name}`,
          name: repository.name.split("/").at(-1) ?? repository.name,
          label: repository.name.toLocaleLowerCase().startsWith(ownPrefix)
            ? repository.name.slice(ownPrefix.length)
            : repository.name,
          url: repository.url,
          ...(repository.private === markedPrivate
            ? { visibility: repository.private ? "Private" : "Public" }
            : {}),
          ...(repository.description === undefined
            ? {}
            : { description: repository.description }),
          ...(repository.updatedAt === undefined
            ? {}
            : { updatedAt: repository.updatedAt }),
        })),
    };
  });
}

function minorityVisibility({ repositories }: HostRepositories) {
  const privateCount = repositories.filter(
    (repository) => repository.private,
  ).length;
  const publicCount = repositories.length - privateCount;
  if (privateCount === 0 || publicCount === 0) return undefined;
  if (privateCount === publicCount) return undefined;
  return privateCount < publicCount;
}

export function urlSource(query: string): CloneSource | undefined {
  const url = query.trim();
  const location = remoteLocation(url);
  const name = location?.split("/").at(-1);
  if (location === undefined || name === undefined || name === "")
    return undefined;
  return { key: "clone:url", name, label: location, url };
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
