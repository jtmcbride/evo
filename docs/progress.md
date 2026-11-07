**M0 complete**

Pinned Node/npm dependencies, Vite/React scaffold, strict TypeScript, ESLint, core dependency checks, Vitest, canonical SHA-256 identifiers, and versioned xoshiro128** streams are implemented. Reference-vector/state restore and canonicalization tests pass. Typecheck, lint, and production build pass. CLI scripts use `node --import tsx` to avoid an unnecessary IPC listener in restricted environments.

**M1 complete**

Implemented seeded open/obstacle scenarios, 20 local observations, exact rounded-corner swept-body collisions with sliding, path-based food pickup, effort energy costs, and fixed-tick scripted trials. Eight tests pass, including chunk equivalence, analytic movement/energy, tunneling, occlusion, stationary pickup, and independent state. Typecheck, lint, and production build pass. The obstacle seed-42 scripted demonstration collected 26 food in 1,800 ticks; this is a functional fixture, not an evolutionary benchmark.

**M2 complete**

Added Float32 20–12–2 neural parameters, reusable Float64 inference buffers, frozen-neural and seeded random-action baselines, exact decision traces, and portable episode checkpoints. The codec preserves parameter bytes and signed zero. Eleven tests pass, including independent neural reference calculations, trace equivalence, and random/neural restoration at tick 17 between decisions. Typecheck, lint, and production build pass.

**M3 complete**

Implemented common training trials, fixed validation trials, seeded tournaments, mutation with exact parameter patches, unchanged elite identity reuse, and a tick-budgeted experiment state machine with an acknowledgment barrier. Added an in-memory commit store, a guarded filesystem adapter, resumable evolution CLI, and exploratory pilot runner. Twenty-one tests pass, including shuffled evaluation order, generation restore, patch reconstruction, filesystem recovery/conflicts, and an actual CLI split run matching an uninterrupted run byte-for-byte. Typecheck, lint, and production build pass.

The default-size open-arena pilot completed five independent runs of fifty generations each. All five improved on fixed validation scenarios; mean champion food collection increased from 6.4875 to 21.7000. The scripted baseline remained stronger in four runs. See [the complete pilot report](benchmarks/m3-open-pilot.md) and its raw results. Held-out generalization remains unmeasured. M4 browser smoke measurements are recorded below.

**M4 complete**

Added a validated, versioned worker protocol; scoped session/experiment commands; an 8 ms cooperative runtime; independent playback with exact stepping and bounded seek checkpoints; explicit generation-save acknowledgments; latest-value snapshots with one outstanding frame; and a worker-owning client with timeout/error/disposal cleanup. A read-only core progress accessor supplies compact status without copying the population. Thirty engine/runtime/client tests, typecheck, lint, and the production build pass. Five Chromium acceptance tests pass against the production build under `/evo/`, including identical generation commits during inspection, a full 384-trial default generation, failed-save recovery, and a real worker crash. Five pause samples measured 0.6–5.6 ms with the default population and active playback; a default generation completed in approximately 3.9 seconds including polling overhead. These are focused-tab smoke observations, not a browser performance benchmark. See [the worker contract and acceptance evidence](worker-runtime.md).

**M5 complete**

Added the full session workbench: seeded configuration and previews; independent Canvas playback with sensor-only mode, stepping and seeking; a 34-neuron inspector with all 264 connections, signed weights, biases, actual sensor values and motor commands; separate current-body measurements; training/validation charts; and replay of historical champions under original trial conditions. UI snapshots are cached, arena frames bypass React, inspector activity is throttled, and the selected replay remains pinned when older history is evicted. Idle terminal/replacement status is now published immediately so controls stay correct.

Thirty-five engine/runtime/store tests and twelve production Chromium tests pass, along with typecheck, lint and build. Automated WCAG A/AA checks pass across all inspector views in desktop and mobile layouts. Keyboard controls, reduced motion, mobile overflow, original evaluation identity, exact inspector data, and rewinding terminal episodes are covered. See [the workbench guide and verification](workbench.md). Saves remain in session memory; IndexedDB and file archives are M6.

**M6 complete**

Added atomic IndexedDB generation saves, normalized numerical records, revision guards, idempotent retry, active-experiment recovery, saved-experiment selection, and explicit interruption notices. The worker acknowledges a generation only after its checkpoint is saved; failed saves preserve an exportable pending population. `.evolab` ZIP checkpoints use manifests/checksums, little-endian parameters, bounded streaming validation, and a separate archive worker. Imports create separate local saves and preserve existing experiments on validation/write failure. Runtime provenance and partial-ancestry limits are explicit. Final and paused playback frames now flush immediately inside the normal publication interval.

Forty-five engine/runtime/store/database/archive tests and nineteen production Chromium browser tests pass, with typecheck, lint, build, and existing desktop/mobile accessibility acceptance. Reload and fresh-context import preserve deterministic continuation. Browser tests cover failed-write rollback, retry, stale tabs, and export while storage is unavailable. See [durable saves and archive recovery](persistence.md). Full ancestry archives, sparse parameter retention, and broader browser/device acceptance remain later milestones.

**M7 complete**

Added matched sensor-mask comparisons from exact episode checkpoints. Non-decision requests preserve held commands until the next decision, then mask one effective input without changing raw observations, controller weights, playback, or training. Paired trajectories, outcomes, action differences, and raw/effective first-decision inputs/outputs are visible in the workbench. Saved sources can reproduce both arms after reload or portable import, with exact rerun checks that preserve original records on mismatch.

