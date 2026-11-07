# M10 publication pilot

Run after the initial public push on November 6, 2026 (America/Los_Angeles), from commit `ffde932e4c3b9689b056b880fb9ac6d1b95a5c07`. Three independent seeded runs evaluated generations 0–9 with the default open arena: 128 genomes, three common training scenarios per generation, 1,800 physics ticks per episode (60 simulated seconds), 48 food, no obstacles, and the existing mutation-only evolution settings.

Each row evaluates its training-selected initial champion (generation 0), final champion (generation 9), and baselines on the same 16 fixed validation maps. Validation does not select parents. These are the existing `pilot-v1-0` through `pilot-v1-2` seeds from M3, so this is a short continuation of task-design verification, not additional held-out evidence. Each run starts from scratch.

| Run | Initial champion | Final champion | Change | Frozen random network | Random actions | Scripted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 6.7500 | 10.1875 | +3.4375 | 0.8750 | 0.5000 | 22.1250 |
| 1 | 8.5000 | 10.3125 | +1.8125 | 0.9375 | 0.9375 | 19.6875 |
| 2 | 5.7500 | 11.9375 | +6.1875 | 1.0625 | 0.3750 | 25.8750 |

Scores are mean food collected per validation episode. All three improved; the across-run mean rose from 7.0000 to 10.8125, and the median paired improvement was 3.4375. Final champions exceeded both random baselines in all three runs. The scripted controller remained stronger in all three. Three short runs do not support a significance or generalization claim.

The process completed in **62.14 seconds** on an Apple M1 Pro, macOS arm64, Node v24.18.0. Run-level median generation times were 2.013, 2.017, and 1.980 seconds; observed per-run p95 values were 2.129, 2.129, and 2.172 seconds. With ten samples per run, the runner's reported p95 is the maximum sample. Timings include core generation work and scheduled validation, exclude the additional endpoint/baseline evaluations, and do not measure IndexedDB, rendering, or browser scheduling. Occasional lightweight release checks ran concurrently.

At roughly two seconds per generation, 20 × 200 generations suggests around 2.2 hours of core Node work before overhead, assuming later generations cost the same. This is a planning estimate from an early-run sample, not a measured full-benchmark cost or a browser performance claim. The frozen protocol, separate held-out suite, browser-generated examples, and wider browser acceptance are still pending.

[Raw results](m10-short-pilot.json) include provenance, complete configurations/seed roots, per-generation training summaries, validation results, baseline scores, and timing summaries. Resumable checkpoints remain in the ignored local `artifacts/m10-short-pilot` directory. Reproduce with:

```sh
npm run benchmark -- --runs 3 --generations 10 --out artifacts/m10-short-pilot-reproduction
```
