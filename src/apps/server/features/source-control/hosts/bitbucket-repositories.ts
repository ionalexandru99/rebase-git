import { Effect, Schema } from "effect";
import type { PullRequestsUnavailable } from "#contracts/pull-requests/pull-requests.contract.ts";
import type { CloneableRepository } from "#contracts/source-control/source-control.contract.ts";
import { cloneableRepository } from "#server/features/source-control/git-host.ts";
import {
  type BitbucketClient,
  bitbucketApi,
  readJson,
} from "#server/features/source-control/hosts/bitbucket-client.ts";

const repositoriesPerPage = 100;
const repositoryPages = 10;
const workspacesAtOnce = 4;

export function workspacesUrl(pagelen: number) {
  return `${bitbucketApi}/user/workspaces?${new URLSearchParams({
    pagelen: String(pagelen),
    fields: "values.workspace.slug",
  })}`;
}

export function listCloneable(
  client: BitbucketClient,
  authorization: string,
): Effect.Effect<readonly CloneableRepository[], PullRequestsUnavailable> {
  const read = (url: string) =>
    readJson(client, authorization, url, decodeRepositories).pipe(
      Effect.orElseSucceed((): RepositoryPage => ({ values: [] })),
    );
  return readJson(
    client,
    authorization,
    workspacesUrl(repositoriesPerPage),
    decodeWorkspaces,
  ).pipe(
    Effect.flatMap(({ values }) =>
      readPages(
        read,
        values.map(({ workspace }) => workspaceRepositoriesUrl(workspace.slug)),
        repositoryPages,
      ),
    ),
    Effect.map((nodes) =>
      nodes
        .flatMap(cloneableRepositories)
        .toSorted((left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
        )
        .slice(0, repositoriesPerPage * repositoryPages),
    ),
  );
}

function readPages(
  read: (url: string) => Effect.Effect<RepositoryPage>,
  urls: readonly string[],
  budget: number,
): Effect.Effect<readonly RepositoryNode[]> {
  return Effect.forEach(urls, read, { concurrency: workspacesAtOnce }).pipe(
    Effect.flatMap((pages) => {
      const left = budget - urls.length;
      const values = pages.flatMap(({ values }) => values);
      const next = pages
        .flatMap(({ next }) =>
          next?.startsWith(`${bitbucketApi}/`) ? [next] : [],
        )
        .slice(0, Math.max(left, 0));
      return next.length === 0
        ? Effect.succeed(values)
        : readPages(read, next, left).pipe(
            Effect.map((rest) => [...values, ...rest]),
          );
    }),
  );
}

function workspaceRepositoriesUrl(workspace: string) {
  return `${bitbucketApi}/repositories/${encodeURIComponent(workspace)}?${new URLSearchParams(
    {
      role: "member",
      sort: "-updated_on",
      pagelen: String(repositoriesPerPage),
      fields:
        "next,values.full_name,values.is_private,values.description,values.updated_on,values.links.clone",
    },
  )}`;
}

function cloneableRepositories(
  node: RepositoryNode,
): readonly CloneableRepository[] {
  const links = node.links.clone ?? [];
  const url = (
    links.find(({ name }) => name === "ssh") ??
    links.find(({ name }) => name === "https")
  )?.href;
  return url === undefined
    ? []
    : [
        cloneableRepository({
          name: node.full_name,
          url,
          private: node.is_private,
          description: node.description,
          updatedAt: node.updated_on,
        }),
      ];
}

const decodeWorkspaces = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      values: Schema.Array(
        Schema.Struct({ workspace: Schema.Struct({ slug: Schema.String }) }),
      ),
    }),
  ),
);

const RepositoryNode = Schema.Struct({
  full_name: Schema.String,
  is_private: Schema.Boolean,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  updated_on: Schema.optionalKey(Schema.NullOr(Schema.String)),
  links: Schema.Struct({
    clone: Schema.optionalKey(
      Schema.Array(Schema.Struct({ name: Schema.String, href: Schema.String })),
    ),
  }),
});
type RepositoryNode = typeof RepositoryNode.Type;

const RepositoryPage = Schema.Struct({
  values: Schema.Array(RepositoryNode),
  next: Schema.optionalKey(Schema.String),
});
type RepositoryPage = typeof RepositoryPage.Type;

const decodeRepositories = Schema.decodeUnknownEffect(
  Schema.fromJsonString(RepositoryPage),
);
