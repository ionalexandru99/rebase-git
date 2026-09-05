import { Effect, Schema } from "effect";
import {
  type AuthorAvatarSource,
  AvatarUnavailable,
} from "#web/features/author-avatars/author-avatar.contract";

const GitHubCommit = Schema.Struct({
  author: Schema.NullOr(Schema.Struct({ avatar_url: Schema.String })),
  commit: Schema.Struct({
    author: Schema.NullOr(Schema.Struct({ email: Schema.String })),
  }),
});

export const githubAvatarSource: AuthorAvatarSource["Service"] = {
  resolve: (repository, author) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(
            `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(author.oid)}`,
            {
              signal,
              credentials: "omit",
              referrerPolicy: "no-referrer",
              headers: { Accept: "application/vnd.github+json" },
            },
          ),
        catch: () => new AvatarUnavailable({}),
      });
      if (response.status === 403 || response.status === 429) {
        const reset = Number(response.headers.get("x-ratelimit-reset")) * 1_000;
        const retry =
          Number(response.headers.get("retry-after")) * 1_000 + Date.now();
        return yield* Effect.fail(
          new AvatarUnavailable({
            retryAt: Math.max(Date.now() + 60_000, reset || 0, retry || 0),
          }),
        );
      }
      if (!response.ok) return undefined;
      const body = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new AvatarUnavailable({}),
      });
      const result = yield* Schema.decodeUnknownEffect(GitHubCommit)(body).pipe(
        Effect.mapError(() => new AvatarUnavailable({})),
      );
      if (
        result.commit.author?.email.toLowerCase() !==
          author.author.email.toLowerCase() ||
        result.author === null
      )
        return undefined;
      const url = yield* Effect.try({
        try: () => new URL(result.author?.avatar_url ?? ""),
        catch: () => new AvatarUnavailable({}),
      });
      if (
        url.protocol !== "https:" ||
        url.hostname !== "avatars.githubusercontent.com" ||
        url.username !== "" ||
        url.password !== ""
      )
        return undefined;
      url.searchParams.set("s", "40");
      return url.toString();
    }).pipe(
      Effect.timeout("5 seconds"),
      Effect.mapError((error) =>
        error instanceof AvatarUnavailable ? error : new AvatarUnavailable({}),
      ),
    ),
};
