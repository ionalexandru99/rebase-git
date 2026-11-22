import { z } from "zod";
import type { CloneableRepository } from "#contracts/source-control/source-control.contract.ts";
import {
  cloneableRepository,
  type HostJsonReader,
  mapConcurrently,
} from "#server/features/source-control/git-host.ts";

export const bitbucketApi = "https://api.bitbucket.org/2.0";
const repositoriesPerPage = 100;
const repositoryPages = 10;
const workspacesAtOnce = 4;

export function workspacesUrl(pagelen: number) {
  return `${bitbucketApi}/user/workspaces?${new URLSearchParams({
    pagelen: String(pagelen),
    fields: "values.workspace.slug",
  })}`;
}

export async function listCloneable(
  read: HostJsonReader,
): Promise<readonly CloneableRepository[]> {
  const { values } = await read(workspacesUrl(repositoriesPerPage), Workspaces);
  const nodes = await readPages(
    (url) =>
      read(url, RepositoryPage).catch((): RepositoryPage => ({ values: [] })),
    values.map(({ workspace }) => workspaceRepositoriesUrl(workspace.slug)),
    repositoryPages,
  );
  return nodes
    .flatMap(cloneableRepositories)
    .toSorted((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    )
    .slice(0, repositoriesPerPage * repositoryPages);
}

async function readPages(
  read: (url: string) => Promise<RepositoryPage>,
  urls: readonly string[],
  budget: number,
): Promise<readonly RepositoryNode[]> {
  const nodes: RepositoryNode[] = [];
  let pending = urls;
  let left = budget;
  while (pending.length > 0) {
    const pages = await mapConcurrently(pending, workspacesAtOnce, read);
    left -= pending.length;
    nodes.push(...pages.flatMap(({ values }) => values));
    pending = pages
      .flatMap(({ next }) =>
        next?.startsWith(`${bitbucketApi}/`) ? [next] : [],
      )
      .slice(0, Math.max(left, 0));
  }
  return nodes;
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

const Workspaces = z.object({
  values: z.array(z.object({ workspace: z.object({ slug: z.string() }) })),
});

const RepositoryNode = z.object({
  full_name: z.string(),
  is_private: z.boolean(),
  description: z.string().nullable().optional(),
  updated_on: z.string().nullable().optional(),
  links: z.object({
    clone: z.array(z.object({ name: z.string(), href: z.string() })).optional(),
  }),
});
type RepositoryNode = z.infer<typeof RepositoryNode>;

const RepositoryPage = z.object({
  values: z.array(RepositoryNode),
  next: z.string().optional(),
});
type RepositoryPage = z.infer<typeof RepositoryPage>;
