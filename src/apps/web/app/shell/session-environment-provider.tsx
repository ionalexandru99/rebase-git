import { type ReactNode, useMemo, useRef } from "react";
import type {
  LocalEnvironmentSession,
  LocalEnvironmentSessionState,
} from "#web/app/environment/local-environment-session";
import { environmentSessionPresentation } from "#web/app/shell/environment-session-presentation";
import { unavailableRequests } from "#web/platform/environment/environment-connection";
import { EnvironmentProvider } from "#web/platform/query/environment-context";
import { useStore } from "#web/platform/store/use-store";

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
  const requests = connected ? state.requests : unavailableRequests;
  const readable = connected;
  const writable = connected;
  const status = useMemo(() => environmentSessionPresentation(state), [state]);
  const environment = useMemo(
    () => ({
      environmentId,
      requests,
      connected,
      readable,
      writable,
      status,
    }),
    [environmentId, requests, connected, readable, writable, status],
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
