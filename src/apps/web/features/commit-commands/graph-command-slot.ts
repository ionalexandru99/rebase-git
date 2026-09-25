import type { GraphCommandContext } from "#web/features/commit-commands/graph-command.contract";
import { createCommandSlot } from "#web-ui/platform/command-contributions/command-slot";

export const graphCommandSlot = createCommandSlot<GraphCommandContext>();

export const GraphCommands = { Contribute: graphCommandSlot.Contribute };
