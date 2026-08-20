import type { EnvironmentEventPublisher } from "@rebase/server/features/environment-connection/environment-event-publisher.contract";

export function createEnvironmentEventPublisher(): EnvironmentEventPublisher {
  let sequence = 0;
  const subscribers = new Set<(sequence: number) => void>();

  return {
    currentSequence: () => sequence,
    publishChanged: () => {
      sequence += 1;
      for (const subscriber of subscribers) {
        subscriber(sequence);
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
