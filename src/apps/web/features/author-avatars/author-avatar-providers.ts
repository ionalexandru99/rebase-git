import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";

export type HostedRepository = NonNullable<RepositoryRefs["hostedRepository"]>;
export interface AvatarAuthor {
  readonly oid: string;
  readonly author: { readonly email: string };
}

export class AvatarUnavailable extends Error {
  readonly _tag = "AvatarUnavailable";
  readonly retryAt: number | undefined;

  constructor(retryAt?: number) {
    super("The avatar is unavailable.");
    this.retryAt = retryAt;
  }
}

export interface AuthorAvatarSource {
  readonly provider: string;
  readonly resolve: (
    author: AvatarAuthor,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
}

type Lookup = (
  author: AvatarAuthor,
  signal: AbortSignal,
) => Promise<string | undefined>;

const avatarSize = "40";
const lookupTimeoutMilliseconds = 5_000;
const rateLimitPauseMilliseconds = 60_000;

export function avatarSourceFor(
  repository: HostedRepository,
): AuthorAvatarSource {
  const hosted = hostedLookup(repository);
  return {
    provider: repository.provider,
    resolve: async (author, signal) =>
      githubNoreplyAvatar(author.author.email) ??
      (await hosted?.(author, signal)) ??
      (await gravatarAvatar(author.author.email, signal)),
  };
}

function hostedLookup(repository: HostedRepository): Lookup | undefined {
  switch (repository.provider) {
    case "azure":
      return undefined;
    case "gitlab":
      return (author, signal) => gitlabAvatar(author.author.email, signal);
    case "github":
      return (author, signal) =>
        githubAvatar(repositoryPath(repository), author, signal);
    case "bitbucket":
      return (author, signal) =>
        bitbucketAvatar(repositoryPath(repository), author, signal);
    case "codeberg":
      return (author, signal) =>
        codebergAvatar(repositoryPath(repository), author, signal);
  }
}

function repositoryPath(repository: {
  readonly owner: string;
  readonly name: string;
}) {
  return `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
}

function githubNoreplyAvatar(email: string) {
  const id = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/i.exec(email)?.[1];
  return id === undefined
    ? undefined
    : `https://avatars.githubusercontent.com/u/${id}?s=${avatarSize}`;
}

async function githubAvatar(
  path: string,
  author: AvatarAuthor,
  signal: AbortSignal,
) {
  const body = await requestJson(
    `https://api.github.com/repos/${path}/commits/${encodeURIComponent(author.oid)}`,
    signal,
  );
  if (!sameEmail(read(body, "commit", "author", "email"), author))
    return undefined;
  const url = trustedImage(
    read(body, "author", "avatar_url"),
    "avatars.githubusercontent.com",
  );
  url?.searchParams.set("s", avatarSize);
  return url?.toString();
}

async function bitbucketAvatar(
  path: string,
  author: AvatarAuthor,
  signal: AbortSignal,
) {
  const body = await requestJson(
    `https://api.bitbucket.org/2.0/repositories/${path}/commit/${encodeURIComponent(author.oid)}?fields=author.raw,author.user.links.avatar.href`,
    signal,
  );
  const raw = read(body, "author", "raw");
  if (
    typeof raw !== "string" ||
    !raw.toLowerCase().endsWith(`<${author.author.email.toLowerCase()}>`)
  )
    return undefined;
  const url = trustedImage(
    read(body, "author", "user", "links", "avatar", "href"),
    "avatar-management--avatars.us-west-2.prod.public.atl-paas.net",
  );
  return url === undefined || url.pathname.startsWith("/initials/")
    ? undefined
    : url.toString();
}

async function codebergAvatar(
  path: string,
  author: AvatarAuthor,
  signal: AbortSignal,
) {
  const body = await requestJson(
    `https://codeberg.org/api/v1/repos/${path}/git/commits/${encodeURIComponent(author.oid)}?stat=false&verification=false&files=false`,
    signal,
  );
  if (!sameEmail(read(body, "commit", "author", "email"), author))
    return undefined;
  const url = trustedImage(read(body, "author", "avatar_url"), "codeberg.org");
  url?.searchParams.set("size", avatarSize);
  return url?.toString();
}

async function gitlabAvatar(email: string, signal: AbortSignal) {
  const body = await requestJson(
    `https://gitlab.com/api/v4/avatar?email=${encodeURIComponent(email)}&size=${avatarSize}`,
    signal,
  );
  const url = trustedImage(read(body, "avatar_url"), "gitlab.com");
  url?.searchParams.set("width", avatarSize);
  return url?.toString();
}

async function gravatarAvatar(email: string, signal: AbortSignal) {
  if (globalThis.crypto?.subtle === undefined) return undefined;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const url = `https://gravatar.com/avatar/${hash}?s=${avatarSize}&d=404`;
  const response = await send(url, signal, "HEAD");
  return response.ok ? url : undefined;
}

async function requestJson(url: string, signal: AbortSignal) {
  const response = await send(url, signal, "GET");
  if (!response.ok) return undefined;
  return response.json().catch(() => {
    throw new AvatarUnavailable();
  }) as Promise<unknown>;
}

async function send(url: string, signal: AbortSignal, method: "GET" | "HEAD") {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(lookupTimeoutMilliseconds),
    ]),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  }).catch(() => {
    throw new AvatarUnavailable();
  });
  if (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0")
  )
    throw new AvatarUnavailable(retryAt(response.headers));
  if (response.status >= 500) throw new AvatarUnavailable();
  return response;
}

function retryAt(headers: Headers) {
  const reset = Number(headers.get("x-ratelimit-reset")) * 1_000;
  const retry = Number(headers.get("retry-after")) * 1_000 + Date.now();
  return Math.max(
    Date.now() + rateLimitPauseMilliseconds,
    reset || 0,
    retry || 0,
  );
}

function sameEmail(email: unknown, author: AvatarAuthor) {
  return (
    typeof email === "string" &&
    email.toLowerCase() === author.author.email.toLowerCase()
  );
}

function trustedImage(value: unknown, host: string) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === host &&
      url.username === "" &&
      url.password === ""
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function read(value: unknown, ...path: readonly string[]) {
  return path.reduce<unknown>(
    (current, key) => (isRecord(current) ? current[key] : undefined),
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
