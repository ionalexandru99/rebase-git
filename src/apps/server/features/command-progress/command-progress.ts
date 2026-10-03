import { Effect, Queue, Stream } from "effect";
import type {
  CommandProgressRpc,
  CommandProgressUpdate,
} from "#contracts/command-progress/command-progress.contract.ts";
import type {
  EnvironmentFeature,
  EnvironmentRpcHandlersFor,
} from "#server/adapters/environment-transport/environment-routes.ts";

type ProgressListener = (percent: number) => void;

const phases: Readonly<Record<string, readonly [number, number]>> = {
  "Counting objects": [0, 5],
  "Compressing objects": [5, 15],
  "Receiving objects": [15, 90],
  "Unpacking objects": [15, 90],
  "Writing objects": [15, 95],
  "Resolving deltas": [90, 100],
  "Updating files": [0, 100],
};
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
        const percent = read(output);
        if (percent === undefined) return;
        for (const repositoryId of repositoryIds)
          for (const listener of listeners.get(keyOf(repositoryId, route)) ??
            [])
            listener(percent);
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
  let percent = -1;
  let rest = "";
  return (output: string): number | undefined => {
    const lines = `${rest}${output}`.split(/[\r\n]/);
    rest = lines.pop() ?? "";
    const next = Math.max(percent, ...lines.map(linePercent));
    if (next <= percent) return undefined;
    percent = next;
    return percent;
  };
}

function linePercent(line: string) {
  const rebasing = rebaseLine.exec(line);
  if (rebasing !== null)
    return Math.floor(
      ((Number(rebasing[1]) - 1) / Math.max(1, Number(rebasing[2]))) * 100,
    );
  const phase = phaseLine.exec(line);
  const band = phase?.[1] === undefined ? undefined : phases[phase[1]];
  if (band === undefined) return -1;
  const [from, to] = band;
  return Math.floor(from + ((to - from) * Number(phase?.[2])) / 100);
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
                progress.subscribe(repositoryId, route, (percent) =>
                  Queue.offerUnsafe(queue, { percent }),
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
