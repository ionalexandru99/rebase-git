import type { EnvironmentEventPublisher } from "#server/domain/environment-event-publisher.contract";

export function createEnvironmentEventPublisher(): EnvironmentEventPublisher {
  let sequence = 0;
  const subscribers = new Set<
    (sequence: number, repositoryIds?: readonly string[]) => void
  >();

  return {
    currentSequence: () => sequence,
    publishChanged: (repositoryIds) => {
      sequence += 1;
      for (const subscriber of subscribers) {
        subscriber(sequence, repositoryIds);
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
