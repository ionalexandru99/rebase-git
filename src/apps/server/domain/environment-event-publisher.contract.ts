import type { RepositoryChangeKind } from "@rebase/contracts";
import { Context } from "effect";

export type EnvironmentChangeSubscriber = (
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

export class EnvironmentEvents extends Context.Service<
  EnvironmentEvents,
  EnvironmentEventPublisher
>()("EnvironmentEvents") {}
