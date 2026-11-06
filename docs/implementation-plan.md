**Evolution Lab implementation plan**

Build a browser application that evolves small neural controllers in independent foraging trials, explains their behavior through replay and inspection, and preserves enough provenance to repeat experiments. This plan describes proposed implementation work; the repository contains no application implementation yet. Numerical values below are starting configurations to validate through benchmarks.

The first playable release runs evolution, displays a selected trial, supports sensor interventions, and saves and restores generation checkpoints. The subsequent complete laboratory release adds lineage comparison and controlled experiment branches. Both use the same numerical engine.

**1. Establish the release scope and implementation rules.**

| First playable release | Complete laboratory release | Deferred extensions |
| --- | --- | --- |
| Open and obstacle arenas | Parent and child trajectory comparison | Shared ecosystems and reproduction during life |
| Fixed 20–12–2 controller | Ancestry navigation and mutation inspection | NEAT, crossover, evolved bodies |
| Tournament selection and mutation | Branches from saved populations | Recurrent controllers and lifetime learning |
| Selected-trial playback and brain inspection | Common evaluation suites for comparing branches | Novelty search and MAP-Elites |
| Sensor masking intervention | Hidden-neuron clamps and parent-weight restoration | WebGPU, WebAssembly, parallel evaluation pools |
| Generation checkpoint export and resume | Full lineage archive export | Freehand map editor, accounts, server training |
| Preset configuration and seeded map previews | Repeated-run benchmark report | General-purpose experiment scripting |

Editing a preset before starting creates an experiment configuration. After starting, changes that affect observations, movement, evaluation, or reproduction create a branch from a checkpoint. Playback speed, display preferences, and selection of an inspected genome are presentation state.

Keep the following invariants explicit: a genome's parameters never change; each trial owns its mutable world state; selection uses only the current generation's training results; inspection does not consume training randomness; render snapshots cannot be used as simulation checkpoints; all changes affecting results have recorded versions or configuration values.

**2. Use one repository with a small set of dependencies.**

| Concern | Initial choice | Reason and constraint |
| --- | --- | --- |
| Application | React, TypeScript, Vite | Static application with a module worker; no server requirement |
| Numerical engine | Plain TypeScript and typed arrays | Shared by the browser and a Node command-line runner |
| Arena | Canvas 2D | Direct drawing from snapshots without updating React per body per frame |
| Brain and charts | SVG with fixed layouts | Small graphs; no graph-layout package needed initially |
| Persistence | Dexie over IndexedDB | Versioned local tables and atomic checkpoint commits |
| Import validation | Zod at file and command ingress | Runtime validation stays outside numerical loops |
| Hashing | SHA-256 through a pinned `@noble/hashes` dependency | One synchronous implementation for canonical identifiers in both runtimes |
| Archives | `fflate` | ZIP export and bounded streaming import |
| Engine tests | Vitest | Headless deterministic tests and fixtures |
| Browser tests | Playwright | Worker, persistence, import, playback, and deployment workflows |
| CLI execution | `tsx` | Execute the same TypeScript engine without a separate application build |

Use npm and commit the lockfile. Pin a mutually compatible supported Node release and package versions during scaffolding, then record them in the toolchain files. Do not introduce a monorepo or a general plugin system.

