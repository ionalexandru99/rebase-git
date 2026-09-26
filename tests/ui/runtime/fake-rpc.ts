import {
  EnvironmentRpc,
  type EnvironmentRpcClient,
  fragmentJsonMessage,
  type RepositoryRefs,
} from "@rebase/contracts";
import { Effect, Exit, Scope, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { afterEach } from "vite-plus/test";

const scopes = new Set<Scope.Closeable>();

afterEach(async () => {
  await Promise.all(
    [...scopes].map((scope) =>
      Effect.runPromise(Scope.close(scope, Exit.void)),
    ),
  );
  scopes.clear();
});

export async function fakeRpc(
  readRefs: (repositoryId: string) => Promise<RepositoryRefs>,
): Promise<EnvironmentRpcClient> {
  const scope = Effect.runSync(Scope.make());
  scopes.add(scope);
  const handlers = EnvironmentRpc.toLayer({
    Hello: () => Effect.die("Hello is not faked"),
    WatchEnvironment: () => Stream.die("WatchEnvironment is not faked"),
    ReadHistory: () => Stream.die("ReadHistory is not faked"),
    SynchronizeHistory: () => Stream.die("SynchronizeHistory is not faked"),
    CommitHistoryBatch: () => Effect.die("CommitHistoryBatch is not faked"),
    WatchFreshness: () => Stream.die("WatchFreshness is not faked"),
    FetchHistory: () => Effect.die("FetchHistory is not faked"),
    ConfigureFetch: () => Effect.die("ConfigureFetch is not faked"),
    ReadRefs: ({ repositoryId, requestId }) =>
      Stream.fromEffect(Effect.promise(() => readRefs(repositoryId))).pipe(
        Stream.flatMap((refs) =>
          Stream.fromIterable(
            fragmentJsonMessage(
              {
                logicalMessageId: 0,
                payload: new TextEncoder().encode(JSON.stringify(refs)),
                requestId,
              },
              64 * 1024,
            ),
          ),
        ),
      ),
  });
  return Effect.runPromise(
    RpcTest.makeClient(EnvironmentRpc).pipe(
      Effect.provide(handlers),
      Scope.provide(scope),
    ),
  );
}
