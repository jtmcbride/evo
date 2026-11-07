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

**M6 durable-save foundation**

Added versioned IndexedDB storage for experiment heads, population checkpoints, genomes/parameters, memberships, scenarios, evaluations, trials, and generation records. Generations are saved atomically before worker acknowledgment, with idempotent retries and revision guards. Reload recovers the active saved population paused, including retained champion replays and bookmark state; interrupted training is identified for rerun. Thirty-eight engine/runtime/store/database tests, typecheck and lint pass, plus production browser reload and interrupted-generation checks. Portable archives and save-failure recovery acceptance are the next stage.

**M6 portable-checkpoint stage**

Added `.evolab` ZIP checkpoints with versioned manifests, per-entry SHA-256 checksums, explicit little-endian Float32 parameter files, retained replay/history metadata, and runtime provenance. A separate archive worker keeps compression/validation off the simulation and UI threads. Imports are validated before an atomic new local save is exposed. Size, count, path, parameter/reference, and streaming expansion limits reject damaged or oversized data. Forty-four tests, typecheck and lint pass; real browser download/import into a fresh context preserves continuation, and invalid imports preserve the existing experiment. Save-response loss and fast-generation save-queue races are covered. Browser quota/conflict acceptance and final documentation remain.
