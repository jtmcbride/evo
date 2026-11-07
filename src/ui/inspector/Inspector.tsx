import { useView, useInspection } from "../hooks";
import type { WorkbenchStore } from "../store";
export function Inspector({ store }: { store: WorkbenchStore }) {
  const v = useView(store),
    frame = useInspection(store);
  return (
    <aside className="panel inspector-panel" id="inspector-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Selected controller</span>
          <h2 id="inspector-heading" tabIndex={-1}>
            Brain & observations
          </h2>
        </div>
      </div>
      <p className="inspector-context">
        {v.selection?.label ?? "Create an experiment and select a controller."}
      </p>
      <div className="decision-stamp">
        Decision {frame?.decision?.tick ?? "—"}{" "}
        <span>Body tick {frame?.state.tick ?? 0}</span>
      </div>
      <p className="muted">
        Controller inspection is being assembled. Exact decision readings are
        already available through playback.
      </p>
      <dl className="measurements">
        <div>
          <dt>Food collected</dt>
          <dd>{frame?.state.foodCollected ?? 0}</dd>
        </div>
        <div>
          <dt>Energy</dt>
          <dd>{frame?.state.energy.toFixed(2) ?? "—"}</dd>
        </div>
      </dl>
    </aside>
  );
}
