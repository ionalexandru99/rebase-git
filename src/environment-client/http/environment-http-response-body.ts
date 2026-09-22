import { Effect } from "effect";

export function readBoundedEnvironmentResponseBody(
  response: Response,
  byteLimit: number,
) {
  return Effect.gen(function* () {
    const stream = yield* requireResponseBody(response);
    yield* rejectOversizedDeclaredResponse(response, stream, byteLimit);
    const reader = yield* acquireResponseReader(stream);
    const body = yield* readResponseChunks(reader, byteLimit);
    return decodeResponseChunks(body);
  });
}

function requireResponseBody(response: Response) {
  return response.body === null
    ? Effect.fail(new ResponseLimitExceeded())
    : Effect.succeed(response.body);
}

function rejectOversizedDeclaredResponse(
  response: Response,
  stream: ReadableStream<Uint8Array>,
  byteLimit: number,
) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > byteLimit) {
    return Effect.tryPromise(() => stream.cancel()).pipe(
      Effect.ignore,
      Effect.andThen(Effect.fail(new ResponseLimitExceeded())),
    );
  }

  return Effect.void;
}

function acquireResponseReader(stream: ReadableStream<Uint8Array>) {
  return Effect.acquireRelease(
    Effect.sync(() => stream.getReader()),
    releaseResponseReader,
  );
}

function releaseResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  return Effect.tryPromise(() => reader.cancel()).pipe(
    Effect.ignore,
    Effect.andThen(Effect.try(() => reader.releaseLock()).pipe(Effect.ignore)),
  );
}

function readResponseChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  byteLimit: number,
) {
  return Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let byteLength = 0;

    while (true) {
      const next = yield* Effect.tryPromise(() => reader.read());
      if (next.done) {
        return { byteLength, chunks };
      }

      byteLength += next.value.byteLength;
      if (byteLength > byteLimit) {
        return yield* Effect.fail(new ResponseLimitExceeded());
      }
      chunks.push(next.value);
    }
  });
}

function decodeResponseChunks(body: ResponseChunks) {
  const bytes = new Uint8Array(body.byteLength);
  let offset = 0;
  for (const chunk of body.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

interface ResponseChunks {
  readonly byteLength: number;
  readonly chunks: readonly Uint8Array[];
}

class ResponseLimitExceeded extends Error {}
