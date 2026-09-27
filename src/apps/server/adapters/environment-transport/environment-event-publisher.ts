import type { RepositoryChangeKind } from "@rebase/contracts";

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
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
}
