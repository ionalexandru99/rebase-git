import { Effect, Schema } from "effect";
import type { PullRequestsUnavailable } from "#contracts/pull-requests/pull-requests.contract.ts";
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

export function forgejoCloneable(
  cli: TeaCli,
  logins: readonly TeaLogin[],
): Effect.Effect<readonly HostRepositories[]> {
  return Effect.forEach(
    uniqueAccounts(logins),
    (login) =>
      cloneableRepositories(cli, login).pipe(
        Effect.map((list) => [list]),
        Effect.orElseSucceed(() => []),
      ),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((lists) => lists.flat()));
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

function cloneableRepositories(
  cli: TeaCli,
  login: TeaLogin,
): Effect.Effect<HostRepositories, PullRequestsUnavailable> {
  return Effect.gen(function* () {
    const [details, user] = yield* Effect.all(
      [
        cli.login(login.name),
        cli.api(login.name, "/user").pipe(Effect.flatMap(decodeUser)),
      ],
      { concurrency: "unbounded" },
    );
    const ssh = /^\s*SSH Key:/m.test(details);
    const repositories = yield* readRepositoryPages(
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
  });
}

function readRepositoryPage(
  cli: TeaCli,
  login: string,
  user: number,
  page: number,
) {
  return cli
    .api(
      login,
      `/repos/search?${new URLSearchParams({
        uid: String(user),
        sort: "updated",
        order: "desc",
        limit: String(pageSize),
        page: String(page),
      })}`,
    )
    .pipe(
      Effect.flatMap(decodeRepositoryPage),
      Effect.map(({ data }) => data),
    );
}

const decodeUser = decodeHostJson(Schema.Struct({ id: Schema.Int }));

const decodeRepositoryPage = decodeHostJson(
  Schema.Struct({
    data: Schema.Array(
      Schema.Struct({
        full_name: Schema.String,
        private: Schema.Boolean,
        description: Schema.String,
        updated_at: Schema.String,
        clone_url: Schema.String,
        ssh_url: Schema.String,
      }),
    ),
  }),
);
