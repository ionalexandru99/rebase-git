import { Layer } from "effect";
import {
  type EnvironmentChangeSubscriber,
  type EnvironmentEventPublisher,
  EnvironmentEvents,
} from "#server/domain/environment-event-publisher.contract";

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

export const environmentEventPublisherLayer = Layer.sync(
  EnvironmentEvents,
  createEnvironmentEventPublisher,
);
