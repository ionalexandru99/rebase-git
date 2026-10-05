import { execFile } from "node:child_process";
import { Effect, Schema } from "effect";
import type {
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import type {
  BitbucketToken,
  CloneableRepository,
  GitHostKind,
  HostRepositories,
} from "#contracts/source-control/source-control.contract.ts";

export interface GitHostAccount {
  readonly host: string;
  readonly account: string;
}

export type GitHostTool =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "SignedOut"; readonly version: string }
  | {
      readonly _tag: "SignedIn";
      readonly version: string;
      readonly accounts: readonly GitHostAccount[];
    }
  | { readonly _tag: "Token"; readonly saved: BitbucketToken | null };

export type HostedPullRequest = PullRequest & { readonly headCommit?: string };

export type PullRequestsByHead = ReadonlyMap<
  string,
  readonly HostedPullRequest[]
>;

export type HeadAnswer = readonly HostedPullRequest[] | undefined;

export interface HostedRepository {
  readonly id: string;
  readonly pullRequests: (
    heads: readonly string[],
  ) => Effect.Effect<PullRequestsByHead, PullRequestsUnavailable>;
  readonly pullRequest: (
    number: number,
  ) => Effect.Effect<HostedPullRequest | undefined>;
}

export interface GitHost {
  readonly kind: GitHostKind;
  readonly tool: Effect.Effect<GitHostTool>;
  readonly repositoryId: (remoteUrl: string) => string | undefined;
  readonly repository: (
    remoteUrl: string,
  ) => Effect.Effect<HostedRepository | undefined>;
  readonly cloneable?: Effect.Effect<readonly HostRepositories[]>;
}

interface HostCommandResult {
  readonly succeeded: boolean;
  readonly stdout: string;
  readonly output: string;
}

export interface HostResponse {
  readonly status: number;
  readonly body: string;
  readonly scopes?: readonly string[];
}

export const unavailable: PullRequestsUnavailable = {
  _tag: "PullRequestsUnavailable",
};

const accountsShown = 16;
export const repositoriesPerPage = 100;
const repositoriesListed = 1_000;

export function repositoryFor(hosts: readonly GitHost[], remoteUrl: string) {
  return Effect.gen(function* () {
    for (const host of hosts) {
      const repository = yield* host.repository(remoteUrl);
      if (repository !== undefined) return { host, repository };
    }
    return undefined;
  });
}

export function signedInTool(
  version: Effect.Effect<string | undefined>,
  accounts: Effect.Effect<readonly GitHostAccount[]>,
): Effect.Effect<GitHostTool> {
  return Effect.gen(function* () {
    const installed = yield* version;
    if (installed === undefined) return { _tag: "Missing" } as const;
    const signedIn = (yield* accounts).slice(0, accountsShown);
    return signedIn.length === 0
      ? ({ _tag: "SignedOut", version: installed } as const)
      : ({ _tag: "SignedIn", version: installed, accounts: signedIn } as const);
  });
}

export function singleAccount(
  host: string,
  account: Effect.Effect<string | undefined>,
): Effect.Effect<readonly GitHostAccount[]> {
  return account.pipe(
    Effect.map((signedIn) =>
      signedIn === undefined ? [] : [{ host, account: signedIn }],
    ),
  );
}

export function runHostCommand(
  command: string,
  args: readonly string[],
  {
    env = {},
    shim = false,
  }: {
    readonly env?: Readonly<Record<string, string>>;
    readonly shim?: boolean;
  } = {},
): Effect.Effect<HostCommandResult> {
  const [file, prefix] =
    shim && process.platform === "win32"
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/c", command]]
      : [command, []];
  return Effect.callback((resume, signal) => {
    execFile(
      file,
      [...prefix, ...args],
      {
        env: { ...process.env, ...env },
        maxBuffer: 16 * 1_048_576,
        signal,
        timeout: 30_000,
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        resume(
          Effect.succeed({
            succeeded: error === null,
            stdout,
            output: `${stdout}\n${stderr}`,
          }),
        ),
    );
  });
}

export function hostCommandOutput(
  command: string,
  args: readonly string[],
  options?: Parameters<typeof runHostCommand>[2],
): Effect.Effect<string, PullRequestsUnavailable> {
  return runHostCommand(command, args, options).pipe(
    Effect.flatMap(({ succeeded, stdout }) =>
      succeeded ? Effect.succeed(stdout) : Effect.fail(unavailable),
    ),
  );
}

export function hostGet(
  url: string,
  headers: Readonly<Record<string, string>>,
): Effect.Effect<HostResponse, PullRequestsUnavailable> {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        headers: { accept: "application/json", ...headers },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      const scopes = response.headers.get("x-oauth-scopes");
      return {
        status: response.status,
        body: await response.text(),
        ...(scopes === null
          ? {}
          : {
              scopes: scopes
                .split(",")
                .map((scope) => scope.trim())
                .filter(Boolean),
            }),
      };
    },
    catch: () => unavailable,
  });
}

