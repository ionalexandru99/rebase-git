import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  combineEnvironmentFeatures,
  requestScopedGit,
} from "#server/adapters/environment-transport/environment-routes.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher.ts";
import { productVersion } from "#server/app/runtime/product-version.ts";
import { acquireRuntimeMarker } from "#server/app/runtime/runtime-marker.ts";
import {
  acquireEnvironmentListener,
  type EnvironmentListener,
} from "#server/app/server/environment-listener.ts";
import {
  acquireScoped,
  type ResourceScope,
} from "#server/app/server/resource-scope.ts";
import {
  authorAvatarsFeature,
  createAvatarImages,
} from "#server/features/author-avatars/author-avatars.ts";
import { branchSettlingFeature } from "#server/features/branch-settling/branch-settling.ts";
import { settleBranchesAfterFetch } from "#server/features/branch-settling/settle-after-fetch.ts";
import {
  commandProgressFeature,
  createCommandProgress,
} from "#server/features/command-progress/command-progress.ts";
import { commitInspectionFeature } from "#server/features/commit-inspection/commit-inspection.ts";
import { acquireDiagnosticsFeature } from "#server/features/diagnostics/diagnostics.ts";
import { createDiagnosticsActivity } from "#server/features/diagnostics/diagnostics-activity.ts";
import {
  observeFeatures,
  recordGitActivity,
  reportDefect,
} from "#server/features/diagnostics/diagnostics-recording.ts";
import {
  acquireProcessMonitor,
  processMonitorPath,
} from "#server/features/diagnostics/process-monitor.ts";
import {
  createEnvironmentAuthorization,
  environmentAuthorizationFeature,
} from "#server/features/environment-authorization/environment-authorization.ts";
import { environmentFilesystemFeature } from "#server/features/environment-filesystem/environment-filesystem.ts";
import { fileBlameFeature } from "#server/features/file-blame/file-blame.ts";
import { fileHistoryFeature } from "#server/features/file-history/file-history.ts";
import { gitIdentityFeature } from "#server/features/git-identity/git-identity.ts";
import { gitSigningFeature } from "#server/features/git-signing/git-signing.ts";
import { historySearchFeature } from "#server/features/history-search/history-search.ts";
import { pullRequestsFeature } from "#server/features/pull-requests/pull-requests.ts";
import { createRepositoryCreation } from "#server/features/repository-catalog/create-repository.ts";
import {
  createRepositoryCatalog,
  repositoryCatalogFeature,
} from "#server/features/repository-catalog/repository-catalog.ts";
import { repositoryChangesFeature } from "#server/features/repository-changes/repository-changes.ts";
import { comparisonFeature } from "#server/features/repository-comparison/compare-revisions.ts";
import { repositoryConflictsFeature } from "#server/features/repository-conflicts/repository-conflicts.ts";
import { repositoryHistoryFeature } from "#server/features/repository-history/repository-history.feature.ts";
import { createGitLfs } from "#server/features/repository-lfs/git-lfs.ts";
import { repositoryLfsFeature } from "#server/features/repository-lfs/repository-lfs.ts";
import { repositoryOperationsFeature } from "#server/features/repository-operations/repository-operations.ts";
import { acquireRepositoryPullFeature } from "#server/features/repository-pull/repository-pull.feature.ts";
import { repositoryPushFeature } from "#server/features/repository-push/repository-push.ts";
import { repositoryReflogFeature } from "#server/features/repository-reflog/repository-reflog.ts";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher.ts";
import { repositoryRefsFeature } from "#server/features/repository-refs/repository-refs.feature.ts";
import { repositoryStashesFeature } from "#server/features/repository-stashes/repository-stashes.ts";
import { repositoryWorktreesFeature } from "#server/features/repository-worktrees/repository-worktrees.ts";
import { signatureVerificationFeature } from "#server/features/signature-verification/signature-verification.ts";
import {
  createGitHostClients,
  createSourceControl,
  sourceControlFeature,
} from "#server/features/source-control/source-control.ts";
import { terminalFeature } from "#server/features/terminal/terminal.ts";
import { acquireTerminalSessions } from "#server/features/terminal/terminal-sessions.ts";
import { worktreeFilesFeature } from "#server/features/worktree-files/worktree-files.ts";
import {
  acquireEnvironmentContext,
  type EnvironmentContext,
} from "#server/persistence/environment-context.ts";
import { environmentTable } from "#server/persistence/environment-state.schema.ts";
import { environmentPaths } from "#server/persistence/storage/environment-paths.ts";
import { createRepositoryAccess } from "#server/repository/repository-access.ts";
import { createRepositoryCoordination } from "#server/repository/repository-coordination.ts";

