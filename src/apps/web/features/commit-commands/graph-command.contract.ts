import type { RepositoryCommit } from "@rebase/contracts";
import type { CommandDefinition } from "#web/features/menu-commands/menu-command";

export interface GraphCommandContext {
  readonly invokingOid: string;
  readonly selectedOids: readonly string[];
  readonly connected: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
}

export type GraphCommandDefinition<Id extends string = string> =
  CommandDefinition<GraphCommandContext, Id>;

export interface CommitCommandHandlers {
  readonly openDetails?: (oid: string) => void;
  readonly readCommit: (oid: string) => Promise<RepositoryCommit | undefined>;
  readonly writeClipboard: (text: string) => Promise<void>;
}
