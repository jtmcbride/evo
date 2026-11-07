**M4 worker runtime**

One module Web Worker owns training and independent selected-trial playback. Both use the existing numerical engine. Scheduling changes when work executes and when observations reach the page; fixed ticks, decision cadence, seeds, and reproduction stay in core. The production build emits a separate worker asset and resolves it through Vite's configured base path.

`SimulationClient` creates and owns the worker. Await `client.ready`, then use `client.request(command)` and subscribe to pushed events. Every command carries protocol version 1, the worker session ID, and a unique request ID. Initialization returns an experiment ID and epoch; training and checkpoint commands must include that scope. Reinitialization changes the epoch even when the experiment ID is reused. Playback commands carry a playback ID. Old-session events, duplicate sequences, stale experiment commands, and replaced playback replies cannot update current work.

| Commands | Contract |
| --- | --- |
| `initialize` | Validate/copy a checkpoint and replace the experiment; cancel prior deferred work |
| `startTraining` | Evaluate the requested additional generations, subject to acknowledgment barriers |
| `pauseTraining` | Acknowledge at a tick boundary; stop scheduling training without discarding the partial generation |
| `requestCheckpoint` with `latest` | Return the most recently acknowledged population immediately |
| `requestCheckpoint` with `afterGeneration` | Finish an active generation, wait for its save acknowledgment, return its next population, and pause; cancellation or failed saving rejects the request |
| `commitSucceeded` | Accept the pending generation and allow further evaluation; retrying the latest acknowledgment is idempotent |
| `commitFailed` | Retain the pending generation, pause training, and reject a waiting completion request |
| `openPlayback` | Create an independent traced episode and replace prior playback |
| `setPlaybackState` | Set playback pause/play and speed; paused playback does not advance |
| `stepPlayback` | Advance one exact tick or through the next controller decision |
| `inspectPlayback` | Return an exact current state and the last decision trace without advancing |
| `seekPlayback` | Restore a preceding cached checkpoint and re-simulate in bounded slices; report actual terminal tick if the episode ends first |
| `comparePlayback` | Require a paused selected episode, copy its checkpoint, and return a completed control/masked pair without advancing playback |
| `replayComparison` | Run a pair from its saved source independently of playback; comparison commands require the active experiment scope |
| `compareControllers` | Evaluate frozen parent/child genomes on an explicit shared scenario suite from tick zero; use the active experiment scope and bounded comparison scheduler |
| `dispose` | Cancel deferred work and release the worker; the client rejects outstanding requests |

Snapshot receipts and timeout cancellation are internal one-way commands. Normal requests have a default 30-second timeout; startup is bounded as well. The client caps queued/pending requests at 64. Observers receive structured training/playback errors and fatal worker errors. A fatal transport error rejects all pending requests and terminates the client. Call `client.close()` to force cleanup when a view is removed.

Training work runs in groups of at most 32 episode ticks, checked against an approximately 8 ms wall-clock slice. This is a soft scheduling budget: a synchronous core transition can exceed it. The worker host yields through a real `setTimeout` task between pumps so incoming commands can run. Playback advances every fixed tick needed for its wall-clock speed; it does not increase the physics timestep. M7 comparison jobs receive an approximately 2 ms share of the slice in groups of 16 paired ticks, followed by playback/seek and training. These remain soft budgets. No promise of uninterrupted background-tab execution is made.

Training progress is published approximately four times per second. Playback publishes latest-value frames at approximately 20 Hz during playback, with exact paused/step replies. At most one snapshot is awaiting receipt; intermediate states are coalesced. A final dirty state is flushed after an older frame is received even if playback has paused or finished. Reliable inspection replies and generation commits do not depend on frame receipts. Up to 128 playback checkpoints, including tick zero, support seeking. Only the selected trial's body, remaining-food state, result, and last decision are sent in frames; static world data is known from opening the trial. Ordinary structured cloning is used, so live engine buffers are never detached.

A generation commit is emitted once, and the engine waits for its acknowledgment. The caller must save it before sending `commitSucceeded`; acknowledgment alone does not establish durability. Failed saving preserves the pending population for retry or export. The diagnostic page uses a bounded five-record memory store and labels that behavior. The M6 main workbench supplies atomic IndexedDB persistence; the diagnostic page remains in memory. M7 adds independent sensor-mask pairs in bounded comparison slices; M8 adds frozen parent/child suites through the same bounded scheduler; extended interventions remain M9. See [the comparison contract](interventions.md).

Use `npm run dev` and open `runtime.html` for manual diagnostics. Initialize a population, train, open a trial, play/pause, step to a decision, inspect, and seek. This page supplies a manual runtime acceptance surface; arena rendering, charts, and a graphical brain inspector remain M5.

The committed browser suite builds and tests the production bundle with `/evo/` as its base. It verifies generation identity against a reference in the same browser while an independent episode is inspected and sought, responsive default-population training with playback, failed-save retry, a complete default generation, and a real injected worker failure. Cross-browser bit-identical evolution is not asserted.

Acceptance on this Mac (Apple M1 Pro), Playwright 1.65.0, Chromium 158.0.8127.18:

| Check | Observation |
| --- | --- |
| Engine/runtime/client tests | 30 passed |
| Production Chromium acceptance | 5 passed |
| Pause acknowledgment during default training plus playback | 0.6, 2.5, 5.6, 5.2, 4.5 ms |
| Main-page heartbeat during responsiveness test | 40 callbacks at a 10 ms interval |
| Default generation | 128 genomes × 3 trials; checkpoint advanced to generation 1 |
| Default generation completion | Approximately 3,889 ms, including test polling overhead |
| Build location | Production assets and worker loaded under `/evo/` |

These are focused-tab smoke measurements with five pause samples and one full generation, not percentile estimates or broad device performance guarantees. The browser regression test allows 250 ms maximum acknowledgment time for CI tolerance; the measured samples satisfy the plan's provisional 100 ms target. Firefox/WebKit functional acceptance and broader performance measurements remain release work.