export interface EnvironmentServerOptions {
  readonly browserAssetsRoot?: string;
  readonly home: string;
  readonly host?: string;
  readonly pairingReplacesGrantsWithSameLabel?: boolean;
  readonly port?: number;
  readonly requestShutdown?: () => void;
}

export interface EnvironmentServer {
  readonly environmentId: string;
  readonly origin: string;
  readonly pairingUrl: string;
  readonly port: number;
}

export type EnvironmentDependencies = Omit<
  Awaited<ReturnType<typeof acquireEnvironment>>,
  "close"
>;

export function serveEnvironment(
  dependencies: EnvironmentDependencies,
  options: Omit<EnvironmentServerOptions, "home">,
) {
  return acquireScoped(async (scope) => {
    const environment = await readCurrentEnvironment(dependencies.context);
    const useAutomaticPort = options.port === undefined || options.port === 0;
    const controlToken = randomBytes(32).toString("base64url");
    let marker: { readonly close: () => Promise<void> } | undefined;
    scope.defer(() => marker?.close());
    const listener = scope.use(
      await acquireEnvironmentListener({
        authorization: dependencies.authorization,
        ...(options.browserAssetsRoot === undefined
          ? {}
          : { browserAssetsRoot: options.browserAssetsRoot }),
        control: {
          token: controlToken,
          ...(options.requestShutdown === undefined
            ? {}
            : { shutdown: options.requestShutdown }),
        },
        environmentId: environment.id,
        events: dependencies.events,
        features: environmentFeatures(dependencies, scope),
        ...(options.host === undefined ? {} : { host: options.host }),
        port: useAutomaticPort
          ? (environment.automaticPort ?? 0)
          : options.port,
        reportDefect: (where, error) =>
          reportDefect(dependencies.activity, { procedure: where }, error),
      }),
    );

    if (useAutomaticPort && environment.automaticPort === null) {
      await claimAutomaticPort(dependencies.context, listener.port);
    }

    marker = await acquireRuntimeMarker(
      runtimeMarker(listener, controlToken),
      dependencies.paths.runtimeMarker,
    );
    const pairing = dependencies.authorization.createPairing({
      replacesGrantsWithSameLabel:
        options.pairingReplacesGrantsWithSameLabel ?? false,
    });

    return {
      environmentId: environment.id,
      origin: listener.origin,
      pairingUrl: `${listener.origin}/pair#${pairing.material}`,
      port: listener.port,
    } satisfies EnvironmentServer;
  });
}

export function acquireEnvironment(home: string, runner: GitCommandRunner) {
  return acquireScoped(async (scope) => {
    const activity = createDiagnosticsActivity();
    const lfs = createGitLfs(
      recordGitActivity(requestScopedGit(runner), activity),
    );
    const git = lfs.git;
    const paths = environmentPaths(join(home, ".rebase"));
    const context = scope.use(await acquireEnvironmentContext(paths));
    const catalog = createRepositoryCatalog(context, git);
    const events = createEnvironmentEventPublisher();
    const watcher = createLocalRepositoryWatcher();
    const changes = scope.use(
      await acquireRepositoryChangePublisher(
        git,
        watcher,
        events,
        (repositoryId, detail) =>
          activity.reportError({
            kind: "Watcher",
            title: "Stopped watching for changes",
            where: detail,
            detail,
            repositoryId,
          }),
      ),
    );
    const monitor = scope.use(
      await acquireProcessMonitor(processMonitorPath(), (detail) =>
        activity.reportError({
          kind: "Monitor",
          title: "Process monitor stopped",
          where: detail,
          detail,
        }),
      ),
    );
    const terminals = scope.use(
      await acquireTerminalSessions((repositoryId) =>
        events.publishChanged([repositoryId], "Terminals"),
      ),
    );
    const diagnostics = scope.use(
      await acquireDiagnosticsFeature({
        activity,
        changes,
        dataFolder: paths.root,
        git,
        monitor,
      }),
    );
    return {
      access: createRepositoryAccess(catalog, git),
      activity,
      authorization: createEnvironmentAuthorization(context),
      avatarImages: createAvatarImages(),
      catalog,
      changes,
      context,
      coordination: createRepositoryCoordination(git),
      diagnostics: diagnostics.feature,
      events,
      git,
      gitHosts: createGitHostClients(),
      lfs,
      monitor,
      paths,
      progress: createCommandProgress(),
      terminals,
      watcher,
    };
  });
}

