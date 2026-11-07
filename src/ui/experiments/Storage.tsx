import { useView } from "../hooks";
import type { WorkbenchStore } from "../store";
import { ENGINE_VERSION } from "../../core/model";
export function Storage({ store }: { store: WorkbenchStore }) {
  const v = useView(store),
    s = v.storage,
    busy = !v.ready || v.initializing || s.state === "saving" || s.archiveBusy;
  return (
    <section className="storage-bar" aria-label="Experiment storage">
      <div className="save-status" role="status">
        <strong>
          {s.state === "opening"
            ? "Opening saved experiments…"
            : s.state === "saving"
              ? "Saving population…"
              : s.state === "saved"
                ? `Saved population ${v.status?.generation ?? 0}`
                : s.state === "conflict"
                  ? "Newer save detected"
                  : s.state === "error"
                    ? "Save needs attention"
                    : "No saved experiment selected"}
        </strong>
        <span>
          {s.state === "saved"
            ? "Saved in this browser. Export a checkpoint for a portable backup."
            : (s.notice ?? "Completed generations are saved automatically.")}
        </span>
      </div>
      <label>
        Saved experiments
        <select
          aria-label="Saved experiments"
          value={s.id ?? ""}
          disabled={busy || !!v.status?.training}
          onChange={(e) => {
            if (e.target.value) void store.loadSaved(e.target.value);
          }}
        >
          <option value="">Choose an experiment</option>
          {s.entries.map((entry) => (
            <option
              key={entry.id}
              value={entry.id}
              disabled={entry.engineVersion !== ENGINE_VERSION}
            >
              {entry.name} · population {entry.generation}
              {entry.engineVersion !== ENGINE_VERSION
                ? " · incompatible engine"
                : ""}
            </option>
          ))}
        </select>
      </label>
      {s.notice ? <p className="storage-notice">{s.notice}</p> : null}
      {(s.state === "error" || s.state === "conflict") && v.definition ? (
        <div className="storage-recovery">
          <button disabled={busy} onClick={() => void store.retrySave()}>
            Retry save
          </button>
          {s.id ? (
            <button disabled={busy} onClick={() => void store.loadSaved(s.id!)}>
              Load saved population
            </button>
          ) : null}
          <button disabled={busy} onClick={() => void store.saveSeparate()}>
            Save as separate experiment
          </button>
          <p>
            The pending population stays in memory until it is saved or replaced
            by loading another experiment.
          </p>
        </div>
      ) : null}
    </section>
  );
}
