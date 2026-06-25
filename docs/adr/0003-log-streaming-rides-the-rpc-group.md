# Log streaming rides the typed RPC group as a streaming operation

**Status:** accepted

The commit log is served by a streaming RPC, `streamLog`, on the same `@effect/rpc` group (`SidecarRpcs`) as every other Git operation. Each delivered `LogChunk` is one NDJSON frame on the existing `/rpc` transport; the stream's completion replaces the old terminal round-trip, and stream interruption cancels the underlying `git log`. The dedicated `/stream/log` route — and its duplicated bearer-token auth, body reading, and request parsing — is **deleted**. NDJSON stays the wire format; this decision is about which seam carries the stream, not how it is encoded.

## The spike (why this is a go)

Folding the stream into the group was gated behind a spike, because it depended on whether the `@effect/rpc` HTTP streaming API would cooperate end-to-end. Three things were proven over the real `createSidecarServer` `/rpc` route before any commitment (`src/sidecar/__tests__/rpc-stream-log.test.ts`):

1. **In-order delivery** — a chunked log arrives in topo order and terminates with a `done` chunk.
2. **Mid-stream cancellation by generation id** — against a 4000-commit history, interrupting a superseded stream stops it *before* its terminal chunk while a concurrent stream (a different `streamId`) runs to completion. This is the load-bearing proof: it only holds if the HTTP protocol streams **incrementally** rather than buffering the whole response, so interruption tears down the sidecar's `git log` rather than arriving too late.
3. **Typed errors** — an invalid repo path flows as a typed `GitError` in the stream channel, not a thrown string.

Both `RpcServer.toWebHandler` (server side, piped to the response in `server.ts`) and `RpcClient.layerProtocolHttp` (consumer side) handle the streaming success channel without fighting the transport, so the dedicated endpoint earned no keep.

## How cancellation works now

The renderer's generation id (`streamId`) still stamps every chunk so the consumer drops stale chunks from a superseded stream. Underneath, a restart **interrupts** the consuming Effect fiber (`runStreamLog`, driven by the IPC layer's `AbortSignal`); interruption closes the HTTP request, which closes the sidecar-side stream scope, which kills the `git log` child via its `acquireRelease` finalizer. Cancellation is correct by construction — there is no in-flight-chunk corruption to guard against.

## Consequences

- **Backpressure residual.** The dedicated endpoint paused `git log`'s stdout when the HTTP socket applied backpressure (`writeChunkWithBackpressure`). The RPC path drops that explicit pause: `commitStream`'s producer queue is unbounded (it must never drop commits), and the sole consumer is the main process draining the loopback socket, which keeps up with `git log` in practice — so the queue stays shallow. A pathological main-process stall would buffer more in the sidecar than the old pause allowed. This is a deliberate, documented residual; true producer backpressure belongs with REMEDIATION_PLAN P6-2 (model the producer as a pull-based Effect `Stream`), not this fold-in.
- **Pagination validation moved into the contract.** `skip`/`maxCount` bounds (non-negative int / positive int) that the deleted route validated inline now live in the `StreamLog` RPC payload schema — the single parsing point.
- A future reviewer tempted to reinstate a separate streaming endpoint "for backpressure" should read this ADR first: the seam was unified on purpose, and the residual is understood.
