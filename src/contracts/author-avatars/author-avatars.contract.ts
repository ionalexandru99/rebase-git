import { z } from "zod";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

export const AvatarImage = z
  .string()
  .regex(/^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/]+=*$/)
  .max(400_000);
export type AvatarImage = z.infer<typeof AvatarImage>;

export const AuthorAvatarUnavailable = z.object({
  _tag: z.literal("AuthorAvatarUnavailable"),
});
export type AuthorAvatarUnavailable = z.infer<typeof AuthorAvatarUnavailable>;

export const AuthorAvatarsApi = {
  read: repositoryQuery("repositories/author-avatar", {
    request: z.object({
      repositoryId: RepositoryId,
      email: z.string().min(1).max(320),
    }),
    success: AvatarImage.nullable(),
    failure: AuthorAvatarUnavailable,
  }),
};
