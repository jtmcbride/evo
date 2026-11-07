import { useState } from "react";
import { useView } from "../hooks";
import type { WorkbenchStore } from "../store";
export function Training({ store }: { store: WorkbenchStore }) {
  const v = useView(store),
    [batch, setBatch] = useState(10),
    status = v.status,
    latest = v.history.at(-1);
  return (
    <section className="training-strip" aria-label="Training controls">
      <div>
        <span className="eyebrow">{v.name ?? "New experiment"}</span>
        <div className="training-state">
          <span
            className={status?.training ? "status-dot active" : "status-dot"}
          />
          {status?.training
            ? "Training"
            : status?.phase === "awaitingCommit"
              ? "Accepting generation"
              : v.definition
                ? "Training paused"
                : "Ready to explore"}
        </div>
      </div>
      <div className="training-metric">
        <span>Completed</span>
        <strong>
          {status?.generation ?? 0}
          <small> generations</small>
        </strong>
      </div>
      <div className="training-metric">
        <span>Latest best</span>
        <strong>
          {latest ? latest.best.toFixed(2) : "—"}
          <small> food / trial</small>
        </strong>
      </div>
      <div className="training-actions">
        <label>
          Generations
          <input
            aria-label="Generations to train"
            type="number"
            min={1}
            max={100}
            value={batch}
            onChange={(e) => setBatch(Number(e.target.value))}
          />
        </label>
        <button
          className={status?.training ? "secondary" : "primary"}
          disabled={
            !v.definition ||
            v.initializing ||
            v.failed ||
            v.storage.blocked ||
            v.storage.state === "saving" ||
            (!status?.training && v.storage.archiveBusy) ||
            !Number.isInteger(batch) ||
            batch < 1 ||
            batch > 100
          }
          onClick={() =>
            void (status?.training ? store.pauseTraining() : store.train(batch))
          }
        >
          {status?.training
            ? "Pause training"
            : `Train ${batch} generation${batch === 1 ? "" : "s"}`}
        </button>
      </div>
      <div className="training-progress">
        <progress
          aria-label="Generation trial progress"
          max={Math.max(1, status?.totalTrials ?? 1)}
          value={status?.completedTrials ?? 0}
        />
        <span>
          {status?.totalTrials
            ? `${status.completedTrials} / ${status.totalTrials} trials`
            : v.definition
              ? "Each genome gets independent worlds."
              : "Create an experiment to begin."}
        </span>
      </div>
    </section>
  );
}
