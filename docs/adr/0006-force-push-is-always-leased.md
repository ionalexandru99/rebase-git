# Force-push is always leased — the app never runs a bare `--force`

**Status:** accepted

The app fetches in the background (a 5-minute timer in `refs.tsx` plus the `.git` watcher in `repoWatcher.ts`), which silently advances remote-tracking refs — exactly the condition under which a bare `git push --force-with-lease` stops protecting anything and clobbers unseen work (verified: after a background fetch, bare lease reports `(forced update)` and overwrites a teammate's commit). So every force path the UI can reach is a *guarded* push, in two tiers. Tier 1 **Force push (with lease)** runs `git push --force-with-lease --force-if-includes`; `--force-if-includes` is what defends against the background-fetch footgun — it refuses unless the current remote tip is reachable from the local branch's reflog, i.e. the user actually had it under their hand, not merely fetched it. Tier 2 **Overwrite remote anyway**, reachable only after Tier 1 is refused, first fetches so it can show the user exactly which remote commits would be lost, then runs `git push --force-with-lease=<branch>:<sha>` *pinned to the tip it just showed* — so a deliberate overwrite can only destroy commits the user was shown, and a push that lands after the preview is refused rather than clobbered. The app never issues an unguarded `--force`.

## Considered options

- **Two-tier leased push (chosen).** Safe by default via lease + if-includes; full power on demand via a pinned lease. No unguarded `--force` anywhere; the destructive tier announces itself and previews the loss.
- **Bare `--force-with-lease`.** One git invocation, simplest. But this app's background auto-fetch defeats the lease — empirically it reports `(forced update)` and overwrites a just-fetched commit the user never saw.
- **Explicit expected-SHA lease everywhere** (`--force-with-lease=ref:sha` threaded from the renderer's last-shown tip). Works, but needs a SHA plumbed through the contract for the *common* case and still races between render and click; `--force-if-includes` buys the same protection for Tier 1 with no plumbing. The pinned form is therefore reserved for Tier 2, where we have just fetched and shown a specific tip.
- **Plain `--force` behind a confirmation.** Removes all protection; defeats the issue's intent (`--force-with-lease`).

## Consequences

- The push rejection carries a `reason` discriminator — `non-fast-forward | lease-stale | remote-moved` — mapping git's stderr to the next UI step. Matchers (verified on git 2.50): `(fetch first)` → `non-fast-forward` (a plain push on a Diverged branch → offer Tier 1); `(stale info)` → `lease-stale` and `(remote ref updated since checkout)` → `remote-moved` (a Tier 1 push refused → fetch, then offer Tier 2).
- `--force-if-includes` requires git ≥ 2.30 (Dec 2020).
- Even the Tier 2 overwrite can be refused (a new push lands after the preview); the UI must re-fetch and re-show the lost-commit list rather than treat refusal as a hard error.
- Force actions stay available even when the branch has no upstream — there they add `--set-upstream origin HEAD:<branch>` alongside the lease flags, which still *refuses* if a same-named remote branch was created concurrently (`remote ref updated since checkout`). This is strictly safer than today's plain `--set-upstream` push.
