import { startEnvironmentServer } from "@rebase/server";
import { Deferred, Effect } from "effect";
import type {
  EnvironmentProcessCommand,
  EnvironmentProcessMessage,
} from "#desktop/platform/environment/environment-process.contract";

const acquireStopRequest = Effect.gen(function* () {
  const stop = yield* Deferred.make<void>();
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const requestStop = () => {
        Deferred.doneUnsafe(stop, Effect.void);
      };
      const receive = ({ data }: Electron.MessageEvent) => {
        if ((data as EnvironmentProcessCommand).type === "stop") requestStop();
      };
      process.parentPort.on("message", receive);
      process.once("SIGINT", requestStop);
      process.once("SIGTERM", requestStop);
      return { receive, requestStop };
    }),
    ({ receive, requestStop }) =>
      Effect.sync(() => {
        process.parentPort.off("message", receive);
        process.off("SIGINT", requestStop);
        process.off("SIGTERM", requestStop);
      }),
  );
  return stop;
});

const serveUntilStopped = Effect.scoped(
  Effect.gen(function* () {
    const stop = yield* acquireStopRequest;
    const server = yield* startEnvironmentServer({
      pairingReplacesGrantsWithSameLabel: true,
    });
    yield* Effect.sync(() => post({ type: "ready", server }));
    yield* Deferred.await(stop);
  }),
);

function post(message: EnvironmentProcessMessage) {
  process.parentPort.postMessage(message);
}

Effect.runPromise(serveUntilStopped).then(
  () => process.exit(0),
  (error: unknown) =>
    post({
      type: "failed",
      message: error instanceof Error ? error.message : String(error),
    }),
);
