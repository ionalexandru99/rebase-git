import type { BranchUpstream, RepositoryRefTarget } from "@rebase/contracts";
import type { CommandDefinition } from "#web/platform/command-contributions/command-contributions.contract";

export interface RefCommandContext {
  readonly target: RepositoryRefTarget;
  readonly upstream?: BranchUpstream;
}

export type RefCommandDefinition = CommandDefinition<RefCommandContext>;
