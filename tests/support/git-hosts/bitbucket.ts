import { Effect } from "effect";
import type { BitbucketClient } from "#server/features/source-control/hosts/bitbucket-host.ts";

interface BitbucketPullRequestNode {
  readonly id: number;
  readonly state?: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
  readonly draft?: boolean;
  readonly fork?: boolean;
  readonly checks?: readonly string[];
}

export function fakeBitbucket(
  bySourceBranch: Readonly<
    Record<string, readonly BitbucketPullRequestNode[]>
  > = {},
  { userStatus = 200 }: { readonly userStatus?: number } = {},
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
