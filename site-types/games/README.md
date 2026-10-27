# Game-Automation 3.1

Current games-only generation and maintenance rules: read the [owner contract](core/owner-games-rules.md) and [63-item review checklist](core/owner-requirements.json), version2026-10-27.2. They include the owner’s accumulated component, search, action, loading, source-truth and cross-site corrections. The latest task and approved references own layout; no historical skeleton becomes every brand’s template. Every `context` includes these sources and every new `plan` expands applicable checks. Historical packages remain unchanged; these rules do not apply to Coupon or App sites.

A portable authoring contract and evidence workflow for game websites. It is independent of Coupon and Harness. Copy this whole folder to another machine; the only CLI dependency is Node 22 or newer. Browser and image-generation tools belong to the receiving agent and must be probed, not assumed.

```sh
node bin/game.mjs check
node --test tests/*.test.mjs
node bin/game.mjs context --type web-play --page detail --role author --stage make
node bin/game.mjs init --task examples/task.json --output /absolute/path/new-run
node bin/game.mjs plan --task /absolute/path/new-run/inputs/task.json
```

Read the returned files. Implement in the project named by the task. The example contains a small real-source task, not a preapproved design or completed game. For a new visual identity, research and lock an explicit visual target before expanding pages. The four delivered sites are implementations alongside this package; they are not compulsory template rotations.

```sh
node bin/game.mjs freeze --candidate /absolute/path/site-dist --run /absolute/path/new-run
node bin/game.mjs verify --run /absolute/path/new-run
# An independent reviewer fills templates/review.json using actual evidence.
node bin/game.mjs review --run /absolute/path/new-run --review /absolute/path/review.json
node bin/game.mjs pack --output /absolute/path/another-agent/Game-Automation
```

`init` freezes rules and task inputs. `freeze` copies and hashes the actual candidate. `verify` rejects modified candidate bytes. `review` checks expected item IDs, complete status/evidence, candidate binding and distinct declared roles. It validates records, not visual taste or factual honesty. Use separate browser, functional and visual observations; do not write “passed” for an unavailable tool.

The task identifies site type, audience, routes, modules, card families, breakpoints, sample IDs, states, data sources, capabilities and delivery scope. `plan` expands each representative module across required viewports and states, including breakpoint neighbors. All emitted routes also need an exhaustive route/link/media check outside representative visual coverage. Do not reduce the task after freezing to eliminate failures; start a new run and explain the change.

Web-play and store-referral are separate product types. A mobile canvas is not proof of touch play; an iframe load event is not proof the game ran. Store referral uses real product identity and platform-specific official URLs. Generated promotional art must never stand in for real gameplay screenshots.

The receiving agent may implement any stack or visual structure. The supplied project engine is optional and lives outside the rules package. Online source games are not automatically included in a portable UI export. State each dependency and test clean-directory startup, local UI, online/runtime behavior and exported bytes separately.

Package policy: public files are explicitly listed with SHA-256 in manifest.json. `pack` copies only those files, refuses symlinks and existing output directories, and verifies the new copy. No run evidence, credentials, user data or current-machine paths are distributed by this command.

When a user explicitly locks a detail layout to a source, use the reference module order/columns/responsive grouping and retain brand styling. core/quality.md and pages/detail.md define this narrow exception to the usual cross-site structural-distinction gate. Scope and factual/interaction rules continue to apply.

For a complete faithful restoration followed by an improved site, read [core/restore-and-refine.md](core/restore-and-refine.md). Restore actual page families, typography, spacing and mobile behavior; preserve authorized exclusions and truthful data. Freeze that baseline before making the refinement. The two sites own independent visual renderers; shared data or a shared build script does not justify identical details with changed colors. Judge useful structural/interaction differences on both PC and phone. Mode and baseline notes are human/reviewer contracts; the CLI does not automatically certify these visual claims.

The direct 27 October standards are in core/owner-standards-20261027.md. They remove homepage category modules and define full-width gutters, 1200px inner pages, single-column How to play, generated game assets, truthful loading progress, no PC fullscreen/detail-back controls, natural wrapping and the 24px phone font cap. Portable inspection: docs/portable-review.md and bin/inspect-games.mjs.