export function environmentFeatures(
  dependencies: EnvironmentDependencies,
  scope: ResourceScope,
) {
  const sourceControl = createSourceControl(
    dependencies.context,
    dependencies.git,
    dependencies.gitHosts,
    dependencies.lfs,
  );
  const features = combineEnvironmentFeatures([
    environmentAuthorizationFeature(dependencies.authorization),
    environmentFilesystemFeature(),
    repositoryCatalogFeature(
      dependencies.catalog,
      createRepositoryCreation(dependencies),
    ),
    commitInspectionFeature(dependencies),
    fileHistoryFeature(dependencies),
    historySearchFeature(dependencies),
    worktreeFilesFeature(dependencies),
    fileBlameFeature(dependencies),
    comparisonFeature(dependencies),
    repositoryChangesFeature(dependencies),
    repositoryConflictsFeature(dependencies),
    repositoryLfsFeature(dependencies),
    repositoryHistoryFeature(dependencies),
    commandProgressFeature(dependencies.progress),
    repositoryOperationsFeature(dependencies),
    scope.use(
      acquireRepositoryPullFeature({
        ...dependencies,
        afterFetch: settleBranchesAfterFetch({
          ...dependencies,
          sourceControl,
        }),
      }),
    ).feature,
    pullRequestsFeature({ ...dependencies, sourceControl }),
    authorAvatarsFeature({ ...dependencies, sourceControl }),
    repositoryPushFeature(dependencies),
    repositoryReflogFeature(dependencies),
    repositoryRefsFeature(dependencies),
    branchSettlingFeature(dependencies),
    repositoryStashesFeature(dependencies),
    repositoryWorktreesFeature(dependencies),
    gitIdentityFeature(dependencies),
    signatureVerificationFeature(dependencies),
    gitSigningFeature(dependencies),
    sourceControlFeature({ events: dependencies.events, sourceControl }),
    terminalFeature(dependencies),
    dependencies.diagnostics,
  ]);
  return observeFeatures(features, dependencies.activity);
}

function runtimeMarker(listener: EnvironmentListener, controlToken: string) {
  return {
    controlToken,
    host: listener.host,
    origin: listener.origin,
    pid: process.pid,
    port: listener.port,
    startedAt: new Date().toISOString(),
    version: productVersion(),
  };
}

function readCurrentEnvironment(context: EnvironmentContext) {
  return context.read("Could not read Environment state", async (database) => {
    const environment = await database
      .select()
      .from(environmentTable)
      .where(isCurrentEnvironment())
      .get();
    if (environment === undefined) {
      throw new Error("The Environment identity is missing.");
    }
    return environment;
  });
}

function claimAutomaticPort(context: EnvironmentContext, port: number) {
  return context.write(
    "Could not save the automatic port",
    async (database) => {
      await database
        .update(environmentTable)
        .set({ automaticPort: port })
        .where(and(isCurrentEnvironment(), hasNoAutomaticPort()));
      const selected = await database
        .select({ automaticPort: environmentTable.automaticPort })
        .from(environmentTable)
        .where(isCurrentEnvironment())
        .get();
      if (selected?.automaticPort === null || selected === undefined) {
        throw new Error("The automatic port was not saved.");
      }
      if (selected.automaticPort !== port) {
        throw new Error(
          `Another server selected automatic port ${selected.automaticPort}.`,
        );
      }
    },
  );
}

function isCurrentEnvironment() {
  return eq(environmentTable.singleton, 1);
}

function hasNoAutomaticPort() {
  return isNull(environmentTable.automaticPort);
}