export function readRepositoryPages<A>(
  readPage: (
    page: number,
  ) => Effect.Effect<readonly A[], PullRequestsUnavailable>,
  pageSize = repositoriesPerPage,
  page = 1,
): Effect.Effect<readonly A[], PullRequestsUnavailable> {
  return readPage(page).pipe(
    Effect.flatMap((repositories) =>
      repositories.length < pageSize || page * pageSize >= repositoriesListed
        ? Effect.succeed(repositories)
        : readRepositoryPages(readPage, pageSize, page + 1).pipe(
            Effect.map((next) => [...repositories, ...next]),
          ),
    ),
  );
}

export function decodeHostJson<A>(schema: Schema.Codec<A, unknown>) {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
  return (output: string): Effect.Effect<A, PullRequestsUnavailable> =>
    decode(output).pipe(Effect.mapError(() => unavailable));
}

export function cloneableRepository(fields: {
  readonly name: string;
  readonly url: string;
  readonly private: boolean;
  readonly description: string | null | undefined;
  readonly updatedAt: string | null | undefined;
}): CloneableRepository {
  const updatedAt = Date.parse(fields.updatedAt ?? "");
  return {
    name: fields.name,
    url: fields.url,
    private: fields.private,
    ...(fields.description
      ? { description: fields.description.slice(0, 1_024) }
      : {}),
    ...(Number.isNaN(updatedAt)
      ? {}
      : { updatedAt: new Date(updatedAt).toISOString() }),
  };
}

export function pullRequest(
  fields: Omit<PullRequest, "checks">,
  checks: PullRequest["checks"],
  headCommit?: string | null,
): HostedPullRequest {
  return {
    ...fields,
    ...(checks === undefined ? {} : { checks }),
    ...(headCommit === undefined || headCommit === null ? {} : { headCommit }),
  };
}

export function eachHead(
  heads: readonly string[],
  concurrency: number,
  read: (head: string) => Effect.Effect<HeadAnswer, PullRequestsUnavailable>,
): Effect.Effect<PullRequestsByHead, PullRequestsUnavailable> {
  return Effect.forEach(
    heads,
    (head) => read(head).pipe(Effect.map((found) => [head, found] as const)),
    { concurrency },
  ).pipe(Effect.map(answeredHeads));
}

export function inBatches(
  heads: readonly string[],
  size: number,
  read: (
    batch: readonly string[],
  ) => Effect.Effect<readonly HeadAnswer[], PullRequestsUnavailable>,
): Effect.Effect<PullRequestsByHead, PullRequestsUnavailable> {
  const batches = Array.from(
    { length: Math.ceil(heads.length / size) },
    (_, index) => heads.slice(index * size, index * size + size),
  );
  return Effect.forEach(
    batches,
    (batch) =>
      read(batch).pipe(
        Effect.map((answers) =>
          batch.map((head, index) => [head, answers[index]] as const),
        ),
      ),
    { concurrency: 4 },
  ).pipe(Effect.map((entries) => answeredHeads(entries.flat())));
}

export function pageAnswer(
  read: number,
  pageSize: number,
  found: readonly HostedPullRequest[],
): HeadAnswer {
  return read < pageSize || found.length > 0 ? found : undefined;
}

function answeredHeads(
  entries: readonly (readonly [string, HeadAnswer])[],
): PullRequestsByHead {
  return new Map(
    entries.flatMap(([head, found]) =>
      found === undefined ? [] : [[head, found] as const],
    ),
  );
}
