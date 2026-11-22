import { execFile } from "node:child_process";
import type { z } from "zod";
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
import { currentRequest } from "#server/adapters/environment-transport/environment-routes.ts";

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

export interface AvatarAuthor {
  readonly commit: string;
  readonly email: string;
}

export interface AvatarSource {
  readonly url: string;
  readonly authorization?: string;
}

export type HostAvatar =
  | { readonly answered: false }
  | { readonly answered: true; readonly source?: AvatarSource };

export interface HostedRepository {
  readonly id: string;
  readonly pullRequests: (
    heads: readonly string[],
  ) => Promise<PullRequestsByHead>;
  readonly pullRequest: (
    number: number,
  ) => Promise<HostedPullRequest | undefined>;
  readonly avatar: (author: AvatarAuthor) => Promise<HostAvatar>;
}

export interface GitHost {
  readonly kind: GitHostKind;
  readonly tool: () => Promise<GitHostTool>;
  readonly repositoryId: (remoteUrl: string) => string | undefined;
  readonly repository: (
    remoteUrl: string,
  ) => Promise<HostedRepository | undefined>;
  readonly cloneable?: () => Promise<readonly HostRepositories[]>;
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

export async function repositoryFor(
  hosts: readonly GitHost[],
  remoteUrl: string,
) {
  for (const host of hosts) {
    const repository = await host.repository(remoteUrl);
    if (repository !== undefined) return { host, repository };
  }
  return undefined;
}

export function signedInTool(
  version: () => Promise<string | undefined>,
  accounts: () => Promise<readonly GitHostAccount[]>,
) {
  return async (): Promise<GitHostTool> => {
    const installed = await version();
    if (installed === undefined) return { _tag: "Missing" };
    const signedIn = (await accounts()).slice(0, accountsShown);
    return signedIn.length === 0
      ? { _tag: "SignedOut", version: installed }
      : { _tag: "SignedIn", version: installed, accounts: signedIn };
  };
}

export function singleAccount(
  host: string,
  account: () => Promise<string | undefined>,
) {
  return async (): Promise<readonly GitHostAccount[]> => {
    const signedIn = await account();
    return signedIn === undefined ? [] : [{ host, account: signedIn }];
  };
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
): Promise<HostCommandResult> {
  const [file, prefix] =
    shim && process.platform === "win32"
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/c", command]]
      : [command, []];
  const signal = currentRequest()?.signal;
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...prefix, ...args],
      {
        env: { ...process.env, ...env },
        maxBuffer: 16 * 1_048_576,
        ...(signal === undefined ? {} : { signal }),
        timeout: 30_000,
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        signal?.aborted
          ? reject(signal.reason)
          : resolve({
              succeeded: error === null,
              stdout,
              output: `${stdout}\n${stderr}`,
            }),
    );
  });
}

export async function hostCommandOutput(
  command: string,
  args: readonly string[],
  options?: Parameters<typeof runHostCommand>[2],
) {
  const { succeeded, stdout } = await runHostCommand(command, args, options);
  if (!succeeded) throw unavailable;
  return stdout;
}

export async function hostGet(
  url: string,
  headers: Readonly<Record<string, string>>,
  timeoutMilliseconds = 30_000,
): Promise<HostResponse> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", ...headers },
      redirect: "error",
      signal: withRequestSignal(AbortSignal.timeout(timeoutMilliseconds)),
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
  } catch {
    throw unavailable;
  }
}

export function withRequestSignal(signal: AbortSignal) {
  const request = currentRequest()?.signal;
  return request === undefined ? signal : AbortSignal.any([request, signal]);
}

export const gravatarHosts = ["gravatar.com"];

export function avatarUrl(
  value: string | null | undefined,
  hosts: readonly string[],
  size: Readonly<Record<string, string>> = {},
) {
  const url = URL.parse(value ?? "");
  const hostname = url?.hostname.toLowerCase();
  if (
    url?.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    !hosts.some(
      (host) => hostname === host || hostname?.endsWith(`.${host}`) === true,
    )
  )
    return undefined;
  for (const [name, pixels] of Object.entries(size))
    url.searchParams.set(name, pixels);
  return url.toString();
}

export function foundAvatar(
  url: string | undefined,
  authorization?: string,
): HostAvatar {
  if (url === undefined) return { answered: true };
  return {
    answered: true,
    source: authorization === undefined ? { url } : { url, authorization },
  };
}

export function sameEmail(
  email: string | null | undefined,
  author: AvatarAuthor,
) {
  return email?.toLowerCase() === author.email.toLowerCase();
}

export async function readRepositoryPages<A>(
  readPage: (page: number) => Promise<readonly A[]>,
  pageSize = repositoriesPerPage,
): Promise<readonly A[]> {
  const repositories: A[] = [];
  for (let page = 1; ; page += 1) {
    const read = await readPage(page);
    repositories.push(...read);
    if (read.length < pageSize || page * pageSize >= repositoriesListed)
      return repositories;
  }
}

export function decodeHostJson<Schema extends z.ZodType>(schema: Schema) {
  return (output: string): z.output<Schema> => {
    let json: unknown;
    try {
      json = JSON.parse(output);
    } catch {
      throw unavailable;
    }
    const decoded = schema.safeParse(json);
    if (!decoded.success) throw unavailable;
    return decoded.data;
  };
}

export function isPullRequestsUnavailable(
  error: unknown,
): error is PullRequestsUnavailable {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "PullRequestsUnavailable"
  );
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

export async function eachHead(
  heads: readonly string[],
  concurrency: number,
  read: (head: string) => Promise<HeadAnswer>,
): Promise<PullRequestsByHead> {
  return answeredHeads(
    await mapConcurrently(
      heads,
      concurrency,
      async (head) => [head, await read(head)] as const,
    ),
  );
}

export async function inBatches(
  heads: readonly string[],
  size: number,
  read: (batch: readonly string[]) => Promise<readonly HeadAnswer[]>,
): Promise<PullRequestsByHead> {
  const batches = Array.from(
    { length: Math.ceil(heads.length / size) },
    (_, index) => heads.slice(index * size, index * size + size),
  );
  const entries = await mapConcurrently(batches, 4, async (batch) => {
    const answers = await read(batch);
    return batch.map((head, index) => [head, answers[index]] as const);
  });
  return answeredHeads(entries.flat());
}

export async function mapConcurrently<A, B>(
  items: Iterable<A>,
  concurrency: number,
  map: (item: A) => Promise<B>,
): Promise<B[]> {
  const list = [...items];
  const results: B[] = [];
  let next = 0;
  let failed = false;
  const work = async () => {
    while (!failed && next < list.length) {
      const index = next++;
      try {
        results[index] = await map(list[index] as A);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, list.length) }, work),
  );
  return results;
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
