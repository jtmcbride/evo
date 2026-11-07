import { useState } from "react";
import type { WorkbenchStore } from "../store";
import { useView } from "../hooks";
import {
  fetchExampleArchive,
  fetchExampleManifest,
  type ExampleManifest,
} from "../../release/catalog";

export function Examples({ store }: { store: WorkbenchStore }) {
  const view = useView(store),
    [catalog, setCatalog] = useState<ExampleManifest | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const load = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setCatalog(await fetchExampleManifest());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = async (example: ExampleManifest["examples"][number]) => {
    const source = store.getView();
    setBusy(true);
    setError(null);
    try {
      const file = await fetchExampleArchive(example);
      const current = store.getView();
      if (
        current.status?.training ||
        current.initializing ||
        current.failed ||
        current.storage.archiveBusy ||
        current.storage.state === "saving" ||
        current.storage.id !== source.storage.id ||
        current.status?.generation !== source.status?.generation
      )
        throw new Error(
          "The experiment changed while the example downloaded. Pause training and open the example again.",
        );
      await store.importFile(file);
      if (store.getView().error) throw new Error(store.getView().error!);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const disabled =
    busy ||
    !view.ready ||
    view.initializing ||
    view.storage.archiveBusy ||
    view.storage.state === "saving" ||
    !!view.status?.training ||
    view.failed;
  return (
    <details
      className="example-library panel"
      onToggle={(event) => {
        if (event.currentTarget.open && !catalog && !busy && !error)
          void load();
      }}
    >
      <summary>Previously generated examples</summary>
      <p>
        Open an existing controller to inspect its behavior. Each example
        becomes a separate local save. Your current saved experiments stay
        available above.
      </p>
      {catalog && (
        <>
          <p className="example-provenance">
            Run {catalog.run} of 20 · {catalog.selectionRule}. Both controllers
            use the same fixed validation map. Training ran in Node; replay
            records were generated in Chromium. Other runtimes may produce
            different trajectories.
          </p>
          <div className="example-cards">
            {catalog.examples.map((example) => (
              <article key={example.id}>
                <span className="eyebrow">
                  Previously generated · generation {example.generation}
                </span>
                <h2>{example.title}</h2>
                <p>{example.description}</p>
                <p>
                  <strong>{example.validationMean.toFixed(2)}</strong> mean food
                  / validation trial
                </p>
                <button disabled={disabled} onClick={() => void open(example)}>
                  Open {example.id === "initial" ? "initial" : "evolved"}{" "}
                  example
                </button>
              </article>
            ))}
          </div>
          <a
            href="https://github.com/jtmcbride/evo/blob/main/docs/benchmarks/benchmark-open-v1.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the full benchmark and its limits ↗
          </a>
        </>
      )}
      {busy && <p role="status">Loading example…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button disabled={busy} onClick={() => void load()}>
            Reload example catalog
          </button>
        </div>
      )}
    </details>
  );
}
