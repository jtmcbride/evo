**Evolution Lab**

A deterministic, browser-compatible TypeScript engine for neuroevolution experiments. M0–M5 implement independent 2D foraging trials, a 20–12–2 neural controller, mutation-based evolution, exact inspection, and resumable headless runs. The browser workbench includes seeded setup, training controls, Canvas playback, an inspectable neural graph, sensor readings, measurements, and training/validation history. Historical champions replay their original trials.

Use Node 24.18.0 and the committed npm lockfile:

```sh
npm ci
npm run test:engine
npm run typecheck
npm run lint
npm run build
```

Evaluate any of the three reference controllers:

```sh
npm run evaluate -- --preset obstacles-v1 --seed 42 --controller scripted-v1
npm run evaluate -- --preset open-v1 --seed 42 --controller neural-v1
npm run evaluate -- --preset open-v1 --seed 42 --controller random-v1
```

Train the default population of 128 genomes with three independent trials per genome. All genomes encounter the same seeded trial worlds in each generation. The default objective is mean food collected; reproduction compares equivalent integer totals. Every ten generations, the training-selected champion is evaluated on 16 fixed validation scenarios.

```sh
npm run evolve -- --seed 42 --generations 50 --out artifacts/run-42
npm run evolve -- --resume artifacts/run-42/checkpoint.evo --generations 10
```

`--generations` counts additional generations. Optional `--population` and `--ticks` provide smaller smoke runs; population overrides retain up to four elites and eight immigrants, so use a population above 12 to include mutated offspring with those defaults. The checkpoint is a population ready to evaluate its next generation. If a run stops partway through a generation, resume reruns that generation from its saved starting population.

Each output directory contains an atomic `checkpoint.evo` head and immutable `generation-N/commit.evo` records. A writer lock prevents concurrent writers. An interrupted run can leave a lock: resume its checkpoint into a new `--out` directory. Existing conflicting output is rejected. Matching runtime fingerprints are required for CLI continuation; bit-identical results across browsers/devices are not promised. Filesystem rename protects against process interruption; power-loss durability is not established.

The core entry points are `generateScenario`, `createEpisode`, `restoreEpisode`, `initialCheckpoint`, and `ExperimentRunner`. The experiment runner accepts a tick budget, produces a generation commit, and waits for acknowledgment. Callers can save the commit before allowing the next generation. Accessors return owned copies. Episode checkpoints preserve held actions, the next tick, contact accumulation, random-action state, and the last captured decision trace. The portable codec preserves Float32 bytes and signed zeros.

Run the exploratory pilot explicitly; the default five runs of fifty generations can take several minutes:

```sh
npm run benchmark -- --runs 5 --generations 50 --out artifacts/pilot
```

The pilot reports fixed-validation performance, baselines, initial selection signal, and generation timings. It is separate from correctness tests and does not establish held-out generalization. Generated runs are ignored by Git.

[Implementation plan](docs/implementation-plan.md) and [milestone progress](docs/progress.md) describe contracts, acceptance criteria, and remaining work.


Run browser diagnostics with `npm run dev`, then open the “Open runtime diagnostics” link. Initialize an experiment, start training, and open an independent selected trial. Training and playback have separate pause controls. Generation acknowledgments on this page retain the latest five commits in memory; durable IndexedDB saving remains M6.

Install the pinned test browser and verify the production worker under a repository subpath:

```sh
npx playwright install chromium
npm run test:browser
```

The test command builds with `/evo/` as the asset base, starts a local preview server, and runs Chromium worker and workbench acceptance, including automated accessibility checks. `npm run test:engine` includes pure-engine and runtime/client unit tests. The worker uses approximately 8 ms scheduling slices, exact fixed ticks, a real task yield, and one outstanding render snapshot. `SimulationClient` owns startup, pending requests, stale-message filtering, failure notifications, and disposal. See [the worker contract and acceptance evidence](docs/worker-runtime.md).


The main workbench is available at the root URL from `npm run dev`. Configure a world, create an experiment, and train a batch of generations. Select a population controller or historical champion to inspect its original observations, network activity, and motor commands. Use the sensor-only view to hide global geometry. Mobile layouts provide Inspector/History tabs, and Space/right arrow control playback outside form controls. [The workbench guide](docs/workbench.md) describes exact decision timing, replay retention, and verification. Browser sessions remain in memory until M6 adds durable saves.
