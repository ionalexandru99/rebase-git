# Effect everywhere for logic, with react-query as the renderer cache

**Status:** accepted

We use Effect as the system of record for all logic, effects, and resource lifecycles across the sidecar and main process — including process-global singletons, which are modelled as Effect services behind a `Layer` (e.g. the Repo Session registry) rather than as plain module singletons. This extends the REMEDIATION_PLAN's "sequenced" Effect adoption (Phases 3 + 6) to a standing default: when in doubt, reach for Effect.

## The trade-off

For a process-global singleton with a single adapter (e.g. the sidecar's per-repo state, where tests run real git against real temp repos and never substitute a fake `SimpleGit`), a `Layer` is — by the "one adapter = hypothetical seam, two = real" rule — ceremony without a second adapter behind it. We accept that ceremony deliberately in exchange for idiomatic consistency: one composition model, one error-channel discipline, one resource-safety story across the whole non-renderer codebase. The depth of such modules comes from *consolidation*, not from injectability.

## The one exception (renderer cache)

"Everywhere" does **not** mean replacing TanStack Query with a hand-rolled Effect cache — that remains the plan's one firm caution (P6-3). In the renderer, Effects run *inside* react-query's `queryFn`/`mutationFn` via a renderer `ManagedRuntime`; react-query stays the cache and owns invalidation.

## Consequences

A future reviewer seeing a `Layer` wrapping a one-adapter process-global should read this ADR before "simplifying" it away — the consistency is the point, and was chosen over minimal abstraction.
