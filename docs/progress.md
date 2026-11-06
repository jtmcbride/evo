**M0 complete**

Pinned Node/npm dependencies, Vite/React scaffold, strict TypeScript, ESLint, core dependency checks, Vitest, canonical SHA-256 identifiers, and versioned xoshiro128** streams are implemented. Reference-vector/state restore and canonicalization tests pass. Typecheck, lint, and production build pass. CLI scripts use `node --import tsx` to avoid an unnecessary IPC listener in restricted environments.

**M1 complete**

Implemented seeded open/obstacle scenarios, 20 local observations, exact rounded-corner swept-body collisions with sliding, path-based food pickup, effort energy costs, and fixed-tick scripted trials. Eight tests pass, including chunk equivalence, analytic movement/energy, tunneling, occlusion, stationary pickup, and independent state. Typecheck, lint, and production build pass. The obstacle seed-42 scripted demonstration collected 26 food in 1,800 ticks; this is a functional fixture, not an evolutionary benchmark.
