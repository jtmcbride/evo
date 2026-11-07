**M0 complete**

Pinned Node/npm dependencies, Vite/React scaffold, strict TypeScript, ESLint, core dependency checks, Vitest, canonical SHA-256 identifiers, and versioned xoshiro128** streams are implemented. Reference-vector/state restore and canonicalization tests pass. Typecheck, lint, and production build pass. CLI scripts use `node --import tsx` to avoid an unnecessary IPC listener in restricted environments.

**M1 complete**

Implemented seeded open/obstacle scenarios, 20 local observations, exact rounded-corner swept-body collisions with sliding, path-based food pickup, effort energy costs, and fixed-tick scripted trials. Eight tests pass, including chunk equivalence, analytic movement/energy, tunneling, occlusion, stationary pickup, and independent state. Typecheck, lint, and production build pass. The obstacle seed-42 scripted demonstration collected 26 food in 1,800 ticks; this is a functional fixture, not an evolutionary benchmark.

**M2 complete**

Added Float32 20–12–2 neural parameters, reusable Float64 inference buffers, frozen-neural and seeded random-action baselines, exact decision traces, and portable episode checkpoints. The codec preserves parameter bytes and signed zero. Eleven tests pass, including independent neural reference calculations, trace equivalence, and random/neural restoration at tick 17 between decisions. Typecheck, lint, and production build pass.

**M3 complete**

Implemented common training trials, fixed validation trials, seeded tournaments, mutation with exact parameter patches, unchanged elite identity reuse, and a tick-budgeted experiment state machine with an acknowledgment barrier. Added an in-memory commit store, a guarded filesystem adapter, resumable evolution CLI, and exploratory pilot runner. Twenty-one tests pass, including shuffled evaluation order, generation restore, patch reconstruction, filesystem recovery/conflicts, and an actual CLI split run matching an uninterrupted run byte-for-byte. Typecheck, lint, and production build pass.

The default-size open-arena pilot completed five independent runs of fifty generations each. All five improved on fixed validation scenarios; mean champion food collection increased from 6.4875 to 21.7000. The scripted baseline remained stronger in four runs. See [the complete pilot report](benchmarks/m3-open-pilot.md) and its raw results. Held-out generalization and browser performance remain unmeasured.

**M4 runtime foundation**

Added a validated, versioned worker protocol; scoped session/experiment commands; an 8 ms cooperative runtime; independent playback with exact stepping and bounded seek checkpoints; explicit generation-save acknowledgments; latest-value snapshots with one outstanding frame; and a worker-owning client with timeout/error/disposal cleanup. A read-only core progress accessor supplies compact status without copying the population. Twenty-eight engine/runtime tests, typecheck, and lint pass. Real browser and production-worker acceptance are next.
