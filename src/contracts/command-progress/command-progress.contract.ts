import { z } from "zod";
import { streamRoute } from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

export const WatchCommandProgress = z.object({
  repositoryId: RepositoryId,
  route: z.string().min(1).max(128),
});
export type WatchCommandProgress = z.infer<typeof WatchCommandProgress>;

export const CommandProgressUpdate = z.object({
  percent: z.int().min(0).max(100),
  largeFiles: z.boolean(),
});
export type CommandProgressUpdate = z.infer<typeof CommandProgressUpdate>;

export const CommandProgressApi = {
  watch: streamRoute("WatchCommandProgress", {
    request: WatchCommandProgress,
    success: CommandProgressUpdate,
  }),
};
