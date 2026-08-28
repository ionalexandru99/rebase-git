# Git graph interaction models

Research for [Audit mature Git graph interaction models](https://github.com/ionalexandru99/rebase-git/issues/321), collected on 2026-08-28.

This research narrows what the static concepts should test. It does not select a final interface.

## Answer

The strongest model is an explicit ref-scoped graph with three visible states:

- **All** shows the union of local branches, remote-tracking branches, and tags. No selected refs means All.
- **Automatic** resolves to a small, inspectable set around the checked-out branch, its upstream, and an inferred target branch. The resolved refs stay visible and editable. Editing or pinning them produces a Custom view.
- **Custom** accepts one or many refs and renders the union of their reachable commits. Only selected refs receive labels, even when an unselected ref points at a commit that remains reachable.

Tower already uses sidebar selection to switch between full history and the combined history of one or many chosen local branches, remote branches, and tags. GitKraken Desktop adds two useful variants: Solo can keep several explicitly chosen refs visible, and Smart Branch Visibility keeps the checked-out branch, its target, and their upstreams. Fork proves that users can fold merged side histories without abandoning full ancestry.

Rebase should test those ideas as its own coherent model. Scope selection, commit selection, and checkout must remain separate interactions. Hidden scope must never look like missing data.

## What mature clients do

| Concern | Observed pattern | What Rebase should test |
| --- | --- | --- |
| All and custom scope | Tower's History item includes local branches, remote branches, and tags. Selecting one or several refs shows only their combined history. | A named All state and a Custom state with one-to-many selection. Show the active selection near the graph, not only inside a distant sidebar. |
| Automatic scope | GitKraken Smart Branch Visibility shows the checked-out branch, its target, and their upstreams. GitLens also offers Current Branch Only with its upstream. | Automatic as a visible recipe and resolved ref set. Include a one-click path to edit, pin, or return to All. |
| Additive ref selection | GitKraken Solo starts with one ref and lets users solo more refs. Tower supports native multi-selection. | Adding a second or tenth ref should not change modes or open a separate comparison workflow. |
| Hidden refs | GitKraken marks hidden refs in its left panel and provides bulk show actions. GitLens exposes hidden refs from a Hide control above the graph. | In Custom and Automatic modes, hide labels for refs outside the resolved set. Keep a visible count and a route back to the full ref picker. If the checked-out branch is excluded, say so beside the scope control. |
| Ordering | Tower exposes Date and Topo Order. Git's `--topo-order` prevents parallel tracks from intermixing; `--date-order` respects ancestry while otherwise following commit timestamps. | Topological by default. Test the label `Date` against `Chronological`, with an explanation that ancestry still constrains row order if Rebase uses Git date order. Preserve the selected commit when switching. |
| Merge folding | Fork collapses or expands merged histories at merge tips with pointer controls, Left/Right keys, and a Collapse all command. | Fold the merged side behind a merge row as a presentation state. Show hidden commit and nested-merge counts, keep boundary connectors legible, and always offer an immediate expansion path. |
| Graph navigation | GitKraken supports previous and next row, previous and next commit on the same branch, first and last row, search, panel toggles, and a command palette. GitLens uses Shift+Up and Shift+Down for branch-wise movement and offers a minimap with ref and search markers. | Roving single-row focus, Up/Down by row, a separate same-lane action, Home/End, search-result navigation, and keyboard access to fold and context menu actions. |
| Commit selection | GitKraken opens commit details on a click and supports modifier-based multi-selection for operations with strict validity rules. | Keep the primary selection singular for navigation. If later actions need multiple commits, show the selected set and explain why an invalid range cannot run. Do not reuse ref-selection styling for commit selection. |
| Commit actions | Sublime Merge, Tower, and GitKraken place commit-specific commands in a right-click menu. Tower disables reset outside the checked-out HEAD context. GitKraken only enables squash for a consecutive straight ancestor-descendant range and excludes merges. | Reserve a command-backed context menu now. Put read-only actions first. Group state-changing actions separately, label the target branch, disable impossible actions with a reason, and confirm destructive operations. Do not implement them as part of the graph. |
| Layout | GitKraken uses resizable and toggleable left and commit panels around the graph. Sublime Merge separates Locations, Commits, Files, and Details. Tower offers small and large commit rows. | Make the graph the only mandatory pane. Scope and details must collapse independently. Keep row density and graph width user-adjustable or responsive without changing graph semantics. |

## Git semantics that should constrain the interface

### Scope is a union, not a comparison

Git defines a revision walk from multiple positive commit arguments as the union of commits reachable from any argument. That maps directly to one-to-many selected refs. All is the same operation over the allowed ref namespaces.

The UI should not call Custom a comparison. Divergence appears naturally where the selected histories separate. A future two-sided comparison can remain a different feature with different set semantics.

### The two orderings are not cosmetic sorts

Git's topological order never places a parent before its children and tries not to intermix parallel development lines. Date order also protects parent-child order but otherwise follows commit timestamps. A strict timestamp sort can split lanes and can make a child appear after its parent when clocks are skewed.

The static concepts should therefore test ordering as a graph query and layout state, not as a column sort. Switching order should anchor the selected commit rather than preserve a meaningless pixel offset.

### Folding must not use history simplification

Git documents that `--simplify-merges` needs to walk the complete history before emitting one result. That contradicts Rebase's progressive first-paint requirement on Linux-scale repositories.

Merge folding should sit on top of the full-ancestry result already loaded. A collapsed merge keeps the merge commit and its visible first-parent path, replaces its hidden side with a compact disclosure row or connector, and records enough state to expand the same subgraph. Nested folds need independent state.

The fold is unsafe when the hidden commits are still required by another selected ref or visible path. The concept should make that case concrete. Either keep the shared commits visible, split the fold at the shared boundary, or explain why the merge cannot fully collapse.

### Lane pressure needs an honest overflow treatment

Current Git supports a graph lane limit that replaces excess lanes with a truncation mark. That confirms lane explosion is a real display problem, but copying a bare truncation glyph would make a graphical client hard to trust.

One concept should test a lane budget on a 1280-pixel display. Overflow must have a disclosure or horizontal exploration mechanism, stable lane identity while scrolling, and an obvious indication that connectors are hidden. Color alone cannot identify lanes.

## Interaction details worth carrying into the concepts

### Scope control

- The header always names the mode: All, Automatic, or Custom.
- Automatic shows its resolved refs as normal removable chips or checked rows. A short explanation such as `current + upstream + target` can sit behind an info affordance.
- Custom accepts local branches, remote-tracking branches, and tags in one searchable picker. Ref type and remote name remain visible.
- Removing the final Custom ref returns to All because empty selection already has that meaning.
- Saved views name their ref set and order. They belong to the client profile, not repository config or the server.
- A locally known remote ref carries freshness information. The scope control does not fetch on its own.

### Selection and navigation

- Click, Up, and Down move one primary commit selection and keep it visible.
- A separate command follows the same graph lane. GitKraken's branch-wise Shift+Arrow model is a useful test, but the final binding should derive from Rebase's shortcut system.
- Left and Right expand and collapse a merge only when focus is on its disclosure. They should not unexpectedly move to an adjacent lane.
- Search navigation scrolls to a stable row and keeps the result marker visible. A minimap should appear only when the history exceeds the viewport.
- Loading older pages must not move the selected row, change existing lane colors, or reset open folds.

### Future context menu boundary

The first version can expose read-only commands such as copy SHA, copy subject, reveal ref, and create branch here if that command already exists. Future actions can plug into the same command registry:

1. Inspect and copy
2. Branch or tag at this commit
3. Apply elsewhere, such as cherry-pick or revert
4. Rewrite current history, such as reset, rebase, squash, or drop

The menu must evaluate repository state before it opens. For example, squash requires a contiguous linear selection, reset needs an explicit target branch and mode, and merge commits change what rebase and cherry-pick mean. A disabled item should say why. Destructive confirmation belongs to the command, not the menu component.

## Recurring failures to avoid

- **Invisible filtering.** A graph can look complete while a stale hide or solo state removes the branch the user needs. Keep mode, selected refs, hidden count, and Reset to All in the graph header.
- **Coupling viewing with checkout.** Sidebar selection in some clients changes the history view, while double-click or menus check out. Rebase should give scope controls and checkout commands different targets and styling.
- **Treating date order as a table sort.** It breaks the user's spatial model and can contradict ancestry.
- **Using Git history simplification for folding.** It delays first output and can remove merge information rather than temporarily hide it.
- **Unstable lanes during progressive loading.** Recoloring or rerouting rows already on screen makes the graph feel broken even when the data is correct.
- **A giant action menu.** Showing every Git verb for every commit makes the valid commands hard to find. Filter by selection shape and repository state, group by risk, and keep rare actions searchable through the shared command palette.
- **Desktop panels that only shrink.** Three permanently visible panes fit an ultrawide but crush the graph at 1280x720. Panels need a real overlay, drawer, or hidden state.
- **Stretching an ultrawide list.** Long commit subjects become difficult to scan and empty space grows. Let optional panes use the extra width while the message column keeps a readable cap.

## Three static concepts to test

Each concept needs fixtures for one selected branch, three selected refs with divergence, All, Automatic, a deeply nested merge, a hidden checked-out branch, stale remote-tracking data, and a selected commit with its context menu open. Render every fixture at both 1280x720 and 3440x1440.

### Concept A: ref rail

A Tower-like left rail contains All, Automatic, saved views, and the searchable ref tree. Checkbox or additive selection composes Custom directly. The graph header repeats the mode and selected-ref summary so filtering stays visible when the rail collapses.

- At 1280x720, the rail collapses to an overlay picker and commit details stay closed.
- At 3440x1440, the rail remains pinned, the graph occupies the center, and a selected-commit inspector may use the right side as an integration placeholder.
- Test whether direct manipulation beats the cost of a persistent pane in repositories with thousands of refs.

### Concept B: scope bar

The graph has a compact All, Automatic, Custom switch in its header. Custom opens a multi-select picker and then leaves selected refs as removable chips. Saved views and ordering live beside the scope control. There is no permanent ref rail.

- At 1280x720, chips collapse into `3 refs` after the first chip, with the full set one click away.
- At 3440x1440, the header can show the complete active set without stretching the commit list. A toggleable navigator or selected-commit panel uses spare width.
- Test whether this gives enough discoverability for All and Automatic while preserving the most graph area.

### Concept C: graph command deck

The canvas stays almost full width. A compact mode breadcrumb shows `Automatic · 4 refs` or `Custom · 7 refs`. Clicking it opens a command-palette-style deck for refs, saved views, order, hidden labels, and jump commands. Keyboard users can invoke the same deck directly.

- At 1280x720, the deck overlays the graph and closes without changing selection or scroll.
- At 3440x1440, the deck can dock temporarily beside the graph. A minimap appears only for histories taller than the viewport.
- Test whether expert speed and laptop density compensate for weaker always-visible controls.

## Evaluation script for the concepts

1. Start in Automatic and explain why every visible ref is present.
2. Add two arbitrary refs, then remove one, without using a comparison workflow.
3. Return to All and verify that previously hidden labels return.
4. Exclude the checked-out branch and find the warning.
5. Switch from topological to date order and keep the same commit selected.
6. Collapse a merge containing nested merges, identify the hidden count, then expand only one nested merge.
7. Move by row, move along the same lane, jump to a search result, and open the context menu without a mouse.
8. Inspect which future actions are enabled for a single commit, a linear range, and a range containing a merge.
9. Repeat at both target sizes and during a live resize. No control may cover the selected row without an escape path.

The prototype decision should favor the concept that makes scope truth obvious, preserves graph continuity during folding and loading, and wastes the least space at both sizes. Visual polish matters after those three properties survive the fixtures.

## Sources

All product sources are official documentation or first-party material.

- [Git `rev-list` description](https://git-scm.com/docs/rev-list-description), reachability and union semantics
- [Git `log` documentation](https://git-scm.com/docs/git-log), ordering, first-parent, full history, merge simplification, and graph lane limits
- [Tower: Displaying Commits](https://www.git-tower.com/help/guides/commit-history/display-commits/windows), full and combined ref history, ordering, graph, and density
- [Tower: Branches and Tags Overview](https://www.git-tower.com/help/guides/branches-and-tags/overview/windows), multi-selection, ref grouping, and pinning
- [Tower: Undoing Commits](https://www.git-tower.com/help/guides/commit-history/undo-commits/windows), state-aware context actions
- [Tower: Cherry-Picking](https://www.git-tower.com/help/guides/commit-history/cherry-picking/windows), commit selection and contextual actions
- [GitKraken Desktop: Hide and Solo](https://help.gitkraken.com/gitkraken-desktop/hiding-and-soloing/), additive solo scope and visible hidden state
- [GitKraken Desktop: Branching and Merging](https://help.gitkraken.com/gitkraken-desktop/branching-and-merging/), Smart Branch Visibility, lane pinning, and state-dependent actions
- [GitKraken Desktop: Keyboard Shortcuts](https://help.gitkraken.com/gitkraken-desktop/keyboard-shortcuts/), row, branch, search, and panel navigation
- [GitKraken Desktop: Interface](https://help.gitkraken.com/gitkraken-desktop/interface/), resizable and toggleable panel layout
- [GitLens: Commit Graph](https://help.gitkraken.com/gitlens/gl-commit-graph/), current-branch scope, ref hiding, branch-wise navigation, and minimap
- [Fork: Collapsible git graph](https://git-fork.com/blog/posts/collapsible-graph/), merge folding, keyboard disclosure, and a large-repository example
- [Sublime Merge: Getting Started](https://www.sublimemerge.com/docs/getting_started), Locations, Commits, Files, Details, and commit context menus
- [Sublime Merge: Menus](https://www.sublimemerge.com/docs/menus), commit command context and menu extensibility
- [Tig manual and configuration](https://jonas.github.io/tig/doc/tigrc.5.html), the loading cost of graph fidelity and topological ordering in long histories
