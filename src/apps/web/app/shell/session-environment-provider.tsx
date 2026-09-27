import { type ReactNode, useMemo, useRef } from "react";
import type {
  LocalEnvironmentSession,
  LocalEnvironmentSessionState,
} from "#web/app/environment/local-environment-session.contract";
import { environmentSessionPresentation } from "#web/app/shell/environment-session-presentation";
import {
  type Environment,
  EnvironmentProvider,
} from "#web/platform/query/environment-context";
import { useStore } from "#web/platform/store/use-store";

const noCapabilities: Environment["capabilities"] = [];

export function SessionEnvironmentProvider({
  session,
  children,
}: {
  readonly session: LocalEnvironmentSession;
  readonly children: ReactNode;
}) {
  const state = useStore(session);
  const environmentId = useRetainedEnvironmentId(state);
  const connected = state._tag === "Connected";
  const rpc = connected ? state.rpc : undefined;
  const capabilities = connected ? state.capabilities : noCapabilities;
  const readable = connected;
  const writable = connected;
  const status = useMemo(() => environmentSessionPresentation(state), [state]);
  const { requests, changes } = session;
  const environment = useMemo(
    () => ({
      environmentId,
      requests,
      rpc,
      capabilities,
      changes,
      connected,
      readable,
      writable,
      status,
    }),
    [
      environmentId,
      requests,
      rpc,
      capabilities,
      changes,
      connected,
      readable,
      writable,
      status,
    ],
  );
  return (
    <EnvironmentProvider environment={environment}>
      {children}
    </EnvironmentProvider>
  );
}

function useRetainedEnvironmentId(state: LocalEnvironmentSessionState) {
  const lastConnected = useRef<string | undefined>(undefined);
  if (state._tag === "Connected") lastConnected.current = state.environmentId;
  return state._tag === "Reconnecting"
    ? (state.environmentId ?? lastConnected.current)
    : lastConnected.current;
}
