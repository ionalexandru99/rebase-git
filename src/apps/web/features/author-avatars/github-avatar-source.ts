import {
  type AuthorAvatarSource,
  type AvatarAuthor,
  AvatarUnavailable,
  type GitHubRepository,
} from "#web/features/author-avatars/author-avatar-source";

const lookupTimeoutMilliseconds = 5_000;
const rateLimitPauseMilliseconds = 60_000;

export const githubAvatarSource: AuthorAvatarSource = {
  resolve: async (repository, author, signal) => {
    const response = await fetchCommit(repository, author, signal);
    if (response.status === 403 || response.status === 429)
      throw new AvatarUnavailable(retryAt(response.headers));
    if (!response.ok) return undefined;
    const body = await response.json().catch(() => {
      throw new AvatarUnavailable();
    });
    return verifiedAvatarUrl(body, author.author.email);
  },
};

function fetchCommit(
  repository: GitHubRepository,
  author: AvatarAuthor,
  signal: AbortSignal,
) {
  return fetch(
    `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(author.oid)}`,
    {
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(lookupTimeoutMilliseconds),
      ]),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/vnd.github+json" },
    },
  ).catch(() => {
    throw new AvatarUnavailable();
  });
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

function verifiedAvatarUrl(body: unknown, email: string) {
  const commit = readCommit(body);
  if (
    commit === undefined ||
    commit.email.toLowerCase() !== email.toLowerCase() ||
    commit.avatarUrl === undefined
  )
    return undefined;
  const url = parseUrl(commit.avatarUrl);
  if (
    url === undefined ||
    url.protocol !== "https:" ||
    url.hostname !== "avatars.githubusercontent.com" ||
    url.username !== "" ||
    url.password !== ""
  )
    return undefined;
  url.searchParams.set("s", "40");
  return url.toString();
}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function readCommit(body: unknown) {
  if (!isRecord(body) || !isRecord(body.commit)) return undefined;
  const commitAuthor = body.commit.author;
  if (!isRecord(commitAuthor) || typeof commitAuthor.email !== "string")
    return undefined;
  const avatarUrl = isRecord(body.author) ? body.author.avatar_url : undefined;
  return {
    email: commitAuthor.email,
    avatarUrl: typeof avatarUrl === "string" ? avatarUrl : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
