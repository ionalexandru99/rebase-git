import { Effect } from "effect";
import type { EnvironmentRpc } from "#contracts/environment-connection/environment-rpc.contract.ts";
import { TerminalsApi } from "#contracts/terminal/terminal.contract.ts";
import {
  type EnvironmentFeature,
  type EnvironmentRpcHandlersFor,
  route,
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
      route(TerminalsApi.list, (input) =>
        access
          .requireWorktree(input)
          .pipe(Effect.map(() => terminals.list(input))),
      ),
      route(TerminalsApi.open, (input) =>
        access
          .requireWorktree(input)
          .pipe(Effect.andThen(terminals.open(input))),
      ),
      route(TerminalsApi.close, (input) =>
        Effect.sync(() => {
          terminals.close(input);
          return {};
        }),
      ),
      route(TerminalsApi.write, ({ id, data }) =>
        Effect.sync(() => {
          terminals.write(id, data);
          return {};
        }),
      ),
      route(TerminalsApi.resize, ({ id, cols, rows }) =>
        Effect.sync(() => {
          terminals.resize(id, cols, rows);
          return {};
        }),
      ),
    ],
    rpc: (): Pick<
      EnvironmentRpcHandlersFor<typeof EnvironmentRpc>,
      "terminals/attach"
    > => ({
      "terminals/attach": ({ id, since }) => terminals.attach(id, since),
    }),
  };
}
