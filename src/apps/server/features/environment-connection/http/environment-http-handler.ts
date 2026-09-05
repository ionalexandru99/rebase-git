import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EnvironmentAuthorizationFailure,
  EnvironmentDirectoryRejected,
  EnvironmentDiscovery,
  EnvironmentHttpApi,
  EnvironmentHttpFailure,
  EnvironmentSnapshot,
  RepositoryCatalogOperationFailure,
  RepositoryRefsOperationFailure,
} from "@rebase/contracts";
import { Effect } from "effect";
import type {
  EnvironmentFilesystem,
  EnvironmentFilesystemError,
} from "#server/domain/environment-filesystem.contract";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type {
  RepositoryCatalog,
  RepositoryCatalogError,
} from "#server/domain/repository-catalog.contract";
import type {
  RepositoryRefsError,
  RepositoryRefsService,
} from "#server/domain/repository-refs.contract";
import { respondWithBrowserAsset } from "#server/features/browser-client/browser-assets";
import type {
  EnvironmentAuthorization,
  EnvironmentAuthorizationError,
} from "#server/features/environment-authorization/environment-authorization.contract";
import { respondToEnvironmentAuthorizationRequest } from "#server/features/environment-authorization/http/environment-authorization-http-handler";
import type {
  EnvironmentTransportState,
  RunEnvironmentEffect,
} from "#server/features/environment-connection/environment-connection.contract";
import {
  authorizationFailureStatus,
  readBearerCredential,
  validateRequestHost,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import { readEnvironmentHttpRequestBody } from "#server/features/environment-connection/http/environment-http-request-body";
import { EnvironmentHttpBodyError } from "#server/features/environment-connection/http/environment-http-request-body.contract";
import {
  writeJson,
  writeJsonValue,
} from "#server/features/environment-connection/http/environment-http-response";
import { respondToEnvironmentFilesystemRequest } from "#server/features/environment-filesystem/http/environment-filesystem-http-handler";
import { respondToRepositoryCatalogRequest } from "#server/features/repository-catalog/http/repository-catalog-http-handler";
import { respondToRepositoryRefsRequest } from "#server/features/repository-refs/http/repository-refs-http-handler";

export function createEnvironmentHttpHandler(
  state: EnvironmentTransportState,
  authorization: EnvironmentAuthorization,
  catalog: EnvironmentListenerRepositoryCatalog,
  filesystem: EnvironmentListenerFilesystem,
  refs: EnvironmentListenerRepositoryRefs,
  ready: () => boolean,
  runEnvironmentEffect: RunEnvironmentEffect,
  browserAssetsRoot?: string,
) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const lifetime = startHttpRequestLifetime(request, response);
    runEnvironmentEffect(
      createEnvironmentHttpResponse(
        request,
        response,
        state,
        authorization,
        catalog,
        filesystem,
        refs,
        ready(),
        browserAssetsRoot,
      ).pipe(Effect.ensuring(Effect.sync(lifetime.release))),
      lifetime.signal,
    );
  };
}

function startHttpRequestLifetime(
  request: IncomingMessage,
  response: ServerResponse,
): HttpRequestLifetime {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  request.once("aborted", abort);
  response.once("close", abort);
  return {
    release: () => {
      request.off("aborted", abort);
      response.off("close", abort);
    },
    signal: abortController.signal,
  };
}

function createEnvironmentHttpResponse(
  request: IncomingMessage,
  response: ServerResponse,
  state: EnvironmentTransportState,
  authorization: EnvironmentAuthorization,
  catalog: EnvironmentListenerRepositoryCatalog,
  filesystem: EnvironmentListenerFilesystem,
  refs: EnvironmentListenerRepositoryRefs,
  ready: boolean,
  browserAssetsRoot?: string,
) {
  return respondToEnvironmentRequest(
    request,
    response,
    state,
    authorization,
    catalog,
    filesystem,
    refs,
    ready,
    browserAssetsRoot,
  ).pipe(
    Effect.catch((error) =>
      Effect.sync(() => writeEnvironmentHttpError(response, error)),
    ),
  );
}

function respondToEnvironmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: EnvironmentTransportState,
  authorization: EnvironmentAuthorization,
  catalog: EnvironmentListenerRepositoryCatalog,
  filesystem: EnvironmentListenerFilesystem,
  refs: EnvironmentListenerRepositoryRefs,
  ready: boolean,
  browserAssetsRoot?: string,
) {
  return Effect.gen(function* () {
    if (request.url === "/health") {
      yield* requireMethod(request, response, "GET");
      yield* requireEmptyBody(yield* readEnvironmentHttpRequestBody(request));
      writeJsonValue(response, ready ? 200 : 503, {
        status: ready ? "ready" : "starting",
      });
      return;
    }

    yield* validateRequestHost(request);
    if (
      browserAssetsRoot !== undefined &&
      (yield* respondWithBrowserAsset(request, response, browserAssetsRoot))
    ) {
      return;
    }
    const body = yield* readEnvironmentHttpRequestBody(request);

    if (request.url === EnvironmentHttpApi.discovery.path) {
      yield* requireMethod(
        request,
        response,
        EnvironmentHttpApi.discovery.method,
      );
      yield* requireEmptyBody(body);
      writeJson(
        response,
        EnvironmentHttpApi.discovery.successStatus,
        EnvironmentDiscovery,
        state.discovery,
      );
      return;
    }

    if (request.url === EnvironmentHttpApi.snapshot.path) {
      yield* requireMethod(
        request,
        response,
        EnvironmentHttpApi.snapshot.method,
      );
      yield* requireEmptyBody(body);
      yield* validateRequestOrigin(request, false);
      yield* authorization.authorize(
        readBearerCredential(request),
        "environment.read",
      );
      writeJson(
        response,
        EnvironmentHttpApi.snapshot.successStatus,
        EnvironmentSnapshot,
        {
          environmentId: state.discovery.environmentId,
          sequence: state.events.currentSequence(),
        },
      );
      return;
    }

    if (
      yield* respondToEnvironmentAuthorizationRequest(
        request,
        response,
        body,
        authorization,
      )
    ) {
      return;
    }

    if (
      filesystem !== undefined &&
      (yield* respondToEnvironmentFilesystemRequest(
        request,
        response,
        body,
        authorization,
        filesystem,
      ))
    ) {
      return;
    }

    if (
      catalog !== undefined &&
      (yield* respondToRepositoryCatalogRequest(
        request,
        response,
        body,
        authorization,
        catalog,
      ))
    ) {
      return;
    }

    if (
      refs !== undefined &&
      (yield* respondToRepositoryRefsRequest(
        request,
        response,
        body,
        authorization,
        refs,
      ))
    ) {
      return;
    }

    response.writeHead(404).end();
  });
}

function requireMethod(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
) {
  if (request.method === method) {
    return Effect.void;
  }
  return Effect.sync(() =>
    response.writeHead(405, { allow: method }).end(),
  ).pipe(Effect.andThen(Effect.interrupt));
}

function requireEmptyBody(body: Buffer) {
  return body.byteLength === 0
    ? Effect.void
    : Effect.fail(
        new EnvironmentHttpBodyError({
          failure: { _tag: "InvalidMessage" },
        }),
      );
}

function writeEnvironmentHttpError(
  response: ServerResponse,
  error:
    | EnvironmentAuthorizationError
    | EnvironmentFilesystemError
    | EnvironmentHttpBodyError
    | RepositoryCatalogError
    | RepositoryRefsError
    | EnvironmentStorageError,
) {
  if (response.writableEnded) {
    return;
  }
  if (error._tag === "EnvironmentAuthorizationError") {
    writeJson(
      response,
      authorizationFailureStatus(error.failure),
      EnvironmentAuthorizationFailure,
      error.failure,
    );
    return;
  }
  if (error._tag === "EnvironmentHttpBodyError") {
    writeJson(
      response,
      error.failure._tag === "PayloadTooLarge" ? 413 : 400,
      EnvironmentHttpFailure,
      error.failure,
    );
    return;
  }
  if (error._tag === "EnvironmentFilesystemError") {
    writeJson(
      response,
      environmentFilesystemFailureStatus(error),
      EnvironmentDirectoryRejected,
      error.failure,
    );
    return;
  }
  if (error._tag === "RepositoryCatalogError") {
    writeJson(
      response,
      repositoryCatalogFailureStatus(error),
      RepositoryCatalogOperationFailure,
      error.failure,
    );
    return;
  }
  if (error._tag === "RepositoryRefsError") {
    writeJson(
      response,
      repositoryRefsFailureStatus(error),
      RepositoryRefsOperationFailure,
      error.failure,
    );
    return;
  }
  response.writeHead(500).end();
}

function environmentFilesystemFailureStatus(error: EnvironmentFilesystemError) {
  switch (error.failure.reason) {
    case "MalformedPath":
      return 400;
    case "NotFound":
      return 404;
    case "InspectionFailed":
    case "NotDirectory":
    case "PermissionDenied":
      return 422;
  }
}

function repositoryCatalogFailureStatus(error: RepositoryCatalogError) {
  if (error.failure._tag === "RepositoryMissing") return 404;
  switch (error.failure.reason) {
    case "MalformedPath":
      return 400;
    case "NotFound":
      return 404;
    case "InspectionFailed":
    case "NotDirectory":
    case "NotRepository":
      return 422;
  }
}

function repositoryRefsFailureStatus(error: RepositoryRefsError) {
  switch (error.failure._tag) {
    case "RepositoryMissing":
    case "WorktreeMissing":
    case "RefMissing":
      return 404;
    case "BranchCheckedOutElsewhere":
    case "CheckoutRejected":
      return 409;
    case "GitFailed":
      return 422;
  }
}

interface HttpRequestLifetime {
  readonly release: () => void;
  readonly signal: AbortSignal;
}

type EnvironmentListenerRepositoryCatalog = RepositoryCatalog | undefined;
type EnvironmentListenerFilesystem = EnvironmentFilesystem | undefined;
type EnvironmentListenerRepositoryRefs = RepositoryRefsService | undefined;
