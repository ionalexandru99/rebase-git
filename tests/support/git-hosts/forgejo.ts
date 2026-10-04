import { Effect } from "effect";
import type { TeaCli } from "#server/features/source-control/hosts/forgejo-host.ts";

interface ForgejoPullRequestNode {
  readonly number: number;
  readonly state?: "open" | "closed" | "merged";
  readonly draft?: boolean;
  readonly repository?: string;
  readonly status?: string;
}

interface ForgejoRepository {
  readonly name: string;
  readonly private?: boolean;
  readonly description?: string;
}

interface TeaLogin {
  readonly url: string;
  readonly ssh_host?: string;
  readonly user: string;
  readonly sshKey?: string;
}

const serverError = '{"message":"not found","url":"/api/swagger"}';

export function fakeForgejo(
  byHead: Readonly<Record<string, readonly ForgejoPullRequestNode[]>> | null,
  {
    version = "tea 0.16.0",
    logins = [{ url: "https://codeberg.org", user: "forge" }],
    repositories,
  }: {
    readonly version?: string | null;
    readonly logins?: readonly TeaLogin[];
    readonly repositories?: readonly ForgejoRepository[];
  } = {},
) {
  const requests: string[] = [];
  const nodes = Object.entries(byHead ?? {}).flatMap(([head, nodes]) =>
    nodes.map((node) => ({ head, ...node })),
  );
  const loginNamed = (name: string) =>
    logins[Number(name.slice("login-".length))];
  const forgejo: TeaCli = {
    version: Effect.succeed(version ?? undefined),
    logins: Effect.succeed(
      JSON.stringify(
        logins.map(({ sshKey: _, ...login }, index) => ({
          name: `login-${index}`,
          default: "false",
          ...login,
        })),
      ),
    ),
    login: (name) => {
      const login = loginNamed(name);
      return Effect.succeed(
        login === undefined
          ? `Login '${name}' do not exist\n\n`
          : `\n  # ${name}\n\n  @${login.user} ${login.url}/${login.user}\n\n${
              login.sshKey === undefined
                ? ""
                : `  SSH Key: '${login.sshKey}' via ${new URL(login.url).host}\n\n`
            }  Created: 04 Oct 26 10:11 EEST\n\n`,
      );
    },
    api: (login, endpoint) => {
      requests.push(`${login} ${endpoint}`);
      const server = loginNamed(login)?.url ?? "";
      if (endpoint === "/user" || endpoint.startsWith("/repos/search?"))
        return Effect.succeed(
          repositories === undefined
            ? serverError
            : endpoint === "/user"
              ? JSON.stringify({ id: 7, login: loginNamed(login)?.user })
              : repositoryPage(server, repositories, endpoint),
        );
      if (byHead === null) return Effect.succeed(serverError);
      const [, owner, name, rest = ""] =
        /^\/repos\/([^/]+)\/([^/]+)\/(.*)$/.exec(endpoint) ?? [];
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

function repositoryPage(
  server: string,
  repositories: readonly ForgejoRepository[],
  endpoint: string,
) {
  const query = new URLSearchParams(endpoint.split("?")[1]);
  const limit = Number(query.get("limit"));
  const start = (Number(query.get("page")) - 1) * limit;
  return JSON.stringify({
    ok: true,
    data: repositories.slice(start, start + limit).map((repository) => ({
      full_name: repository.name,
      private: repository.private ?? false,
      description: repository.description ?? "",
      updated_at: "2026-10-01T10:00:00Z",
      clone_url: `${server}/${repository.name}.git`,
      ssh_url: `git@${new URL(server).hostname}:${repository.name}.git`,
    })),
  });
}