Comparison records save independently of numerical checkpoint revisions and survive concurrent training saves. Database schema 2 preserves existing M6 heads/checksums; archive version 2 includes comparison-only parameters and accepts M6 version-1 imports. Save failures retain exportable results with a separate retry, and retention is explicitly bounded at 32 pairs per experiment.

Fifty-four engine/runtime/store/database/archive tests and twenty-three production Chromium browser tests pass, along with typecheck, lint, build, and automated desktop/mobile WCAG A/AA acceptance. See [sensor intervention semantics and acceptance](interventions.md). M8 retained ancestry is next; hidden-neuron clamps, branches, full-history archives, broader browser/device acceptance, and static deployment remain later work.

**M8 complete**

Added immutable birth retention, sparse mutation patches, periodic/depth-bounded reconstruction anchors, and exact ancestral parameter reconstruction. All saved births survive removal from the current population. Generation saves now commit lineage, original trials, and the next population together; failed writes roll back births and successful retries remain idempotent. Legacy M6/M7 records backfill without rewriting numerical checkpoints.

The lineage explorer shows bounded ancestor/child pages, controller lookup, exact mutation values, and replay of original retained trials. Parent and child can be evaluated on an explicit common map suite with paired trajectories and outcomes, independently of training. Version-3 full-lineage archives preserve retained births, generation membership, scenarios, trial results, and reconstruction data; older checkpoint imports remain compatible and honestly partial.

Sixty-five engine/runtime/store/database/archive tests and twenty-six production Chromium browser tests pass, with typecheck, lint, build, and automated desktop/mobile accessibility acceptance. Full archive import in a fresh browser reproduces ancestor replay, shared-suite outcomes/paths, and subsequent evolution. See [lineage semantics and acceptance](lineage.md). M9 branches and extended interventions are next; static publication and release benchmarks remain M10.

**M9 complete**

Added branches from saved ready-to-evaluate populations, immutable source provenance/configuration diffs, paired seed schedules, preserved generation/membership, and branch-specific new birth identities. Forks publish atomically under source-revision protection and retain inherited lineage with each generation's actual definition. Nested branch provenance and partial-ancestry limits survive portable restore.

Added post-tanh hidden-neuron clamps and actual reconstructed parent-weight restoration to matched replay, with raw/effective activity, exact decision timing, immutable genomes, and saved comparison replay. Training-selected source/branch champions now evaluate across both original and modified environment suites in a complete common-suite matrix. Matrix records persist independently, survive failed saves and generation commits, and replay after fresh-context import.

Seventy-seven engine/runtime/store/database/archive tests and thirty production Chromium tests pass, with typecheck, lint, build, and desktop/mobile accessibility acceptance. See [controlled branches, matrices, and interventions](branches.md). M10 release benchmarks, examples, broader browser acceptance, and static publication remain.

**M10 complete — benchmark and static release**

Connected the public `jtmcbride/evo` repository and enabled GitHub Actions Pages publication with HTTPS. Added a workflow that gates deployment on typecheck, lint, the engine/runtime/store/archive suite, and production Chromium acceptance under `/evo/`. Pull requests verify without deploying; successful `main` builds publish the static app and workers. See [publication setup](publication.md). CI limits concurrent Vitest workers to two after the initial hosted run oversubscribed CPU-heavy archive fixtures and hit a timeout.

After the initial push, the bounded three-run, ten-generation pilot completed in 62.14 seconds on Node 24.18.0 / Apple M1 Pro. All three improved on fixed validation; mean champion food collection rose from 7.0000 to 10.8125. Both random baselines were weaker in every run, and the scripted baseline was stronger in every run. Generation medians were approximately two seconds. The same task-design seeds were reused from M3; this is exploratory validation, not held-out evidence. See [the pilot report](benchmarks/m10-short-pilot.md).

Froze a fresh-seed 20-run × 200-generation protocol before executing its manual hosted workflow. All 4,000 generations completed without technical failures; raw-data verification covered 1,536,000 training trials, maps, scores, champions, scheduled validation and final commit identities. All twenty runs improved on validation and separate endpoint-only held-out maps. Mean held-out food collection rose from 7.896094 to 29.399219; every final champion exceeded all three reference baselines on both suites. Workflow wall time was 659 seconds with 2.802 aggregate run-hours. [The full report, raw compact results, and protocol](benchmarks/benchmark-open-v1.md) preserve spreads, per-run outcomes, provenance, and limits.

Bundled initial/final archives from preregistered nearest-median run 7, displayed on fixed validation map 0. Browser-generated replay records retain Node training provenance; exact same-runtime generation was verified twice and measured Node/Chromium differences are disclosed. Examples create separate local saves, verify checksums, preserve existing experiments, and reject stale in-flight downloads.

Seventy-nine engine/runtime/store/archive tests pass. The release browser matrix contains 34 Chromium, 29 Firefox functional, and 34 WebKit cases, including example restore/corruption/race tests. Chromium/WebKit retain desktop/mobile automated accessibility scans. Pinned Firefox's axe scan crashes on initialized pages, so Firefox accessibility scans are explicitly excluded and not claimed as passing. Measured browser pause p95 values were under 8 ms on the reference Mac; the approximately 18–23 Hz arena cadence falls below the original near-60-fps aspiration and is documented as a performance follow-up. [Release evidence and reproduction steps](release.md) record these limits and production asset checks.
