import { Effect } from "effect";
import type { TeaCli } from "#server/features/source-control/hosts/forgejo-host.ts";

interface ForgejoPullRequestNode {
  readonly number: number;
  readonly state?: "open" | "closed" | "merged";
  readonly draft?: boolean;
  readonly repository?: string;
  readonly status?: string;
}

export function fakeForgejo(
  byHead: Readonly<Record<string, readonly ForgejoPullRequestNode[]>> | null,
  {
    version = "tea 0.16.0",
    logins = [{ url: "https://codeberg.org", user: "forge" }],
  }: {
    readonly version?: string | null;
    readonly logins?: readonly {
      readonly url: string;
      readonly ssh_host?: string;
      readonly user: string;
    }[];
  } = {},
) {
  const requests: string[] = [];
  const nodes = Object.entries(byHead ?? {}).flatMap(([head, nodes]) =>
    nodes.map((node) => ({ head, ...node })),
  );
  const forgejo: TeaCli = {
    version: Effect.succeed(version ?? undefined),
    logins: Effect.succeed(
      JSON.stringify(
        logins.map((login, index) => ({
          name: `login-${index}`,
          default: "false",
          ...login,
        })),
      ),
    ),
    api: (login, endpoint) => {
      requests.push(`${login} ${endpoint}`);
      if (byHead === null)
        return Effect.succeed('{"message":"not found","url":"/api/swagger"}');
      const [, owner, name, rest = ""] =
        /^\/repos\/([^/]+)\/([^/]+)\/(.*)$/.exec(endpoint) ?? [];
      const server = logins[Number(login.slice("login-".length))]?.url;
      const status = /^commits\/(\d+)\/status$/.exec(rest)?.[1];
      if (status !== undefined) {
        const state = nodes.find(
          ({ number }) => String(number) === status,
        )?.status;
        return Effect.succeed(
          JSON.stringify({
            state: state ?? "pending",
            total_count: state === undefined ? 0 : 1,
          }),
        );
      }
      const query = new URLSearchParams(rest.split("?")[1]);
      const limit = Number(query.get("limit") ?? nodes.length);
      const start = (Number(query.get("page") ?? 1) - 1) * limit;
      return Effect.succeed(
        JSON.stringify(
          nodes.slice(start, start + limit).map((node) => ({
            number: node.number,
            html_url: `${server}/${owner}/${name}/pulls/${node.number}`,
            title: `Pull request ${node.number}`,
            state:
              node.state === "open" || node.state === undefined
                ? "open"
                : "closed",
            merged: node.state === "merged",
            draft: node.draft ?? false,
            head: {
              ref: node.head,
              sha: String(node.number),
              repo: { full_name: node.repository ?? `${owner}/${name}` },
            },
          })),
        ),
      );
    },
  };
  return { forgejo, requests };
}
