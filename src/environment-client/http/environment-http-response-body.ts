export async function readBoundedEnvironmentResponseBody(
  response: Response,
  byteLimit: number,
) {
  const stream = response.body;
  if (stream === null) throw new ResponseLimitExceeded();
  await rejectOversizedDeclaredResponse(response, stream, byteLimit);
  const reader = stream.getReader();
  try {
    return decodeResponseChunks(await readResponseChunks(reader, byteLimit));
  } finally {
    await releaseResponseReader(reader);
  }
}

async function rejectOversizedDeclaredResponse(
  response: Response,
  stream: ReadableStream<Uint8Array>,
  byteLimit: number,
) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength <= byteLimit) return;
  await stream.cancel().catch(() => undefined);
  throw new ResponseLimitExceeded();
}

async function releaseResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  await reader.cancel().catch(() => undefined);
  try {
    reader.releaseLock();
  } catch {}
}

async function readResponseChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  byteLimit: number,
): Promise<ResponseChunks> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) return { byteLength, chunks };
    byteLength += next.value.byteLength;
    if (byteLength > byteLimit) throw new ResponseLimitExceeded();
    chunks.push(next.value);
  }
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
