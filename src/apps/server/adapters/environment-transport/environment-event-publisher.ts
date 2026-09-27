import type { RepositoryChangeKind } from "#contracts/environment-connection/environment-rpc.contract.ts";

type EnvironmentChangeSubscriber = (
  sequence: number,
  repositoryIds?: readonly string[],
  kind?: RepositoryChangeKind,
) => void;

export interface EnvironmentEventPublisher {
  readonly currentSequence: () => number;
  readonly publishChanged: (
    repositoryIds?: readonly string[],
    kind?: RepositoryChangeKind,
  ) => number;
  readonly subscribe: (subscriber: EnvironmentChangeSubscriber) => () => void;
  readonly listening: () => boolean;
}

export function createEnvironmentEventPublisher(): EnvironmentEventPublisher {
  let sequence = 0;
  const subscribers = new Set<EnvironmentChangeSubscriber>();

  return {
    currentSequence: () => sequence,
    publishChanged: (repositoryIds, kind) => {
      sequence += 1;
      for (const subscriber of subscribers) {
        subscriber(sequence, repositoryIds, kind);
      }
      return sequence;
    },
    listening: () => subscribers.size > 0,
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
}
