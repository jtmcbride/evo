# Frozen open-arena benchmark

Protocol [benchmark-open-v1](benchmark-open-v1-protocol.md), SHA-256 `9a8f0f3a291d7bb6a3f984a7a0d35abf4f150e2869234fd359444a5326ea1ba4`, source commit `1fb5f40ddc8c6d59b3936aa50ca1223623a6a0b6`. 20/20 runs completed 200 generations; 0 technical failures. All 4,000 evaluated generations completed.

All scores are mean food collected per episode. Initial/final champions were selected only by generation-0/generation-199 training totals. Each run uses 16 fixed validation maps and 64 distinct endpoint-only held-out maps; reproduction never sees those scores. These fresh seeds were frozen before execution.

| Run | Initial validation | Final validation | Paired change | Initial held-out | Final held-out | First observed improvement (generation index) | Run seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 7.313 | 29.063 | 21.750 | 8.156 | 29.688 | 9 | 550.748 |
| 1 | 12.063 | 28.688 | 16.625 | 10.469 | 29.031 | 19 | 574.407 |
| 2 | 8.500 | 33.125 | 24.625 | 7.516 | 32.453 | 9 | 523.010 |
| 3 | 8.438 | 32.875 | 24.438 | 7.625 | 31.734 | 9 | 562.070 |
| 4 | 6.000 | 28.375 | 22.375 | 5.594 | 28.000 | 9 | 428.408 |
| 5 | 8.688 | 29.500 | 20.813 | 9.359 | 29.484 | 9 | 558.304 |
| 6 | 9.563 | 25.125 | 15.563 | 10.813 | 26.063 | 9 | 561.649 |
| 7 | 9.063 | 29.125 | 20.063 | 9.000 | 30.563 | 9 | 559.513 |
| 8 | 6.875 | 32.188 | 25.313 | 6.219 | 32.656 | 9 | 492.301 |
| 9 | 9.000 | 26.750 | 17.750 | 8.656 | 27.672 | 9 | 319.620 |
| 10 | 4.625 | 29.500 | 24.875 | 5.641 | 29.203 | 9 | 564.682 |
| 11 | 6.438 | 26.750 | 20.313 | 7.984 | 27.063 | 9 | 585.088 |
| 12 | 5.000 | 31.063 | 26.063 | 6.750 | 30.906 | 9 | 323.081 |
| 13 | 9.313 | 30.688 | 21.375 | 9.297 | 28.969 | 9 | 573.188 |
| 14 | 6.313 | 24.500 | 18.188 | 6.703 | 25.109 | 9 | 357.743 |
| 15 | 4.375 | 27.500 | 23.125 | 4.969 | 28.234 | 9 | 555.152 |
| 16 | 8.063 | 29.313 | 21.250 | 8.594 | 30.078 | 9 | 426.220 |
| 17 | 8.188 | 28.750 | 20.563 | 8.156 | 29.031 | 9 | 596.489 |
| 18 | 8.563 | 31.813 | 23.250 | 7.656 | 30.578 | 9 | 553.628 |
| 19 | 8.563 | 31.938 | 23.375 | 8.766 | 31.469 | 9 | 422.244 |

Validation improved in 20/20 runs; 0/20 did not improve. Across-run means: 7.747 → 29.331. Final median 29.219, IQR 28.156–31.250, range 24.500–33.125. Median paired improvement 21.563, IQR 20.250–23.641, range 15.563–26.063.

Held-out improvement: 20/20. Across-run means 7.896 → 29.399; median paired change 21.547, IQR 19.523–23.340, range 15.250–26.438. Held-out maps were generated/evaluated after training and did not choose the example. They share the same open-arena distribution; this does not establish obstacle-world or out-of-distribution generalization.

Final champions strictly exceeded frozen random networks / random actions / the scripted controller in 20 / 20 / 20 validation runs and 20 / 20 / 20 held-out runs (out of 20). Full per-run baseline means and score arrays are in the [JSON report](benchmark-open-v1.json). No confidence interval or significance claim is made; evolutionary runs, not map trials, are the independent replicates.

First improvement is observed on scheduled validation at generation indices 9, 19, …, 199, relative to that run's initial champion. It is not the exact earliest learning event and need not persist in every later generation. 0 runs had no observed scheduled improvement.

## Runtime and retained evidence

Aggregate run elapsed time: 10087.546 seconds (2.802 runner-hours), including endpoint evaluations and saves, excluding dependency installation/artifact upload. Jobs execute independently in parallel, so this sum is not workflow wall time. Per-generation core compute median 2.661 seconds, p95 3.007, range 1.441–3.688. File-save median 0.022 seconds; peak sampled RSS 283.832 MiB. These hosted Node measurements do not measure browser rendering or IndexedDB.

Runtime/hardware per run, memory samples, timing samples, commit IDs, endpoint scores and scenario hashes are retained in JSON. Full raw generation/map/trial records, endpoint genomes and resumable checkpoints are in [workflow artifacts](https://github.com/jtmcbride/evo/actions/runs/42340384627) with 30-day retention, and downloaded under ignored local artifacts. Regenerate from the frozen protocol and source commit; do not assume exact equality across operating systems, browser engines, Node versions, or CPUs.

## Bundled example selection

The preregistered nearest-median rule selects run **7**, with lowest run index breaking ties. Its initial and final training-selected controllers are displayed on validation map 0, without choosing a favorable trajectory. Archives contain Node-trained populations and Chromium-generated replay records, with both fingerprints. They are partial-history examples, not complete training lineage archives. Browser replay/continuation on a different runtime is explicitly labelled.

Workflow wall time, including setup and artifact upload: **659 seconds** (2026-11-07T04:53:31Z to 2026-11-07T05:04:30Z). [The raw-data verification record](benchmark-open-v1-verification.json) covers 4,000 generations and 1,536,000 training trials. [Release browser/performance notes](../release.md) record browser acceptance and measured replay limits.
