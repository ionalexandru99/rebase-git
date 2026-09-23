import { Context } from "effect";

export interface EnvironmentEventPublisher {
  readonly currentSequence: () => number;
  readonly publishChanged: (repositoryIds?: readonly string[]) => number;
  readonly subscribe: (
    subscriber: (sequence: number, repositoryIds?: readonly string[]) => void,
  ) => () => void;
}

export class EnvironmentEvents extends Context.Service<
  EnvironmentEvents,
  EnvironmentEventPublisher
>()("EnvironmentEvents") {}
