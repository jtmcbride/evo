# M10 release evidence

The release includes the [frozen 20 × 200 benchmark](benchmarks/benchmark-open-v1.md), two representative bundled examples, production `/evo/` asset checks, a repeatable browser matrix, and Pages publication. The benchmark supports improved foraging on this particular open-arena distribution; it does not establish obstacle-world learning or general intelligence.

## Benchmark and examples

All 20 runs completed all 200 generations with no technical failures. Across-run mean validation food collection rose from 7.746875 to 29.331250; held-out means rose from 7.896094 to 29.399219. Every final champion exceeded its initial champion and all three reference baselines on both suites. The [full report](benchmarks/benchmark-open-v1.md) includes every run, medians/spreads, first observed improvement, baseline score arrays, hardware/runtime provenance, and limitations.

The manual [benchmark workflow](https://github.com/jtmcbride/evo/actions/runs/42340384627) finished in 659 seconds of wall time across independent hosted jobs, using 2.802 aggregate runner-hours. A [raw-data audit](benchmarks/benchmark-open-v1-verification.json) verified 4,000 generations and 1,536,000 training trials, rotating maps, fitness totals, training-selected champions, scheduled validation, endpoint suites, and final checkpoint/commit identities. Downloaded raw records/checkpoints occupy about 205 MiB under ignored `artifacts/benchmark-open-v1`; hosted workflow artifacts expire after 30 days. The committed compact JSON retains endpoint score arrays, scenario hashes, configurations, timing/memory samples, and commit identifiers.

The preregistered nearest-median rule selected run 7. **Previously generated examples** opens its generation-0 and generation-199 training-selected champions on fixed validation map 0. Each archive creates a separate local save with the original 128-member population checkpoint. The archive has a partial ancestry/history, not a complete retained training run. Loading is disabled during training, checks SHA-256 before import, and refuses to replace a save that changes during download. Failed downloads leave the current experiment intact.

Node supplied trained parameters and checkpoint provenance. Replay records were generated twice in pinned Chromium, with exact equality checked within that runtime. [Measured Node/Chromium comparisons](benchmarks/m10-replay.json) were **not** bit-identical: maximum sampled coordinate differences were approximately 1.7e-11 for the initial controller and 0.0475 world units for the final controller. Both runtimes collected 8 and 31 food respectively on the selected map. First-decision hidden/output differences were around 1e-16. These two examples do not establish cross-runtime identity elsewhere. Browser imports retain both fingerprints and explicitly disclose new-runtime continuation.

## Browser acceptance

`npm run test:browser` remains the Chromium CI gate. `npm run test:release` runs Chromium, Firefox, and WebKit; `.github/workflows/release.yml` provides an explicit hosted release matrix. All tests use the production build under `/evo/`, including separate simulation/archive workers and the bundled files.

The release matrix comprises 34 Chromium cases, 29 Firefox functional cases, and 34 WebKit cases. It covers create/train/pause, exact same-runtime inspection, history/lineage replay, sensor/neuron/parent-weight interventions, branch matrices, archive restore, save failures, stale tabs, reload recovery, examples, corruption rejection, and delayed-download races. Chromium and WebKit also run automated desktop/mobile WCAG A/AA scans. These checks are not physical-device Safari acceptance.

**Firefox scanner limitation:** pinned Firefox 159.0 on macOS crashed inside axe's `frame.evaluate` after an experiment was initialized, across all four existing accessibility scans. The app's functional flows passed. Isolated checks reproduced the scanner crash in legacy mode, with contrast disabled, with graphics removed, and with workers stopped. Firefox's project therefore excludes tests named `accessible`/`WCAG`; the complete scans remain enabled in Chromium/WebKit. This is recorded as a coverage limit, not a passing Firefox accessibility audit.

## Performance observations

[Raw measurements and build hashes](benchmarks/m10-performance.json) record an Apple M1 Pro / macOS arm64 / Node 24.18.0 host, committed source `55d19b4`, and pinned Chromium 158.0.8127.18, Firefox 159.0, and WebKit 27.2. Headless focused-tab measurements used one default open-world generation with Canvas playback and 20 pause samples per browser.

| Browser | Default generation + save | Pause p95 (20 samples) | Median arena paint interval |
| --- | ---: | ---: | ---: |
| Chromium | 3.843 s | 6.635 ms | 49.9 ms |
| Firefox | 4.917 s | 4.050 ms | 57.0 ms |
| WebKit | 3.899 s | 7.000 ms | 43.0 ms |

These are smoke samples, not per-browser generation p95 estimates. Pause observations meet the provisional 100 ms target on this host. The arena's roughly 18–23 Hz median paint cadence **does not meet the original near-60-fps target**. The current worker intentionally publishes at most once per 50 ms, physics remains fixed at 30 Hz, and inspector rendering is throttled separately. No smooth-60-fps claim is made. Improving presentation cadence remains a performance follow-up rather than changing simulation timing for this release.

Two IndexedDB experiment-head transactions were measured per browser around starting/completing the generation. Observed maxima were 271.1 ms (Chromium), 435 ms (Firefox), and 368 ms (WebKit); these include actual transaction completion, with too few samples for a reliable tail estimate. They are distinct from worker pause latency.

The microprofile uses a fixed five-obstacle fixture, one warmup batch and 30 measured batches. It records scenario construction, sensing, swept collision movement, neural inference, and whole-episode cost; batch means are reported per call. Hosted full-benchmark generation compute median was 2.661 s and p95 3.007 s across mixed runner CPUs, with file-save median 22.4 ms. Those values do not include browser persistence/rendering. Hosted sampled RSS grew from roughly 107–115 MiB after the first generation to 238–283 MiB at the end (peak 283.8 MiB); allocator/GC effects and retained reporting data are included, and this is not a memory-leak proof.

## Reproducing the release

Use Node 24.18.0 and the committed lockfile:

```sh
npm ci
npm run typecheck
npm run lint
npm run test:engine -- --maxWorkers=2
npx playwright install chromium firefox webkit
npm run test:release
VITE_BASE_PATH=/evo/ npm run build
node --import tsx scripts/profile-release.ts
```

The long benchmark is explicit: dispatch **Frozen release benchmark**, then download its twenty artifacts into a new directory. Preserve the workflow JSON there as `workflow.json` to include total workflow wall time in reports. Keep the frozen protocol/source version with all results.

```sh
node --import tsx scripts/verify-benchmark.ts --input artifacts/benchmark-open-v1
node --import tsx scripts/summarize-benchmark.ts --input artifacts/benchmark-open-v1
node --import tsx scripts/generate-examples.ts --input artifacts/benchmark-open-v1
```

Example authoring uses a loopback-only Vite server and pinned Chromium. Re-authoring changes provenance timestamps/archive checksums; rerun production example acceptance after regenerating files. Exact replay is supported within matching runtime semantics, and approximate cross-runtime observations must not be relabeled as exact equality.
