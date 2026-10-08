import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

export const WatchCommandProgress = Schema.Struct({
  repositoryId: RepositoryId,
  route: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});
export type WatchCommandProgress = typeof WatchCommandProgress.Type;

export const CommandProgressUpdate = Schema.Struct({
  percent: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  largeFiles: Schema.Boolean,
});
export type CommandProgressUpdate = typeof CommandProgressUpdate.Type;

export const CommandProgressRpc = RpcGroup.make(
  Rpc.make("WatchCommandProgress", {
    payload: WatchCommandProgress,
    success: CommandProgressUpdate,
    stream: true,
  }),
);
