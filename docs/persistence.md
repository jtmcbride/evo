**M6 durable experiments and checkpoint archives**

The main workbench automatically saves the initial population and every completed generation in this browser. The save indicator and experiment selector show the current local save. Starting another experiment creates a separate save, including when its seed/name matches an existing run. Reload opens the most recently selected experiment paused at its last accepted population. Retained history and the checkpoint's playback bookmark are restored.

A saved population is ready to evaluate its next generation. Active partial generations are not persisted. A training marker identifies work that stopped before the next save; recovery explains that work beyond the saved population will rerun. Training does not continue after closing the page. Pausing playback or inspecting a controller remains independent of training.

| Situation | Behavior and action |
| --- | --- |
| Normal generation completion | Save the generation atomically, then acknowledge it to the worker |
| Write/quota failure | Pause before evaluating the next generation; retain the complete pending population in memory |
| Retry save | Reconcile an already committed generation or write it once, then accept it in the worker |
| Export checkpoint | Export the latest complete population, including a pending unsaved generation; exclude an active partial generation |
| Load saved population | Replace the current in-memory run with its saved checkpoint; export pending work first if it must be retained |
| Another tab saved a newer population | Block the stale write; load the newer population or save this one as a separate experiment |
| Storage unavailable | Keep the current/pending population available for inspection and export; training stops at the failed save barrier |
| Invalid import | Preserve existing saves and the active experiment; report the validation failure |
| Unsupported engine | Reject continuation/import rather than silently reinterpret numerical behavior |

Use **Export checkpoint** for a portable `.evolab` file and **Import checkpoint** to load one. Imports always create a new local save. File validation and compression run in a separate short-lived worker; live simulation buffers are not transferred or detached. An imported population continues from its recorded parameters and seed roots, preserving numerical identities within the supported runtime. The archived bookmark reflects the captured checkpoint/view, rather than promising recovery of unsaved active episodes.

The archive is ZIP with a strict version-1 manifest, a session JSON record, and explicit little-endian Float32 parameter files. Per-entry SHA-256 checksums, parameter hashes, dimensions, versions, finite values, settings, scenario hashes, and evaluation references are checked before creating the new save. Signed zeros and parameter bits survive round trips. Current population weights, seed roots, configuration, up to 1,000 generation summaries, retained champion replays, a bookmark, and runtime provenance are included. It is a checkpoint backup with partial ancestry; full lineage archives remain M8 work. The CLI's `.evo` JSON checkpoint envelope is a separate format and is not a browser ZIP archive.

Import limits are 32 MiB compressed, 64 MiB total expanded, 16 MiB for session JSON, 128 KiB for the manifest, and 1,024 entries. Parameter files must contain exactly 278 Float32 values (1,112 bytes). The reader limits actual streamed expansion independently of declared ZIP sizes, validates the end directory, and rejects duplicate/unrecognized paths, missing or unused records, unsupported versions, damaged checksums, and truncated binary data. Data files never supply executable code.

Runtime provenance records the original browser descriptor and later continuation descriptors. When descriptors differ, the workbench labels the continuation. Descriptors are useful provenance, not proof of identical hardware or math implementations. Cross-browser/device bit-identical evolution is not promised. Tests verify continuation in fresh contexts of the pinned Chromium runtime.

The version-1 IndexedDB schema uses experiment heads/revisions, full materialized checkpoints, normalized genomes and parameter blobs, population membership, scenarios, evaluation specifications, trial measurements, generation records, and the active-experiment pointer. Payload serialization/hashing and validation finish before entering the write transaction. All generation records, births, membership, and the next head commit together. The latest population and historical checkpoints every ten generations are retained; genotype and measurement records remain available for later history work. Current checkpoints are self-contained for recovery. Full birth weights are retained initially; mutation-patch compaction is M8 work.

The head revision is compared inside the transaction. Identical already-saved commits reconcile idempotently; a stale writer cannot replace newer progress. The worker stays at its commit barrier until saving succeeds. An interruption after database commit but before acknowledgment therefore recovers the saved next population, while an aborted transaction leaves the previous population intact. Library refresh latency does not block saving a subsequent fast generation.

Imports use a fresh local namespace and publish its experiment head/active pointer only in a completed transaction. An aborted import write exposes no partial experiment. Database/format versions are independent of the numerical engine version. No destructive database reset or speculative migration is performed on recovery errors. Browser storage can still be cleared or evicted, so exported checkpoints remain the independent backup route.

Verification:

- 45 engine/runtime/store/database/archive tests pass. Coverage includes transaction rollback, checksummed reload, idempotent retry after a lost response, stale revisions, queued saves, parameter-bit preservation, archive damage/limits, and final playback frame publication.
- 19 production Chromium browser tests pass under `/evo/`, including reload with identical next-generation identity, interrupted training, actual download/import into a fresh context, separate imported saves, invalid imports, injected IndexedDB write failure, retry, stale-tab protection, and export with storage disabled. Existing inspector, mobile, keyboard, and automated accessibility checks also pass.
- Typecheck, lint, and the production build pass. Broader browser/device acceptance remains release work; neither browser eviction nor OS power-loss durability has been established by these tests.