Vite documents module-worker construction with `new Worker(new URL(..., import.meta.url), { type: 'module' })`. Follow that supported shape so worker assets build correctly. [Vite worker documentation](https://vite.dev/guide/features#web-workers)

The selected hash and archive libraries provide the needed SHA-256 and ZIP operations. Pin the used entry points and versions when implementation begins. [Noble hashes](https://github.com/paulmillr/noble-hashes), [fflate](https://github.com/101arrowz/fflate)

Create these directories as their milestones arrive, rather than scaffolding empty abstractions:

```text
src/
  core/
    model.ts                 Serializable definitions and identifiers
    random.ts                Seed derivation, PRNG, Gaussian sampling
    canonical.ts             Stable encoding and content hashing
    world/                   Scenario construction, geometry, sensing
    controller/              Dense network, baselines, interventions
    episode/                 Fixed-tick runner, trace, checkpoint codec
    evolution/               Trial plans, selection, mutation, population
    experiment/              Generation lifecycle, branching, checkpoints
  runtime/
    protocol.ts              Validated commands, events, request IDs
    simulation.worker.ts     Worker entry point and job scheduling
    client.ts                Worker ownership and request handling
  persistence/
    database.ts              Dexie schema and generation commit
    archive.ts               Portable export and import
    migrations.ts            Supported format and database migrations
  ui/
    store.ts                 Published UI snapshots and preferences
    arena/                   Canvas renderer and pointer interaction
    inspector/               Sensors, brain, motor values, interventions
    experiments/             Setup, history, comparison, storage status
scripts/
  evaluate.ts                Baseline and checkpoint evaluation
  evolve.ts                  Headless evolutionary run
  benchmark.ts               Throughput and repeated-run reporting
tests/
  fixtures/                  Small hand-calculated scenes and checkpoints
  engine/                    Numerical and orchestration tests
  browser/                   Application workflows
public/examples/             Versioned example manifests and archives
docs/                        Semantics, formats, and benchmark reports
```

Dependencies flow inward: UI and runtime call core; persistence reads and writes core data definitions. Core never imports React, Dexie, DOM, worker globals, or a wall clock. Its hot path may mutate exclusively owned buffers. External callers receive owned copies; internal read-only views remain confined to core, because TypeScript `readonly` alone does not protect a typed array's contents.

**3. Define the data model before implementing the simulation.**

| Record | Purpose and required information |
| --- | --- |
| `ExperimentDefinition` | Experiment ID, engine semantics version, immutable config, seed roots, optional source checkpoint and branch changes |
| `ScenarioDefinition` | Realized arena geometry, ordered food records, initial pose, generator version and seed; content hash excludes display names |
| `GenomeRecord` | Genome ID, parameter hash, brain schema, birth event, parent IDs, founder/random-immigrant/mutation origin |
| `GenomeParameters` | The owned 278-element Float32 buffer; accessed through the genome repository or core population |
| `PopulationMember` | Experiment ID, generation, slot, genome ID; separates elite reuse from a new birth |
| `EvaluationSpec` | Scenario hash, movement and sensor configs, episode limits, objective version, engine version, controller variant and stochastic-controller seed if applicable |
| `TrialResult` | Evaluation spec hash, controller identity, food, distance, contact ticks, survival ticks, terminal reason, score, and success/error status |
| `GenerationRecord` | Population membership, ordered training trial IDs, per-genome aggregates, champion ID, reproduction settings, validation references |
| `EpisodeCheckpoint` | Exact resumable state of one trial, including controller state and action timing |
| `ExperimentCheckpoint` | Population ready to evaluate generation `g`, config, seed roots, phase, and reference to the last committed generation |
| `InterventionSpec` | Base controller identity, intervention type, target, value, start/end ticks; never mutates a genome |
| `PlaybackBookmark` | Genome or baseline, evaluation spec, selected tick, intervention reference; separate from training state |

Keep three versions independent: `engineVersion` for result-affecting behavior, `formatVersion` for exported files, and the IndexedDB schema version. Record the application build and runtime fingerprint as provenance. A CSS change does not require a new engine version; a collision or observation change does.

Use distinct identities for lineage and parameters. Two births with identical weights remain distinct lineage events. An elite retains its genome ID and appears in a new population membership record. Content hashes allow identical parameter blobs to be deduplicated without merging ancestry.

The same genome can have multiple `TrialResult` records under different evaluation specifications. An evaluation cache, if later added, must include all result-affecting inputs in its key. The first implementation should not depend on caching for correctness.

An episode checkpoint contains the next tick to execute, evaluation specification and immutable asset references, controller identity, pose, realized speeds, energy, remaining-food bitset, held left/right commands, contact-since-decision accumulator, all result accumulators, terminal state, controller-specific random state, intervention plan/cursor, and last decision trace. The trace supports immediate accurate inspection after restoring; it does not influence control. Decision phase is derived from the tick and recorded cadence. Compiled geometry and scratch buffers are reconstructed from immutable definitions.

An experiment checkpoint contains the generation to evaluate, ordered population membership with resolvable parameter blobs, immutable config, all seed roots, trial-schedule version, source/branch provenance, and last committed generation reference. With the per-work-item seed derivation below, no partially consumed selection or mutation stream exists at this checkpoint phase. Store immutable dependencies in the database or archive before publishing a checkpoint that references them.

**4. Freeze numerical conventions and random-stream rules.**

Use Float32 storage for inherited parameters. Use JavaScript numbers and Float64 scratch buffers for body state, observations, activations, and metric accumulation. Float32 render buffers are allowed because they are presentation-only. Parameter writes explicitly round to Float32; exported binary values use explicit little-endian encoding.

Use integer ticks. One physics tick is `1 / 30` second; neural decisions occur on ticks divisible by 3, including tick 0. Episode lengths are integer tick limits. No accumulation of display-frame deltas enters the engine.

Implement a versioned `xoshiro128**` PRNG using unsigned 32-bit operations and test it against the authors' reference implementation. Hash a canonical seed tuple with SHA-256, take its first four little-endian 32-bit words, and replace an all-zero state with `[1, 0, 0, 0]`. Implement bounded integer sampling with rejection and Gaussian sampling with a documented Box–Muller transform. Use `(uint32 + 1) / 2^32` for the logarithm's uniform input so it cannot be zero. For v1, discard the second Gaussian sample to avoid hidden cached state. [PRNG reference implementations](https://prng.di.unimi.it/)

Seed tuples have fixed field order and explicit domain tags:

```text
["world-v1", trainingRoot, generation, trialIndex]
["initialization-v1", initializationRoot, populationSlot]
["elite-ties-v1", evolutionRoot, generation, populationSlot]
["selection-v1", evolutionRoot, generation, offspringSlot]
["mutation-v1", evolutionRoot, generation, offspringSlot]
["immigrant-v1", evolutionRoot, generation, populationSlot]
["validation-v1", validationRoot, scenarioIndex]
["baseline-actions-v1", baselineRoot, scenarioHash, replicateIndex]
```

World generation further separates geometry, food, and initial-pose streams. A visual operation, genome ID, worker number, completion order, or random UI experiment ID must never enter a shared trial-world seed. Training generations consume the same trial schedule regardless of evaluation order.

Use canonical encodings with sorted object keys, preserved array order, rejection of nonfinite numbers, and normalization of negative zero to zero in JSON configuration fields. Numerical checkpoint binaries preserve exact floating-point bits, including signed zero. Hash specifications and checkpoints outside per-tick loops.

Promise exact repeatability only within the supported pinned engine/runtime combination. Test other browsers for working behavior and diagnose numerical divergence separately. `Math.tanh` is implementation-approximated, and other mathematical operations used by the model also require cross-runtime caution. [ECMAScript numerical specification](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.tanh)

**5. Implement the world and episode runner.**

Start with two scenario families: an open arena and an arena with a small number of axis-aligned rectangular obstacles. Preset configuration exposes seed, food count, and obstacle count. A world editor is not required for the first release.

| Parameter | Initial default |
| --- | --- |
| Arena | 800 × 600 world units; x rightward, y downward |
| Body radius | 8 units |
| Food radius and count | 4 units; 48 items |
| Obstacle count | 0 for open; 5 for obstacle preset |
| Obstacle clearance | At least 32 units from arena edges and other obstacles |
| Sensor range | 140 units |
| Maximum forward or reverse speed | 90 units/second |
| Maximum angular speed | π radians/second; positive clockwise |
| Episode limit | 1,800 ticks, or 60 simulated seconds |
| Initial and maximum energy | 100 |
| Food energy | 20, capped at maximum energy |
| Energy cost per second | `1 + 1.5 * abs(vCommand / vMax) + 0.5 * abs(omegaCommand / omegaMax)` |

Map motor outputs using `vCommand = vMax * (left + right) / 2` and `omegaCommand = omegaMax * (left - right) / 2`. This angular sign follows clockwise-positive headings in the chosen canvas coordinates: a faster left motor turns right. Wrap heading to `[-π, π)`. Starting obstacle sizes are 40–100 units wide and 30–80 units high; sample placements with the clearance constraints below. Food counts must be positive and episode limits finite positive integers. Freeze the complete accepted configuration ranges with the first preset fixtures.

Food and initial positions must clear obstacles and boundaries. Prevent initial overlap between the agent and food to avoid free opening rewards. Use bounded placement attempts and a deterministic invalid-scenario error if a requested configuration cannot be generated. Do not silently reduce food or substitute a different seed. Safe obstacle separation keeps the initial family navigable; arbitrary maze reachability belongs to a later generator.

Compile immutable geometry once per realized scenario. Each episode owns its pose, energy, food-availability bitset, contact accumulator, held motor command, controller state, and metrics. Initially use direct scans for small scenes. Put segment and nearby-object queries behind a narrow geometry interface so a measured spatial-grid optimization does not change sensing semantics.

The core runner exposes a small interface:

```ts
interface EpisodeRunner {
  advance(maxTicks: number): { advancedTicks: number; terminal: boolean };
  inspect(): EpisodeInspection;       // Owned exact snapshot
  checkpoint(): EpisodeCheckpoint;   // Complete copy at a tick boundary
  result(): TrialResult | null;
}

declare function createEpisode(definition: EpisodeDefinition): EpisodeRunner;
declare function restoreEpisode(checkpoint: EpisodeCheckpoint): EpisodeRunner;
```

Internally, one tick follows this order:

1. Apply interventions scheduled for this tick.
2. If a decision is due, construct observations, run the controller, record a decision trace, and replace the held motor commands.
3. Compute commanded linear and angular speed. Update heading, then sweep the body along the straight displacement defined by that heading for this discrete tick.
4. Resolve the earliest body collision, slide along its surface, and process a bounded number of remaining contacts. Resolve simultaneous hits in stable obstacle-ID order.
5. Collect food intersected by the actual resolved movement segments, in stable food-ID order, at most once per item.
6. Subtract energy cost based on commanded effort; add collected food energy; clamp energy. Food collected in this tick can prevent starvation in this tick.
7. Accumulate realized distance, contact ticks, and survival ticks. Update realized speed and contact inputs for subsequent decisions.
8. Advance the tick counter and terminate on exhaustion, all food collected, or the tick limit, with a documented priority if conditions coincide.

Use swept circle-versus-rectangle geometry, including rounded corner contacts, rather than treating an expanded rectangle's square corners as exact. Include arena boundaries in collision handling. Start with a collision tolerance of `1e-6` world units and at most four contacts per tick; version these settings. When the limit is reached, stop the remaining displacement for that tick. Reject initial penetration during scenario validation. Exclude numerical contact-separation corrections from traveled distance and food-collection sweeps.

Keep a tick's contact flag true if any segment contacted an obstacle. Report contact time as contact ticks divided by 30, a discrete measurement rather than a sub-tick duration. The controller's contact input is the OR of contact events since its previous decision, cleared after observations are captured. Initialize it to false. Define signed realized speed as resolved path length divided by the tick duration, with the commanded linear-speed sign. If exhaustion and completion coincide, use `allFoodCollected`, then `energyExhausted`, then `timeLimit` as terminal-reason priority; always retain the raw state and metrics.

Acceptance requires hand-calculated straight movement, rotation, wall and corner collision, sliding, thin-wall protection, path-based food pickup, one-time pickup, and energy/termination cases. Also verify that advancing 900 ticks in one call equals advancing those ticks in varied chunk sizes.

**6. Implement observations, controllers, and decision traces.**

| Input indices | Meaning and normalization |
| --- | --- |
| 0–7 | Food proximity in eight body-relative sectors, starting forward and proceeding clockwise |
| 8–15 | Obstacle proximity on eight corresponding rays, including arena boundaries |
| 16 | Current energy divided by maximum energy, in `[0, 1]` |
| 17 | Previous tick's signed realized speed divided by maximum speed, clamped to `[-1, 1]` |
| 18 | Previous tick's angular speed divided by maximum angular speed |
| 19 | Any contact since the previous decision, as 0 or 1 |

Each food sector covers 45 degrees centered on its ray. Use half-open angular intervals with documented wraparound. Classify food by center angle; measure proximity as distance from the agent center to the food disk surface. Within each sector choose the nearest food whose center has an unobstructed line of sight. A blocked nearer item does not hide a visible farther item from the query. Ties use food ID.

Obstacle rays originate at the body center. Return the first intersection distance with geometry or the arena boundary. Both proximity types use `max(0, 1 - distance / range)`, with zero for no detection. Document that food visibility uses center-line occlusion rather than partial-disk visibility.

Use this row-major parameter layout:

| Range, inclusive | Parameters |
| --- | --- |
| 0–239 | `W1[hiddenIndex * 20 + inputIndex]` |
| 240–251 | `b1[hiddenIndex]` |
| 252–275 | `W2[outputIndex * 12 + hiddenIndex]` |
| 276–277 | `b2[outputIndex]` |

Use tanh for hidden and output activations. Initialize weights uniformly within `±sqrt(6 / (fanIn + fanOut))` per layer and biases to zero. Treat this initialization as a benchmark choice, not a guarantee of effective search. Mutate biases along with weights. Initially apply no weight clipping; reject nonfinite state and report activation saturation and parameter norms as diagnostics.

The controller interface accepts observations and writes two motor outputs into caller-owned buffers. Neural and scripted controllers share it. A diagnostic hook copies actual intermediate values only for an inspected or traced episode. Enabling tracing must not select a different inference implementation.

A decision trace records tick, pose at observation time, raw observations, effective observations after masking, raw and effective hidden activations if clamped, and motor outputs. The UI distinguishes current body state from the last decision's state. Showing current sensors beside old activations without their timing is prohibited.

Implement a frozen random neural controller, a seeded random-action controller that samples at the same decision cadence, and a scripted food-seeker. The scripted controller sees only the same 20 inputs, prioritizes nearby frontal obstacles, steers toward the strongest food sector, and uses a fixed search arc when food is absent. Version its tie handling and rules. Baseline controllers receive no privileged world queries.

Acceptance includes a hand-computed forward pass, independently calculated randomized reference passes, finite-value checks, sector-edge and occlusion fixtures, equal/opposed motor cases, and identical results with tracing enabled or disabled.

**7. Implement generation evaluation and reproduction.**

Initial configuration: 128 genomes; 4 unchanged elites; 8 randomized immigrants; 116 mutated offspring; 3 training trials per genome; tournament size 4; per-parameter mutation probability 0.10; Gaussian standard deviation 0.05. Reject inconsistent counts and invalid parameter ranges at configuration ingress.

Generate a generation's common trial plan once. The runner can evaluate episodes sequentially; there is no requirement to hold 384 active bodies. Store results by population slot and trial index. Aggregate only after all required trials complete successfully. An engine error pauses the generation with diagnostics; it must not become an ordinary zero-food result.

Because all training genomes have the same trial count, compare integer food totals for reproduction; show mean food in the UI. Preserve the raw trial metrics. Do not use validation results, distance, survival, or energy as hidden tie-break objectives.

Every 10 completed generations by default, evaluate the training-selected champion on 16 fixed validation scenarios before finalizing the generation record. These are distinct from training seeds and remain constant for the experiment. Validation results supply the stable progress chart and never enter parent selection. Held-out test evaluation is a separate explicit operation after settings are finalized.

Choose elites using total score and precomputed seeded tie-break keys. For each offspring, sample four population slots with replacement, choose the highest-scoring sampled candidate, and break equal scores using that offspring's selection stream. Never consume randomness inside a sort comparator.

Clone the selected parent's parameter buffer. Walk indices in ascending order, draw a mutation decision for each, and apply a Gaussian perturbation to selected entries with Float32 rounding. Record changed indices and their resulting Float32 values, not just intended deltas. A no-change offspring is still a new birth. Emit the mutation seed and version as provenance; exact recorded values support reconstruction independently of later Gaussian implementations.

The durable checkpoint phase is always `readyToEvaluate`. Checkpoint `g` contains population `g` before its trials. Finishing generation `g` produces its measurements and offspring population `g + 1`; these are committed together with checkpoint `g + 1`. The initial experiment stores checkpoint 0. This makes the displayed last completed generation and next generation unambiguous.

Implement the orchestration state machine as `readyToEvaluate → evaluating → reproducing → awaitingCommit → readyToEvaluate`. Pause is a runtime scheduling flag and leaves the current phase intact. Core produces a self-contained generation commit and waits for an explicit acknowledgment before evaluating the next population. Supply an in-memory commit adapter for tests and early UI work, a filesystem adapter for the CLI, and the IndexedDB adapter in M6. This allows M3–M5 to work before browser persistence is implemented.

Acceptance requires unchanged parent bytes, independent trial food state, correct elite identities, deterministic ties, identical offspring after evaluation-order shuffling, and identical continuation after saving/restoring a generation checkpoint. Changing worker chunk sizes or inspecting episodes must not change results.

**8. Wrap the engine in a responsive worker protocol.**

Use one simulation worker initially. It schedules a training runner and an independent playback runner. All job results carry a worker-session ID, experiment ID where relevant, request ID, and sequence number. Ignore stale messages from replaced workers or replaced playback requests.

| Command | Behavior |
| --- | --- |
| `initialize` | Load a validated new definition or compatible checkpoint |
| `startTraining` | Evaluate toward a configured generation limit or until paused |
| `pauseTraining` | Stop at the next tick boundary and acknowledge the actual state |
| `openPlayback` | Instantiate a chosen controller and exact evaluation specification |
| `setPlaybackState` | Play, pause, or change presentation speed |
| `stepPlayback` | Advance exactly one tick or to the next decision |
| `seekPlayback` | Restore a nearby playback checkpoint and advance to the target tick |
| `compareIntervention` | Create matched baseline and modified playback runners |
| `requestCheckpoint` | Return the last durable generation checkpoint or finish the active generation first, according to the explicit request |
| `commitSucceeded` / `commitFailed` | Complete or suspend the generation persistence transition |
| `dispose` | Stop work and release buffers |

Events include status, playback snapshots, decision traces, generation commit proposals, checkpoint responses, command acknowledgments, and structured errors. An accepted pause is distinct from a completed durable save.

Use synchronous `advance(maxTicks)` calls within approximately 8 ms scheduling slices, checking the wall-clock budget between small groups of ticks. Yield through a real task boundary; awaiting an already-resolved Promise is insufficient to service pending messages. Use feature-detected `scheduler.yield()` with a task-based fallback, then measure pause latency in supported browsers. [MDN scheduler documentation](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield)

Wall-clock measurements only control scheduling and publication frequency. They never alter tick size, decision cadence, trial count, selection, or outcomes. Prioritize active playback enough to remain usable while training consumes remaining slices.

Publish training status at roughly 4 Hz, playback snapshots at up to 20–30 Hz, and decision traces at the controller's cadence. Generation-completion events are lossless. Render snapshots use latest-value semantics and a bounded number of in-flight buffers. Start with structured cloning for small payloads; adopt dedicated transferable render buffers only when measurements justify it. Transferring an ArrayBuffer detaches it from the sender, so live engine buffers must not be transferred. [MDN transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

At generation completion, the worker holds the proposed next checkpoint until persistence acknowledges its transaction. If saving fails, keep the pending data and pause before beginning the next generation. Report retry/export actions rather than silently dropping history.

**9. Build a workbench around selected-trial playback.**

Use an experiment toolbar, central arena, right-hand inspector, and a bottom progress/history area. On smaller screens, switch the inspector and history to tabs. Avoid rendering all population genomes as a full graph.

The setup flow selects a preset and seed, previews the realized world, exposes an advanced evolution configuration, and starts a named experiment. Defaults remain inspectable. A failed scenario preview prevents starting and identifies the invalid setting.

Training controls show completed generation, active evaluation progress, elapsed wall time, measured throughput, and the latest durable save. Playback controls show the selected genome, scenario, tick/time, and whether the episode is a recorded evaluation replay or an intervention experiment. Training and playback have separate pause controls.

Draw static geometry to a cached canvas layer and dynamic food/body/path data to an overlay. Use `requestAnimationFrame` for drawing. Interpolate display positions while playing if helpful, but show exact tick state while paused or stepping. Pointer picking uses the last displayed snapshot.

React owns selections, forms, preferences, and coarse status. Keep high-frequency arena buffers outside React state. A small external store publishes cached immutable snapshots to panels through `useSyncExternalStore`; its documented snapshot identity requirements matter for avoiding unnecessary renders. [React external-store documentation](https://react.dev/reference/react/useSyncExternalStore)

The inspector has sensors, brain, and measurements views. Render the 34 neurons and 264 weighted connections in a fixed SVG layout; show biases separately. Allow connection filtering by selected neuron or weight magnitude. Include exact numeric values, the decision tick, and raw/effective values during interventions. Do not assign functional names to neurons automatically.

The sensor-only view displays the actual sector/ray observation readings and the agent's state. It must not expose exact food positions or obstacle geometry that the input vector does not encode. A separate world view may show the nearest objects responsible for readings as debugging context.

Plot training best/median and fixed-validation results as distinct series. Training maps change between generations; label that fact. Selectable historical champions open their actual trial specifications. Keyboard controls, readable labels, non-color indicators for sign/status, and reduced-motion behavior are part of the workbench acceptance.

**10. Implement durable storage, export, and recovery.**

The main application owns the database adapter. Use tables for experiments, genome metadata, parameter blobs or patches, population membership, scenarios, evaluation specifications, trial results, generations, checkpoints, interventions, and optional trajectories. Index by experiment/generation and genome/parent where needed; do not index large binary buffers.

Serialize and hash a generation's proposed commit before the write transaction. Atomically insert its results, births, membership, and next checkpoint, then advance the experiment's head revision. The worker advances only after acknowledgment. Repeated commit requests use an idempotency key. If acknowledgment is lost, read the stored commit status before retrying.

Compare the expected head revision inside the transaction to prevent two tabs from overwriting the same experiment. A losing writer pauses and can reopen the latest checkpoint or create a new branch. Transaction handling must avoid unrelated asynchronous work inside the active IndexedDB transaction. [Dexie transaction guidance](https://dexie.org/docs/Tutorial/Best-Practices#3-avoid-using-other-async-apis-inside-transactions)

Keep the latest durable population checkpoint and periodic historical checkpoints, initially every 10 generations plus pinned branch points. Persist compact metrics and lineage metadata for every generation. The first playable version may store full birth parameter blobs; add mutation-patch storage and reconstruction before long-run lineage retention becomes a feature. Patches store index/new-value pairs and periodically materialize full blobs to bound reconstruction depth.

Playback keeps exact episode checkpoints every 30 ticks for the active trial, bounded by the supported episode duration. Seek restores the nearest preceding checkpoint and re-simulates. Keep only selected trajectories persistently. Historical playback without a stored trajectory re-evaluates the original genome and saved scenario using its supported engine semantics.

Use a `.evolab` ZIP archive containing a manifest, JSON records, explicitly encoded parameter/state binaries, and per-entry hashes. Support a checkpoint export first: config, seed roots, current population full weights, and required scenario/specification records. Mark unavailable ancestry explicitly. A full-history export later includes the selected experiment's ancestral closure, including records inherited from a parent branch.

Import validates format and engine compatibility, dimensions, finite values, lengths, references, and checksums before publishing a new experiment. Define compressed size, expanded size, entry-count, and per-record limits; enforce expanded-size limits during streaming decompression. Store an import in a staging namespace and expose it only after its manifest commit succeeds. A failed import leaves existing experiments intact.

Storage-full and unavailable-storage states must preserve the running in-memory checkpoint and expose export. Reload resumes from the last committed generation; an interrupted partial generation is rerun and the UI reports that fact. Do not imply exact crash-resume within an active generation. Browser data can be evicted, so exports remain part of the normal save workflow. [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

A known file format with unsupported engine semantics may be viewable as metadata, but continuation must be disabled unless an explicit tested compatibility adapter exists. Never load arbitrary executable code from an archive.

**11. Add interventions, ancestry, and controlled branches.**

The first intervention masks one sensor channel to zero. Apply it at a specified decision boundary for the rest of the episode. Clone the exact pre-decision checkpoint for both control and intervention episodes; both then use the same physics, initial state, and stochastic-controller state. Record the intervention as a separate evaluation variant.

For later hidden-neuron clamps, replace the selected post-tanh activation before the output layer. For parent-weight restoration, load the parent's actual reconstructed Float32 value. Neither operation changes the saved genome. Pausing at a non-decision tick offers application at the next decision and displays that tick; it must not silently recompute an action early.

Show paired trajectories, food totals, contact time, survival, and action differences. Repeat interventions across chosen scenarios before presenting aggregate results. Display observed differences without universal neuron-function claims.

The lineage explorer initially shows one selected ancestry path and nearby children, with pagination or virtualization. Selecting parent and child evaluates both on the same chosen comparison suite, independent of the environments under which they were originally selected. Show the actual mutation indices/values and preserve unsuccessful descendants.

Create branches only from `readyToEvaluate` population checkpoints. Copy logical membership and immutable references; preserve parent/source provenance. Branch changes are an explicit config diff. Body/sensor settings can change while input dimensions remain compatible; topology changes are out of scope.

By default, branches preserve the source trial schedule root and evolutionary seed root for paired experiments, while new lineage events have branch-specific IDs. Those IDs do not affect numerical randomness. Preserve the source generation index. Trial randomness can remain paired even when different environment settings transform the realized maps differently; record both realized scenarios.

Compare branch champions selected by their own training results on one common evaluation suite. For environment-specialization experiments, provide the full matrix of branch controllers against original and modified environment suites. Label exploratory comparisons and keep held-out test suites outside selection and routine monitoring.

**12. Verify behavior through meaningful tests.**

| Layer | Required evidence |
| --- | --- |
| Geometry and sensing | Hand-constructed walls, corners, sector edges, occlusion, multiple visible candidates, arena bounds |
| Episode semantics | Correct movement, food accounting, effort energy cost, termination order, contact accumulation, fixed-tick chunk equivalence |
| Neural controller | Independent reference calculation, parameter ordering, bias behavior, finite values, trace equivalence |
| Randomness | Known PRNG vectors, state round trip, deterministic seed derivation, separated named streams |
| Evolution | Parent immutability, elite reuse, same trials for all genomes, stable selection after shuffled results, reproducible offspring |
| Checkpoints | Continuous run equals restored run; held outputs, decision phase, food mask, metrics, and controller state restored |
| Interventions | Unchanged control copy; intervention acts at the correct tick and network location; no training-buffer mutation |
| Persistence | Atomic generation head, idempotent replay, interrupted commit recovery, revision conflict, quota failure |
| Archives | Valid round trip, mismatched checksum, unsupported engine, nonfinite values, truncated binary, excessive expansion, incomplete references |
| Worker | Pause acknowledgment, stale-request rejection, bounded snapshot queue, training independence from playback and trace subscriptions |
| Browser | Create/run/pause, select and step, seek, intervene, export/import, reload resume, branch and compare |
| Deployment | Worker and example files resolve under the configured repository base path |

Use exact checkpoint/result hashes for same-runtime determinism tests. Exclude timestamps, display state, and scheduling counters from numerical hashes. For analytic geometry and independently computed numerical references, use explicit tolerances. Do not equate a tolerant approximate match with an exact replay guarantee.

Run primary browser acceptance in pinned Chromium and functional checks in Firefox and WebKit. The Node runner shares code, but Node-to-browser numerical equality is separately measured rather than assumed. Do not create a flaky CI test that requires every stochastic run's champion to improve.

Generate exact-replay release fixtures in the supported browser runtime. A checkpoint produced in another runtime may be evaluated or continued here when semantics are compatible, but label that as a new runtime continuation and retain both fingerprints; do not claim it reproduces the original trajectory exactly.

**13. Benchmark throughput and the evolutionary task.**

Measure scenario construction, sensor queries, collision handling, inference, whole-episode throughput, generation duration, checkpoint commit time, pause latency, memory growth, and UI frame times. Record hardware, browser/runtime, build, fixture, and configuration with each report.

The default maximum training workload per generation is 691,200 physics ticks and 230,400 neural decisions before early terminations. It entails 60,825,600 weighted-input multiplications and 3,225,600 tanh evaluations, excluding sensing, geometry, and scheduled validation episodes. Use this as a reproducible workload rather than assuming a generation speed.

Provisional focused-tab usability targets on a documented reference laptop are p95 pause acknowledgment below 100 ms, a selected-trial view near 60 display frames/second, and p95 generation time below 5 seconds for the default preset. Establish actual results before advertising speed. If generation time misses the target, profile sensing and geometry first, then inference and message costs; retain fixed numerical semantics while optimizing.

Start with a one-generation performance pilot, then a task-design pilot of 5 independent runs over 50 generations. Inspect the fraction of initial controllers collecting food, score variation, saturation, wall-sticking, and improvement relative to baselines. Change preset difficulty or initialization only in a new recorded configuration.

After the pilot, freeze a benchmark definition. The initial candidate is 20 independent runs × 200 generations, with 3 rotating training trials per generation and 16 fixed validation scenarios every 10 generations. Estimate compute cost from the pilot before running the full suite. Validation is performed on training-selected champions and does not influence reproduction. Compare initial and final controllers against frozen random-network, random-action, and scripted baselines on identical validation scenarios.

Report run-level results, median and spread, paired improvement, failure rate, generations to improvement, and wall-clock cost. If reporting confidence intervals, resample independent evolutionary runs, not individual trials as if they were independent training runs. Use a separate held-out test suite after the preset and algorithm settings are finalized.

The release claim that evolution improves foraging requires the frozen repeated-run report to support it. The application can accurately show failures; it must not substitute a successful replay for aggregate evidence. Select bundled demonstrations using a recorded rule, such as the run nearest median final validation performance, and label them as previously generated examples.

**14. Deliver the work in milestones with explicit gates.**

| Milestone | Implementation work | Completion gate | Depends on |
| --- | --- | --- | --- |
| M0 Toolchain and contracts | Scaffold Vite/TS; core-only test target; Node CLI skeleton; config and ID definitions; canonical encoding and PRNG | Test/build commands work; reference random vectors pass; core dependency rule enforced | None |
| M1 World and scripted trials | Geometry, two scenario families, observations, movement, energy, food, scripted controller, fixed-tick runner | Hand-calculated scenes pass; two identical CLI evaluations have equal numerical hashes | M0 |
| M2 Neural controller and exact inspection | 278-parameter network, initialization, baseline controllers, decision traces, episode checkpoints | Reference inference passes; trace on/off matches; arbitrary-tick checkpoint continuation matches | M1 |
| M3 Headless evolution | Training and validation plans, aggregation, tournaments, mutation, elite identities, generation checkpoints | Small multi-generation run reproduces after restore and reordered evaluations; parent buffers unchanged | M2 |
| M4 Worker execution | Typed protocol, time-sliced scheduler, independent playback, command cancellation and bounded publication | UI heartbeat stays responsive; pause is acknowledged; inspecting does not alter training | M3 |
| M5 Workbench | Setup/preview, canvas arena, playback, exact inspector, training charts and history selection | Create an experiment and inspect a controller at an exact decision tick through the UI | M4 |
| M6 Durable experiments | Dexie schema, atomic commits, latest checkpoint recovery, portable checkpoint archive, import validation | Reload and export/import continue the same population; injected write failure preserves the pending checkpoint | M3, M5 |
| M7 Sensor intervention and first playable release | Matched replay, sensor mask, side-by-side outcomes, browser flow coverage | Disable a sensor at a recorded tick, reproduce both outcomes after reload, and keep training unchanged | M5, M6 |
| M8 Lineage retention | Parent/child records, sparse mutation patches, reconstruction checkpoints, selected-ancestry UI, full export | Reconstruct and replay an ancestor after archive round trip; compare parent/child under identical conditions | M6, M7 |
| M9 Branching and extended interventions | Branch provenance/config diff, paired schedules, common-suite comparisons, neuron clamps and parent-weight restoration | Source remains unchanged; restored branches reproduce; comparison cells reference explicit common suites | M8 |
| M10 Benchmark and static release | Frozen repeated-run report, representative bundled examples, production asset tests, Pages workflow | Correctness suite and browser flows pass; reproducibility limits and measured performance are recorded; deployment is reviewable | M7 for playable release, M9 for complete lab |

Run the small scientific and performance pilots after M3; do not wait until M10 to discover that the task supplies no selection signal. Repeat benchmark work only when relevant algorithms or semantics change. UI-only changes need workflow checks, not a new full evolutionary sweep.

Each milestone should be reviewable independently with its tests and an executable demonstration. Split a milestone further when needed for review; do not combine unrelated engine, storage, and UI rewrites into one change.

**15. Define the development commands and delivery workflow.**

Implement these command surfaces during their owning milestones; they are planned interfaces, not commands available in the current repository:

```text
npm run dev
npm run typecheck
npm run lint
npm run test:engine
npm run test:browser
npm run build
npm run preview
npm run evaluate -- --preset open-v1 --seed 42 --controller scripted-v1
npm run evolve -- --preset open-v1 --seed 42 --generations 50 --out artifacts/run-42
npm run benchmark -- --suite benchmark-v1 --out artifacts/benchmark-v1
```

The CLI accepts the same serialized definitions and checkpoints as the browser. It writes a manifest, raw trial/generation records, compact summaries, and a final checkpoint. Keep generated runs out of normal source control except curated small fixtures and release examples.

CI runs type checking, lint, deterministic engine tests, build, and the critical Chromium workflow. Run Firefox/WebKit workflows on the release matrix. Keep longer scientific benchmarks as an explicit workflow, with preserved reports and configuration, rather than making them a slow stochastic gate on every UI change.

Prepare GitHub Pages deployment only after the production build passes asset tests. Set the actual repository base path, use asset URLs derived from Vite's base, and avoid server-dependent routes. Vite requires a repository base such as `/<REPO>/` for project Pages deployments. [Vite static deployment guidance](https://vite.dev/guide/static-deploy.html#github-pages)

The production app executes in the visitor's browser. It can restore saved generations but does not promise continued training after the page closes. Keep example runs visibly distinct from active new runs. No account, backend, or telemetry service is required for these milestones.

**16. Start with one complete numerical experiment.**

The first implementation batch is M0 followed by M1: create the toolchain, freeze seed and observation conventions, implement the world, and run a scripted controller headlessly. Its concrete demonstration is a seeded episode whose movement and food accounting match fixtures, whose result hash repeats, and whose tick chunk size does not affect the result.

M2 extends that demonstration to a real neural controller and exact episode restore. M3 adds evolution. Those three engine demonstrations establish the evidence needed before the more expensive interface and history work begins.
