import { Effect } from "effect";
import type { BitbucketClient } from "#server/features/source-control/hosts/bitbucket-client.ts";

interface BitbucketPullRequestNode {
  readonly id: number;
  readonly state?: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
  readonly draft?: boolean;
  readonly fork?: boolean;
  readonly checks?: readonly string[];
}

interface BitbucketRepository {
  readonly name: string;
  readonly private?: boolean;
  readonly updatedOn?: string;
}

export function fakeBitbucket(
  bySourceBranch: Readonly<
    Record<string, readonly BitbucketPullRequestNode[]>
  > = {},
  {
    userStatus = 200,
    workspacesStatus = 200,
    repositories = [],
  }: {
    readonly userStatus?: number;
    readonly workspacesStatus?: number;
    readonly repositories?: readonly BitbucketRepository[];
  } = {},
) {
  const requests: { readonly url: string; readonly authorization: string }[] =
    [];
  const nodes = Object.values(bySourceBranch).flat();
  const answer = (body: unknown, status = 200) =>
    Effect.succeed({ status, body: JSON.stringify(body) });
  const bitbucket: BitbucketClient = {
    get: (url, authorization) => {
      requests.push({ url, authorization });
      const { pathname, searchParams } = new URL(url);
      if (pathname === "/2.0/user")
        return answer({ username: "octo", display_name: "Octo" }, userStatus);
      if (pathname === "/2.0/user/workspaces")
        return answer(
          {
            values: [
              ...new Set(repositories.map(({ name }) => name.split("/")[0])),
            ].map((slug) => ({ workspace: { slug } })),
          },
          workspacesStatus,
        );
      const workspace = /^\/2\.0\/repositories\/([^/]+)$/.exec(pathname)?.[1];
      if (workspace !== undefined) {
        const pagelen = Number(searchParams.get("pagelen"));
        const page = Number(searchParams.get("page") ?? 1);
        const all = repositories.filter(({ name }) =>
          name.startsWith(`${workspace}/`),
        );
        const next = new URL(url);
        next.searchParams.set("page", String(page + 1));
        return answer({
          ...(all.length > page * pagelen ? { next: next.href } : {}),
          values: all
            .slice((page - 1) * pagelen, page * pagelen)
            .map((repository) => ({
              full_name: repository.name,
              is_private: repository.private ?? false,
              description: "",
              updated_on:
                repository.updatedOn ?? "2026-10-01T10:00:00.123456+00:00",
              links: {
                clone: [
                  {
                    name: "https",
                    href: `https://octo@bitbucket.org/${repository.name}.git`,
                  },
                  {
                    name: "ssh",
                    href: `git@bitbucket.org:${repository.name}.git`,
                  },
                ],
              },
            })),
        });
      }
      const statuses = /\/commit\/head-(\d+)\/statuses$/.exec(pathname);
      if (statuses !== null)
        return answer({
          values: (
            nodes.find(({ id }) => String(id) === statuses[1])?.checks ?? []
          ).map((state) => ({ state })),
        });
      const fullName = pathname.split("/").slice(3, 5).join("/");
      const branch =
        /source\.branch\.name = "(.*)"/.exec(
          searchParams.get("q") ?? "",
        )?.[1] ?? "";
      return answer({
        values: (bySourceBranch[branch] ?? []).map((node) => ({
          id: node.id,
          title: `Pull request ${node.id}`,
          state: node.state ?? "OPEN",
          draft: node.draft ?? false,
          source: {
            repository: {
              full_name: node.fork === true ? "fork/rebase" : fullName,
            },
            commit: { hash: `head-${node.id}` },
          },
        })),
      });
    },
  };
  return { bitbucket, requests };
}
