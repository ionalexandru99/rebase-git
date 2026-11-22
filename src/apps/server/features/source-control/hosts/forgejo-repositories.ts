import { z } from "zod";
import type { HostRepositories } from "#contracts/source-control/source-control.contract.ts";
import {
  cloneableRepository,
  decodeHostJson,
  readRepositoryPages,
} from "#server/features/source-control/git-host.ts";
import type {
  TeaCli,
  TeaLogin,
} from "#server/features/source-control/hosts/forgejo-host.ts";

const pageSize = 50;

export async function forgejoCloneable(
  cli: TeaCli,
  logins: readonly TeaLogin[],
): Promise<readonly HostRepositories[]> {
  const lists = await Promise.all(
    uniqueAccounts(logins).map((login) =>
      cloneableRepositories(cli, login).then(
        (list) => [list],
        () => [],
      ),
    ),
  );
  return lists.flat();
}

function uniqueAccounts(logins: readonly TeaLogin[]) {
  return logins.filter(
    (login, index) =>
      logins.findIndex(
        ({ server, account }) =>
          server === login.server &&
          account.toLowerCase() === login.account.toLowerCase(),
      ) === index,
  );
}

async function cloneableRepositories(
  cli: TeaCli,
  login: TeaLogin,
): Promise<HostRepositories> {
  const [details, user] = await Promise.all([
    cli.login(login.name),
    cli.api(login.name, "/user").then(decodeUser),
  ]);
  const ssh = /^\s*SSH Key:/m.test(details);
  const repositories = await readRepositoryPages(
    (page) => readRepositoryPage(cli, login.name, user.id, page),
    pageSize,
  );
  return {
    kind: "forgejo" as const,
    host: login.server,
    account: login.account,
    repositories: repositories.map((repository) =>
      cloneableRepository({
        name: repository.full_name,
        url:
          ssh && repository.ssh_url !== ""
            ? repository.ssh_url
            : repository.clone_url,
        private: repository.private,
        description: repository.description,
        updatedAt: repository.updated_at,
      }),
    ),
  };
}

async function readRepositoryPage(
  cli: TeaCli,
  login: string,
  user: number,
  page: number,
) {
  const { data } = decodeRepositoryPage(
    await cli.api(
      login,
      `/repos/search?${new URLSearchParams({
        uid: String(user),
        sort: "updated",
        order: "desc",
        limit: String(pageSize),
        page: String(page),
      })}`,
    ),
  );
  return data;
}

const decodeUser = decodeHostJson(z.object({ id: z.number().int() }));

const decodeRepositoryPage = decodeHostJson(
  z.object({
    data: z.array(
      z.object({
        full_name: z.string(),
        private: z.boolean(),
        description: z.string(),
        updated_at: z.string(),
        clone_url: z.string(),
        ssh_url: z.string(),
      }),
    ),
  }),
);
