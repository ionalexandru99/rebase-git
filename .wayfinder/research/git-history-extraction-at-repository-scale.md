# Git history extraction at repository scale

## Decision

Use Git's revision walker against a snapshot of selected commit OIDs. Read bounded pages with `--stdin`, `--max-count`, `%P`, and either `--topo-order` or `--date-order`. Keep a cursor made from the unvisited frontier OIDs. Use NUL-framed `git log` output when a page needs row metadata.

This design is fast enough for the Linux repository only when Git can read a commit-graph. Without one, Git must discover and order most of the reachable DAG before it can return the first page. Rebase must not silently write maintenance data into a user's repository. Large-repository support therefore needs one of these explicit policies before implementation:

1. Build and maintain a disposable commit-graph in Rebase-owned storage, including equivalent storage on an SSH environment.
2. Require the repository owner to enable Git maintenance and explain why the graph cannot meet its performance target until they do.

The first policy gives Rebase control over performance and is the better product choice. A shared bare cache proved the mechanism locally, but its lifecycle, remote placement, and invalidation still need a design decision.

## Extraction contract

### Snapshot refs before walking

Read only `refs/heads`, `refs/remotes`, and `refs/tags`. Do not use `--all`: it also admits namespaces such as stashes and tool-owned refs that the product has ruled out. Resolve each selected ref to its full commit OID, peel annotated tags, remove duplicate OIDs, and sort the result. The sorted OIDs are the immutable scope snapshot.

