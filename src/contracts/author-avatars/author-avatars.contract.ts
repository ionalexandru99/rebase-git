import { Schema } from "effect";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

export const AvatarImage = Schema.String.check(
  Schema.isPattern(/^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/]+=*$/),
  Schema.isMaxLength(400_000),
);
export type AvatarImage = typeof AvatarImage.Type;

export const AuthorAvatarUnavailable = Schema.TaggedStruct(
  "AuthorAvatarUnavailable",
  {},
);
export type AuthorAvatarUnavailable = typeof AuthorAvatarUnavailable.Type;

export const AuthorAvatarsApi = {
  read: repositoryQuery("repositories/author-avatar", {
    request: Schema.Struct({
      repositoryId: RepositoryId,
      email: Schema.String.check(
        Schema.isMinLength(1),
        Schema.isMaxLength(320),
      ),
    }),
    success: Schema.NullOr(AvatarImage),
    failure: AuthorAvatarUnavailable,
  }),
};
