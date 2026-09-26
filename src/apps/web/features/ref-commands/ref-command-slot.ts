import type { RefCommandContext } from "#web/features/ref-commands/ref-command.contract";
import { createCommandSlot } from "#web/platform/command-contributions/command-slot";

export const refCommandSlot = createCommandSlot<RefCommandContext>();
