import { TerminalsApi } from "#contracts/terminal/terminal.contract.ts";
import {
  type EnvironmentFeature,
  route,
  stream,
} from "#server/adapters/environment-transport/environment-routes.ts";
import type { TerminalSessions } from "#server/features/terminal/terminal-sessions.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

export function terminalFeature({
  access,
  terminals,
}: {
  readonly access: RepositoryAccess;
  readonly terminals: TerminalSessions;
}): EnvironmentFeature {
  return {
    routes: [
      route(TerminalsApi.list, async (input) => {
        await access.requireWorktree(input);
        return terminals.list(input);
      }),
      route(TerminalsApi.open, async (input) => {
        await access.requireWorktree(input);
        return terminals.open(input);
      }),
      route(TerminalsApi.close, async (input) => {
        terminals.closeTerminal(input);
        return {};
      }),
      route(TerminalsApi.write, async ({ id, data }) => {
        terminals.write(id, data);
        return {};
      }),
      route(TerminalsApi.resize, async ({ id, cols, rows }) => {
        terminals.resize(id, cols, rows);
        return {};
      }),
      stream(TerminalsApi.attach, ({ id, since }, { signal }) =>
        terminals.attach(id, since, signal),
      ),
    ],
  };
}
