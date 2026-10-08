import { Effect, Queue, Stream } from "effect";
import type {
  CommandProgressRpc,
  CommandProgressUpdate,
} from "#contracts/command-progress/command-progress.contract.ts";
import type {
  EnvironmentFeature,
  EnvironmentRpcHandlersFor,
} from "#server/adapters/environment-transport/environment-routes.ts";

type ProgressListener = (update: CommandProgressUpdate) => void;

const phases: Readonly<Record<string, readonly [number, number]>> = {
  "Counting objects": [0, 5],
  "Compressing objects": [5, 15],
  "Receiving objects": [15, 90],
  "Unpacking objects": [15, 90],
  "Writing objects": [15, 95],
  "Resolving deltas": [90, 100],
  "Updating files": [0, 100],
};
const largeFilePhases = new Set([
  "Downloading LFS objects",
  "Uploading LFS objects",
]);
const phaseLine = /^(?:remote: )?([A-Z][A-Za-z ]+): +(\d+)%/;
const rebaseLine = /^Rebasing \((\d+)\/(\d+)\)/;

export type CommandProgress = ReturnType<typeof createCommandProgress>;

export function createCommandProgress() {
  const listeners = new Map<string, Set<ProgressListener>>();
  const keyOf = (repositoryId: string, route: string) =>
    `${repositoryId}\0${route}`;
  return {
    reporter: (repositoryIds: Iterable<string>, route: string) => {
      const read = readGitProgress();
      return (output: string) => {
        const update = read(output);
        if (update === undefined) return;
        for (const repositoryId of repositoryIds)
          for (const listener of listeners.get(keyOf(repositoryId, route)) ??
            [])
            listener(update);
      };
    },
    subscribe: (
      repositoryId: string,
      route: string,
      listener: ProgressListener,
    ) => {
      const key = keyOf(repositoryId, route);
      const current = listeners.get(key) ?? new Set();
      current.add(listener);
      listeners.set(key, current);
      return () => {
        current.delete(listener);
        if (current.size === 0) listeners.delete(key);
      };
    },
  };
}

export function readGitProgress() {
  let current: CommandProgressUpdate = { percent: -1, largeFiles: false };
  let rest = "";
  return (output: string): CommandProgressUpdate | undefined => {
    const lines = `${rest}${output}`.split(/[\r\n]/);
    rest = lines.pop() ?? "";
    const before = current;
    for (const next of lines.map(lineProgress)) {
      if (next === undefined) continue;
      if (
        next.largeFiles !== current.largeFiles ||
        next.percent > current.percent
      )
        current = next;
    }
    return current === before ? undefined : current;
  };
}

function lineProgress(line: string): CommandProgressUpdate | undefined {
  const rebasing = rebaseLine.exec(line);
  if (rebasing !== null)
    return {
      percent: Math.floor(
        ((Number(rebasing[1]) - 1) / Math.max(1, Number(rebasing[2]))) * 100,
      ),
      largeFiles: false,
    };
  const phase = phaseLine.exec(line);
  const name = phase?.[1];
  const percent = Number(phase?.[2]);
  if (name === undefined) return undefined;
  if (largeFilePhases.has(name)) return { percent, largeFiles: true };
  const band = phases[name];
  if (band === undefined) return undefined;
  const [from, to] = band;
  return {
    percent: Math.floor(from + ((to - from) * percent) / 100),
    largeFiles: false,
  };
}

export function commandProgressFeature(
  progress: CommandProgress,
): EnvironmentFeature {
  return {
    routes: [],
    rpc: (): Pick<
      EnvironmentRpcHandlersFor<typeof CommandProgressRpc>,
      "WatchCommandProgress"
    > => ({
      WatchCommandProgress: ({ repositoryId, route }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const queue = yield* Queue.sliding<CommandProgressUpdate>(1);
            yield* Effect.addFinalizer(() => Queue.shutdown(queue));
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                progress.subscribe(repositoryId, route, (update) =>
                  Queue.offerUnsafe(queue, update),
                ),
              ),
              (release) => Effect.sync(release),
            );
            return Stream.fromQueue(queue);
          }),
        ),
    }),
  };
}