This is the right set operation. Git defines several positive revisions as the union of commits reachable from any of them, which matches the selected-ref graph without inventing a comparison mode. See [gitrevisions](https://git-scm.com/docs/gitrevisions#_specifying_ranges).

Keep the ref-name-to-OID map separate from commit output. It lets the UI attach only the selected labels, or every supported label when the user has no explicit selection. `git for-each-ref` has machine-format atoms for full ref names, object names, object types, symbolic refs, and NUL bytes. See [git-for-each-ref](https://git-scm.com/docs/git-for-each-ref).

Ref changes after the snapshot do not alter a running view. A force update followed by object pruning can make an old cursor OID disappear. Treat that as an expired snapshot and reload instead of blending two histories.

### Commands

The topology-only form is the cheapest source for layout:

```text
git --no-optional-locks -C <repository> rev-list \
  --topo-order \
  --max-count=<page-size> \
  --parents \
  --timestamp \
  --stdin
```

Use `--date-order` in place of `--topo-order` for chronological mode. Git documents that both keep parents after their children. `--topo-order` also avoids intermixing parallel lines, while `--date-order` otherwise follows committer timestamps. `--author-date-order` is a different policy and should not hide behind the same setting. See [revision ordering](https://git-scm.com/docs/rev-list-options#_commit_ordering).

When the page also needs visible row metadata, one process can return it:

```text
git --no-optional-locks -C <repository> log \
  --topo-order \
  --max-count=<page-size> \
  --no-decorate \
  --no-color \
  --no-show-signature \
  --encoding=UTF-8 \
  -z \
  --format=%H%x00%P%x00%ct%x00%at%x00%an%x00%ae%x00%s \
  --stdin
```

The seven fields are commit OID, parent OIDs, committer time, author time, author name, author email, and subject. `-z` terminates commits with NUL and `%x00` terminates the first six fields. Git documents both the NUL commit separator and the literal-byte pretty format. See [git-log](https://git-scm.com/docs/git-log) and [pretty formats](https://git-scm.com/docs/pretty-formats).

Pass frontier OIDs to standard input, one per line. This avoids command-line length limits when many refs or merge lanes are active. Git has supported revision input through `--stdin` since well before Rebase's Git 2.34 minimum. See [git-rev-list](https://git-scm.com/docs/git-rev-list).

Do not request patches, changed paths, decorations, signature verification, or Git's ASCII `--graph`. They add work or couple extraction to presentation. Do not add a pathspec. With no exclusions and no pathspec, Git follows full ancestry from every selected tip.

### Restartable cursor

There is no native opaque continuation token. `--skip=N` replays the first `N` commits, gets slower with depth, and changes meaning if refs move. Keeping one process open avoids replay but gives poor recovery across cancellation, SSH loss, or application restart.

A frontier cursor is small and restartable:

1. Initialize `frontier` with every snapshotted selected tip OID.
2. Sort the frontier and feed it to the page command through `--stdin`.
3. For each emitted commit, remove its OID from `frontier` and add each parent OID.
4. Sort and store the resulting frontier with the order mode and scope snapshot hash.
5. Repeat until Git returns no commits.

Topological and date order both guarantee that a parent is not emitted before its children. An emitted parent therefore cannot be reintroduced by a later page. The cursor needs the frontier, not the complete set of previously emitted commits. Its size follows live graph width rather than history depth.

On Linux `master`, 5,000-commit pages traversed all 1,481,094 commits with a maximum frontier of 217 OIDs in topological mode and 507 in date mode. The synthetic 32-tip graph needed at most 62 and 32 OIDs respectively. Neither corpus produced a duplicate or a parent-before-child violation.

Git does not promise one exact ordering among commits that are equally valid under `--topo-order`. In the test, the second paged topological chunk chose a different valid branch order than one uninterrupted command. Date-order output matched the uninterrupted command in the tested prefix. Rebase must keep already loaded rows fixed and define stable continuation as no gaps, duplicates, or ancestry violations. It must not use row position as identity or promise byte-for-byte order across Git versions.

## Benchmarks

Tests ran on Git 2.55.0, Linux 7.1, an AMD Ryzen 7 9800X3D, and 60 GiB RAM. Results are warm-run medians. Maximum resident set size is the largest observed value across the runs.

The Linux corpus was a tree-less partial clone of `torvalds/linux`, `master` at `c20313e98b04ce543936431b6122dd639d3a8346`. It contained 1,481,094 commits and 111,859 merges. Tree and blob absence did not affect commit traversal. The synthetic corpus contained 250,016 commits across 32 selected branch tips, with a merge into an adjacent lane every fourth round. It had 62,496 merge commits, including merges whose parents were merge commits.

| Corpus and operation | Commit-graph | Wall time | Max RSS |
| --- | ---: | ---: | ---: |
| Linux, first 200, topology only | no | 5.50 s | 1,273 MiB |
| Linux, first 200, topology only | yes | 0.024 s | 98 MiB |
| Linux, first 200, metadata | no | 6.45 s | 2,603 MiB |
| Linux, first 200, metadata | yes | 0.020 s | 119 MiB |
| Linux, first 1,000, metadata | yes | 0.023 s | 135 MiB |
| Linux, first 5,000, metadata | yes | 0.042 s | 148 MiB |
| Linux, all commits, topology only | no | 5.86 s | 1,272 MiB |
| Linux, all commits, topology only | yes | 1.03 s | 268 MiB |
| Linux, all commits, metadata, topological | no | 8.40 s | 2,603 MiB |
| Linux, all commits, metadata, topological | yes | 6.73 s | 1,170 MiB |
| Linux, all commits, metadata, date order | no | 8.51 s | 2,603 MiB |
| Linux, all commits, metadata, date order | yes | 6.89 s | 1,163 MiB |
| Synthetic, first 200, metadata, topological | no | 0.470 s | 147 MiB |
| Synthetic, first 200, metadata, topological | yes | 0.003 s | 26 MiB |
| Synthetic, all commits, metadata, topological | no | 0.653 s | 147 MiB |
| Synthetic, all commits, metadata, topological | yes | 0.663 s | 88 MiB |

The first uncached Linux page without a commit-graph took 22.7 seconds. Warm figures are already disqualifying, so the table does not use that outlier.

Output volume also rules out eager full-history metadata:

| Linux output | Bytes |
| --- | ---: |
| 200 metadata rows | 41,234 |
| 1,000 metadata rows | 205,214 |
| 5,000 metadata rows | 1,017,143 |
| Full topology-only stream | 142,657,273 |
| Full metadata stream | 295,584,757 |

The UI should request enough rows for the viewport and a prefetch margin, not drain the process into an application array. A 1,000-row page is about 200 KiB on Linux and leaves room to absorb SSH latency. Page size can grow during deliberate deep scrolling, but the renderer and transport should retain explicit high-water marks.

The restartable cursor traversed all Linux commits in 297 topology-only pages of 5,000. Subprocess wall time totaled 6.50 seconds for topological order and 6.21 seconds for date order. Median page time was about 15 ms and the slowest page stayed below 73 ms. This test measures extraction and cursor overhead, not layout or transport latency.

### Commit-graph cost

Writing Linux's commit-graph took 7.63 seconds, peaked at 1,332 MiB RSS, and produced an 88,909,764-byte file. This is why the graph loader cannot casually run `git commit-graph write --reachable` inside the user's object database.

A bare cache created with Git's shared-object mechanism wrote the same commit-graph into cache-owned storage. The build took 8.70 seconds and 1,334 MiB RSS. Queries against that cache still returned the first 200 topology rows in 25 ms and 98 MiB RSS. The cache is disposable because it depends on the source object database.

Git supports split commit-graphs, appending reachable commits, and writing to a known alternate object directory. Its maintenance task updates split commit-graphs incrementally and is safe beside concurrent Git commands. Those mechanisms are suitable for a Rebase-owned cache after its lifecycle is specified. See [git-commit-graph](https://git-scm.com/docs/git-commit-graph) and [git-maintenance](https://git-scm.com/docs/git-maintenance).

## Local and SSH behavior

Run the same Git command where the repository lives. Do not copy the object database to the client. The NUL-framed byte stream survives an SSH channel unchanged, and a frontier cursor makes each page an independent request. That makes cancellation and reconnection much simpler than a single hour-long stream.

For local execution, terminate the page subprocess when its request is superseded. For SSH, cancel the command channel and make the remote executor confirm process exit. A page command is read-only and bounded by `--max-count`; completed pages need no cleanup. Keep stderr separate so progress, warnings, and repository errors never corrupt the record parser.

Do not fetch as a side effect. A tree-less partial clone can answer these queries because commit and parent data are present. A shallow repository cannot expose ancestors it does not have, so detect it with `git rev-parse --is-shallow-repository` and mark the shallow boundary in the result. See [git-rev-parse](https://git-scm.com/docs/git-rev-parse). Where the installed Git supports it, disable lazy promisor fetches for graph commands. The [Git environment documentation](https://git-scm.com/docs/git#Documentation/git.txt-codeGITNOLAZYFETCHcode) defines `GIT_NO_LAZY_FETCH` for that purpose.

An SSH environment has one extra hard requirement. Its commit-graph cache must live beside the remote object database, because the remote Git process needs direct access to it. A local browser cache cannot accelerate remote revision ordering. If Rebase cannot write remote cache data and the remote repository has no commit-graph, it must report degraded loading rather than consuming gigabytes without warning.

## Alternatives ruled out

`git log --all` is the wrong scope. It can include refs the user did not select and namespaces the product does not show.

`--skip=N` is not a cursor. Every page replays earlier traversal, and moving refs change the result.

One long-running `git log` stream has good throughput, but cancellation loses traversal state. It also cannot provide a durable continuation after an SSH disconnect. The frontier cursor keeps the useful part without coupling the UI to one process lifetime.

`git cat-file --batch-command` is useful for arbitrary object hydration and supports explicit buffering and flushes, as documented by [git-cat-file](https://git-scm.com/docs/git-cat-file). It does not perform revision ordering. Pairing it with `rev-list` adds protocol and parsing work without improving first-page performance. Keep it as a later option if row metadata becomes substantially larger than the graph page.

Git's default reverse-chronological walk returned 200 Linux commits in 4 ms without a commit-graph, but it does not guarantee that parents follow all children. It can draw ancestry upward when commit clocks disagree. That breaks the graph ordering contract. `--first-parent` reduced the same topological page to 326 ms but still used 700 MiB and omitted merged ancestry, so it is a collapse mode, not the full graph extractor.

Building Git's ASCII `--graph` output delegates lane choices to terminal presentation, makes responsive relayout impossible, and transfers characters the application would immediately decode into another graph model.

Eager extraction is not viable. Even with a commit-graph, full Linux metadata used 1.17 GiB RSS and emitted 282 MiB. Progressive pages are part of the data contract, not a renderer optimization.

## Acceptance checks for implementation

The extraction layer should eventually prove these properties with focused integration tests and benchmarks:

- One selected ref and many selected refs return the exact union of reachable commits.
- Annotated tags resolve to commits, duplicate tips do not duplicate rows, and unselected labels stay absent.
- Topological and date pages never emit a parent before an emitted child.
- Replaying a cursor returns the same next page for the same Git version and snapshot.
- Traversing the complete Linux and synthetic corpora has no gaps or duplicates across page boundaries.
- Cancellation stops the local or remote Git process and leaves no buffered page applied afterward.
- A ref update during browsing does not alter the current OID snapshot.
- Shallow and missing-object failures return typed boundary or expired-snapshot results.
- The performance gate records first-page latency, page latency, Git child RSS, response bytes, and cursor width with and without a commit-graph.
