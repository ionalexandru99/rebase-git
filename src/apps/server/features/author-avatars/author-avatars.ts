import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { Effect, Semaphore } from "effect";
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
import { runRepositoryGit } from "#server/adapters/local-git/git-commands.ts";
import {
  type AvatarSource,
  foundAvatar,
  type HostAvatar,
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
  readonly download: (
    source: AvatarSource,
  ) => Effect.Effect<string | undefined, AuthorAvatarUnavailable>;
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
  const lookups = Semaphore.makeUnsafe(lookupsAtOnce);

  const hostAnswer = (directory: string, email: string) =>
    Effect.gen(function* () {
      const noreply = githubNoreplySource(email);
      if (noreply !== undefined) return foundAvatar(noreply.url);
      const found = yield* sourceControl.hostedRepository(directory);
      if (found === undefined) return unanswered;
      const commit = (yield* runRepositoryGit(git, directory, [
        "log",
        `--remotes=${found.remote}`,
        "-1",
        "--format=%H",
        "--fixed-strings",
        "--regexp-ignore-case",
        `--author=<${email}>`,
      ])).trim();
      return commit === ""
        ? unanswered
        : yield* found.repository.avatar({ commit, email });
    });

  const lookup = (directory: string, email: string) =>
    Effect.gen(function* () {
      const host = yield* hostAnswer(directory, email);
      const hosted =
        host.answered && host.source !== undefined
          ? yield* avatarImages.download(host.source)
          : undefined;
      const image =
        hosted ?? (yield* avatarImages.download(gravatarSource(email))) ?? null;
      return { image, answered: host.answered };
    });

  return {
    routes: [
      route(AuthorAvatarsApi.read, ({ repositoryId, email }) =>
        Effect.gen(function* () {
          const key = email.trim().toLowerCase();
          const cached = yield* readCached(context, key);
          if (cached !== undefined) return cached;
          const repository = yield* access.repository(repositoryId);
          const { image, answered } = yield* lookups.withPermits(1)(
            lookup(repository.path, key),
          );
          if (answered) yield* save(context, key, image);
          return image;
        }).pipe(
          Effect.catchTags({
            GitFailed: (failure) =>
              Effect.fail(repositoryRejected("GitFailed", failure.detail)),
            PullRequestsUnavailable: () => Effect.fail(unavailable),
          }),
        ),
      ),
    ],
  } satisfies EnvironmentFeature;
}

export function createAvatarImages(): AvatarImages {
  return {
    download: ({ url, authorization }) =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(url, {
            headers: {
              accept: "image/*",
              ...(authorization === undefined ? {} : { authorization }),
            },
            redirect: "manual",
            signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
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
        },
        catch: () => unavailable,
      }),
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

function readCached(context: EnvironmentContext, email: string) {
  return context
    .read("Could not read the author avatar", (database) =>
      database
        .select()
        .from(authorAvatarTable)
        .where(eq(authorAvatarTable.email, email))
        .get(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined || row.expiresAt <= Date.now()
          ? undefined
          : row.image,
      ),
      Effect.orElseSucceed(() => undefined),
    );
}

function save(
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
  return context
    .write("Could not save the author avatar", async (database) => {
      await database
        .delete(authorAvatarTable)
        .where(lt(authorAvatarTable.expiresAt, now));
      await database
        .insert(authorAvatarTable)
        .values(row)
        .onConflictDoUpdate({ target: authorAvatarTable.email, set: row });
    })
    .pipe(Effect.ignore);
}
