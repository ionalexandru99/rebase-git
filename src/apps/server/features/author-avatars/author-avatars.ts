import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import {
  AuthorAvatarsApi,
  type AuthorAvatarUnavailable,
} from "#contracts/author-avatars/author-avatars.contract.ts";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  type AvatarSource,
  foundAvatar,
  type HostAvatar,
  isPullRequestsUnavailable,
  withRequestSignal,
} from "#server/features/source-control/git-host.ts";
import type { SourceControl } from "#server/features/source-control/source-control.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import { authorAvatarTable } from "#server/persistence/environment-state.schema.ts";

const foundLifetime = 7 * 86_400_000;
const missingLifetime = 86_400_000;
const lookupsAtOnce = 4;
const imageBytes = 262_144;
const unavailable: AuthorAvatarUnavailable = {
  _tag: "AuthorAvatarUnavailable",
};

const unanswered: HostAvatar = { answered: false };

export interface AvatarImages {
  readonly download: (source: AvatarSource) => Promise<string | undefined>;
}

export function authorAvatarsFeature({
  access,
  avatarImages,
  context,
  git,
  sourceControl,
}: Pick<RepositoryDependencies, "access" | "git"> & {
  readonly avatarImages: AvatarImages;
  readonly context: EnvironmentContext;
  readonly sourceControl: SourceControl;
}) {
  const withLookup = createLimiter(lookupsAtOnce);

  const hostAnswer = async (
    directory: string,
    email: string,
  ): Promise<HostAvatar> => {
    const noreply = githubNoreplySource(email);
    if (noreply !== undefined) return foundAvatar(noreply.url);
    const found = await sourceControl.hostedRepository(directory);
    if (found === undefined) return unanswered;
    const commit = (
      await runRepositoryGit(git, directory, [
        "log",
        `--remotes=${found.remote}`,
        "-1",
        "--format=%H",
        "--fixed-strings",
        "--regexp-ignore-case",
        `--author=<${email}>`,
      ])
    ).trim();
    return commit === ""
      ? unanswered
      : found.repository.avatar({ commit, email });
  };

  const lookup = async (directory: string, email: string) => {
    const host = await hostAnswer(directory, email);
    const hosted =
      host.answered && host.source !== undefined
        ? await avatarImages.download(host.source)
        : undefined;
    const image =
      hosted ?? (await avatarImages.download(gravatarSource(email))) ?? null;
    return { image, answered: host.answered };
  };

  return {
    routes: [
      route(AuthorAvatarsApi.read, async ({ repositoryId, email }) => {
        try {
          const repository = await access.repository(repositoryId);
          const key = email.trim().toLowerCase();
          const cached = await readCached(context, key);
          if (cached !== undefined) return cached;
          const { image, answered } = await withLookup(() =>
            lookup(repository.path, key),
          );
          if (answered) await save(context, key, image);
          return image;
        } catch (error) {
          if (isGitFailed(error))
            throw repositoryRejected("GitFailed", error.detail);
          if (isPullRequestsUnavailable(error)) throw unavailable;
          throw error;
        }
      }),
    ],
  } satisfies EnvironmentFeature;
}

export function createAvatarImages(): AvatarImages {
  return {
    download: async ({ url, authorization }) => {
      try {
        const response = await fetch(url, {
          headers: {
            accept: "image/*",
            ...(authorization === undefined ? {} : { authorization }),
          },
          redirect: "manual",
          signal: withRequestSignal(AbortSignal.timeout(10_000)),
        });
        if (response.status === 429 || response.status >= 500)
          throw unavailable;
        const type = response.headers.get("content-type")?.split(";")[0];
        if (
          !response.ok ||
          type === undefined ||
          !/^image\/[\w.+-]+$/.test(type)
        ) {
          await response.body?.cancel();
          return undefined;
        }
        const bytes = await readImage(response);
        return bytes === undefined || bytes.length === 0
          ? undefined
          : `data:${type};base64,${bytes.toString("base64")}`;
      } catch {
        throw unavailable;
      }
    },
  };
}

function createLimiter(permits: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <Value>(run: () => Promise<Value>) => {
    if (running >= permits)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else running += 1;
    try {
      return await run();
    } finally {
      const next = waiting.shift();
      if (next === undefined) running -= 1;
      else next();
    }
  };
}

async function readImage(response: Response) {
  const reader = response.body?.getReader();
  if (reader === undefined) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.length;
    if (size > imageBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
}

function githubNoreplySource(email: string): AvatarSource | undefined {
  const id = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/.exec(email)?.[1];
  return id === undefined
    ? undefined
    : { url: `https://avatars.githubusercontent.com/u/${id}?s=40` };
}

function gravatarSource(email: string): AvatarSource {
  const hash = createHash("sha256").update(email).digest("hex");
  return { url: `https://gravatar.com/avatar/${hash}?s=40&d=404` };
}

async function readCached(context: EnvironmentContext, email: string) {
  try {
    const row = await context.read(
      "Could not read the author avatar",
      (database) =>
        database
          .select()
          .from(authorAvatarTable)
          .where(eq(authorAvatarTable.email, email))
          .get(),
    );
    return row === undefined || row.expiresAt <= Date.now()
      ? undefined
      : row.image;
  } catch {
    return undefined;
  }
}

async function save(
  context: EnvironmentContext,
  email: string,
  image: string | null,
) {
  const now = Date.now();
  const row = {
    email,
    image,
    expiresAt: now + (image === null ? missingLifetime : foundLifetime),
  };
  await context
    .write("Could not save the author avatar", async (database) => {
      await database
        .delete(authorAvatarTable)
        .where(lt(authorAvatarTable.expiresAt, now));
      await database
        .insert(authorAvatarTable)
        .values(row)
        .onConflictDoUpdate({ target: authorAvatarTable.email, set: row });
    })
    .catch(() => undefined);
}
