export type {
  WorkspacePanelEnvironment,
  WorkspacePanelScope,
} from "#web/features/workspace-panel/workspace-panel-session.ts";

import {
  createContext,
  type ReactNode,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { PanelFeatureContext } from "#web/features/workspace-panel/api.ts";
import { RetainedPanelView } from "#web/features/workspace-panel/components/retained-panel-view.tsx";
import {
  createSessionCollection,
  type PanelSession,
} from "#web/features/workspace-panel/panel-view-sessions.ts";
import {
  type WorkspacePanelKind,
  workspacePanelDefinitions,
} from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import type {
  WorkspacePanelAction,
  WorkspacePanelTab,
} from "#web/features/workspace-panel/workspace-panel-model.ts";
import type {
  PanelViewTarget,
  WorkspacePanelEnvironment,
  WorkspacePanelScope,
} from "#web/features/workspace-panel/workspace-panel-session.ts";
import { tabKind } from "#web/features/workspace-panel/workspace-panel-state.ts";
import { useStore } from "#web/platform/store/use-store.ts";

const SessionsContext = createContext<
  ReturnType<typeof createSessionCollection> | undefined
>(undefined);

export function WorkspacePanelSessions({
  children,
  environment,
  repositoryIds,
}: {
  readonly children: ReactNode;
  readonly environment?: WorkspacePanelEnvironment | undefined;
  readonly repositoryIds?: readonly string[] | undefined;
}) {
  const [collection] = useState(createSessionCollection);
  useEffect(() => {
    if (repositoryIds) {
      collection.retain(repositoryIds);
    }
  }, [collection, repositoryIds]);
  return (
    <SessionsContext.Provider value={collection}>
      {children}
      <SessionViews collection={collection} environment={environment} />
    </SessionsContext.Provider>
  );
}

function SessionViews({
  collection,
  environment,
}: {
  readonly collection: ReturnType<typeof createSessionCollection>;
  readonly environment: WorkspacePanelEnvironment | undefined;
}) {
  const sessions = useStore(collection);
  return sessions.map((session) => (
    <ProjectViews
      key={session.key}
      session={session}
      environment={environment}
    />
  ));
}

function ProjectViews({
  session,
  environment: currentEnvironment,
}: {
  readonly session: PanelSession;
  readonly environment: WorkspacePanelEnvironment | undefined;
}) {
  const environment = useProjectEnvironment(session.scope, currentEnvironment);
  const tabs = useStore(session.store, (panel) => panel.tabs);
  const open = useStore(session.store, (panel) => panel.open);
  const active = useStore(session.store, (panel) => panel.active);
  const inputs = useStore(session.store, (panel) => panel.inputs);
  const expanded = useStore(session.store, (panel) => panel.expanded === true);
  const expand = (next: boolean) =>
    session.store.dispatch({ type: "expand", expanded: next });
  const view = useStore(session);
  return tabs.map((tab) => (
    <RetainedPanelView key={tab} target={view.targets[tab]}>
      <PanelFeatureScope
        scope={session.scope}
        environment={environment}
        active={
          environment?.visible !== false &&
          view.mounted &&
          open &&
          active === tab
        }
        input={inputs?.[tab]}
        expanded={expanded}
        expand={expand}
        dispatch={session.store.dispatch}
      >
        {view.contents[tab] ??
          (session.scope ? <PanelContent kind={tabKind(tab)} /> : null)}
      </PanelFeatureScope>
    </RetainedPanelView>
  ));
}

function PanelFeatureScope({
  scope,
  environment,
  active,
  input,
  expanded,
  expand,
  dispatch,
  children,
}: {
  readonly scope: WorkspacePanelScope | undefined;
  readonly environment: WorkspacePanelEnvironment | undefined;
  readonly active: boolean;
  readonly input: unknown;
  readonly expanded: boolean;
  readonly expand: (expanded: boolean) => void;
  readonly dispatch: (action: WorkspacePanelAction) => void;
  readonly children: ReactNode;
}) {
  const value = {
    scope,
    environment,
    active,
    input,
    expanded,
    expand,
    dispatch,
  };
  return (
    <PanelFeatureContext.Provider value={value}>
      {children}
    </PanelFeatureContext.Provider>
  );
}

function useProjectEnvironment(
  scope: WorkspacePanelScope | undefined,
  environment: WorkspacePanelEnvironment | undefined,
) {
  const current =
    scope !== undefined && environment?.environmentId === scope.environmentId;
  const [retained, setRetained] = useState(current ? environment : undefined);
  if (current && environment !== retained) setRetained(environment);
  if (scope === undefined || current) return environment;
  return retained
    ? { ...retained, connected: false, writable: false, visible: false }
    : undefined;
}

function PanelContent({ kind }: { readonly kind: WorkspacePanelKind }) {
  const Content = workspacePanelDefinitions[kind].Content;
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}

export function usePanelSession(
  key: string,
  scope: WorkspacePanelScope | undefined,
  previousScopeKey: string,
) {
  const collection = useContext(SessionsContext);
  if (!collection) {
    throw new Error("Workspace panel sessions require an owner.");
  }
  const session = collection.acquire(key, scope, previousScopeKey);
  useEffect(() => collection.attach(session), [collection, session]);
  return session;
}

export function usePanelSessionOwner() {
  return useContext(SessionsContext);
}

export function PanelSessionTarget({
  session,
  tab,
  children,
}: {
  readonly session: PanelSession;
  readonly tab: WorkspacePanelTab;
  readonly children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    session.update({
      contents: { ...session.getSnapshot().contents, [tab]: children },
    });
  }, [session, tab, children]);
  useLayoutEffect(() => {
    if (!target) {
      return;
    }
    const attachment = createPanelViewTarget(target);
    session.update({
      targets: { ...session.getSnapshot().targets, [tab]: attachment },
    });
    return () => {
      attachment.detach();
      const targets = { ...session.getSnapshot().targets };
      delete targets[tab];
      session.update({ targets });
    };
  }, [session, tab, target]);
  return <div ref={setTarget} className="h-full min-h-0" />;
}

function createPanelViewTarget(element: HTMLElement): PanelViewTarget {
  const listeners = new Set<() => void>();
  return {
    element,
    beforeDetach: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    detach: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
