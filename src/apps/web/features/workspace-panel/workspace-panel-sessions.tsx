export type {
  WorkspacePanelEnvironment,
  WorkspacePanelScope,
} from "#web/features/workspace-panel/workspace-panel-session.ts";

import {
  createContext,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
  PanelViewTarget,
  WorkspacePanelEnvironment,
  WorkspacePanelScope,
} from "#web/features/workspace-panel/workspace-panel-session.ts";
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
  const expand = useCallback(
    (next: boolean) =>
      session.store.dispatch({ type: "expand", expanded: next }),
    [session.store],
  );
  const view = useStore(session);
  return tabs.map((kind) => (
    <RetainedPanelView key={kind} target={view.targets[kind]}>
      <PanelFeatureScope
        scope={session.scope}
        environment={environment}
        active={
          environment?.visible !== false &&
          view.mounted &&
          open &&
          active === kind
        }
        input={inputs?.[kind]}
        expanded={expanded}
        expand={expand}
      >
        {view.contents[kind] ??
          (session.scope && workspacePanelDefinitions[kind].Content ? (
            <PanelContent kind={kind} />
          ) : (
            <PanelPlaceholder kind={kind} />
          ))}
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
  children,
}: {
  readonly scope: WorkspacePanelScope | undefined;
  readonly environment: WorkspacePanelEnvironment | undefined;
  readonly active: boolean;
  readonly input: unknown;
  readonly expanded: boolean;
  readonly expand: (expanded: boolean) => void;
  readonly children: ReactNode;
}) {
  const value = useMemo(
    () => ({ scope, environment, active, input, expanded, expand }),
    [scope, environment, active, input, expanded, expand],
  );
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
  const retained = useRef<WorkspacePanelEnvironment | undefined>(undefined);
  return useMemo(() => {
    if (scope === undefined) {
      return environment;
    }
    if (environment?.environmentId === scope.environmentId) {
      retained.current = environment;
      return environment;
    }
    return retained.current
      ? {
          ...retained.current,
          connected: false,
          writable: false,
          visible: false,
        }
      : undefined;
  }, [scope, environment]);
}

function PanelPlaceholder({ kind }: { readonly kind: WorkspacePanelKind }) {
  const definition = workspacePanelDefinitions[kind];
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
      <definition.icon
        aria-hidden="true"
        className="size-7 text-muted-foreground/60"
      />
      <h2 className="text-sm font-medium">{definition.label}</h2>
      <p className="text-xs text-muted-foreground">Coming soon</p>
    </div>
  );
}

function PanelContent({ kind }: { readonly kind: WorkspacePanelKind }) {
  const Content = workspacePanelDefinitions[kind].Content;
  return Content ? (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  ) : null;
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
  const session = useMemo(
    () => collection.acquire(key, scope, previousScopeKey),
    [collection, key, scope, previousScopeKey],
  );
  useEffect(() => collection.attach(session), [collection, session]);
  return session;
}

export function usePanelSessionOwner() {
  return useContext(SessionsContext);
}

export function PanelSessionTarget({
  session,
  kind,
  children,
}: {
  readonly session: PanelSession;
  readonly kind: WorkspacePanelKind;
  readonly children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!target) {
      return;
    }
    const attachment = createPanelViewTarget(target);
    session.update({
      targets: { ...session.getSnapshot().targets, [kind]: attachment },
      contents: { ...session.getSnapshot().contents, [kind]: children },
    });
    return () => {
      attachment.detach();
      const targets = { ...session.getSnapshot().targets };
      delete targets[kind];
      session.update({ targets });
    };
  }, [session, kind, target, children]);
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
