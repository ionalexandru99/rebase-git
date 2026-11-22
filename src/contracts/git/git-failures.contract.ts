import { z } from "zod";

const maximumDetailLength = 2_048;

export const RepositoryRejected = z.object({
  _tag: z.literal("RepositoryRejected"),
  reason: z.enum([
    "Missing",
    "Busy",
    "Incompatible",
    "GitFailed",
    "IdentityMissing",
    "LfsMissing",
    "SigningUnavailable",
    "SigningLocked",
  ]),
  detail: z.string().max(maximumDetailLength),
});
export type RepositoryRejected = z.infer<typeof RepositoryRejected>;

export function repositoryRejected(
  reason: RepositoryRejected["reason"],
  detail: string,
): RepositoryRejected {
  return {
    _tag: "RepositoryRejected",
    reason,
    detail: detail.slice(0, maximumDetailLength),
  };
}
