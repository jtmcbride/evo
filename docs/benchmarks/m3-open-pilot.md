**M3 open arena task pilot**

Five independent runs completed 50 generations each using the default 128 genomes, three training trials per genome, 1,800-tick episode limit, and mutation-only evolution. Every run used its own rotating training scenarios and 16 fixed validation scenarios. Initial and final champions were selected using training scores; validation never affected reproduction.

Runtime: Node v24.18.0, macOS arm64, Apple M1 Pro. These are headless Node measurements. Verification commands ran concurrently during portions of the pilot, so timings are exploratory and do not establish browser performance.

| Run | Initial champion | Final champion | Frozen random network | Random actions | Scripted |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 6.7500 | 22.2500 | 0.8750 | 0.5000 | 22.1250 |
| 1 | 8.5000 | 18.6875 | 0.9375 | 0.9375 | 19.6875 |
| 2 | 5.7500 | 20.0000 | 1.0625 | 0.3750 | 25.8750 |
| 3 | 3.8125 | 25.8125 | 0.3125 | 0.3125 | 27.2500 |
| 4 | 7.6250 | 21.7500 | 0.4375 | 0.6250 | 22.3750 |

Scores are mean food collected per validation episode. Mean champion performance across runs rose from 6.4875 to 21.7000; all five runs improved. Final evolved controllers exceeded both random baselines in every run. The scripted controller remained stronger in four of the five runs.

Between 74.2% and 82.0% of initial genomes collected food in at least one training trial (see raw data for exact run fractions). The preset therefore provides a measurable initial selection signal.

Run-level median generation times ranged from 1.84 to 2.28 seconds. Generation timings include scheduled validation work where applicable.

This is an exploratory task-design pilot on one environment family, with validation observed during training. It does not establish held-out generalization, obstacle-world learning, statistical significance, or cross-runtime replay. The twenty-run frozen benchmark remains M10 work.

[Raw configurations, seeds, per-generation summaries, baseline results, and timings](m3-open-pilot.json) preserve all five runs. Large resumable checkpoints remain under the ignored local `artifacts/m3-pilot` directory.

Reproduce with:

```sh
npm run benchmark -- --runs 5 --generations 50 --out artifacts/pilot-reproduction
```
