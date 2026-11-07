import { useState } from "react";
import { useView, useInspection } from "../hooks";
import type { WorkbenchStore } from "../store";
import { Brain } from "./Brain";
import { Sensors } from "./Sensors";
export function Inspector({ store }: { store: WorkbenchStore }) {
  const v = useView(store),
    frame = useInspection(store),
    [tab, setTab] = useState<"brain" | "sensors" | "measurements">("brain"),
    selection = v.selection;
  const [focus, setFocus] = useState(""),
    [threshold, setThreshold] = useState(0.1);
  const state = frame?.state;
  return (
    <aside className="panel inspector-panel" id="inspector-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Selected controller</span>
          <h2 id="inspector-heading" tabIndex={-1}>
            Brain & observations
          </h2>
        </div>
        <span className="brain-schema">20·12·2</span>
      </div>
      <p className="inspector-context" title={selection?.genome.id}>
        {selection?.label ?? "Create an experiment and select a controller."}
      </p>
      <div className="decision-stamp" aria-label="Observation timing">
        Decision {frame?.decision?.tick ?? "—"}{" "}
        <span>Body tick {frame?.state.tick ?? 0}</span>
      </div>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Agent inspection"
      >
        {(["brain", "sensors", "measurements"] as const).map((id) => (
          <button
            key={id}
            id={`tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`inspection-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(e) => {
              const tabs = ["brain", "sensors", "measurements"] as const;
              const index = tabs.indexOf(tab);
              const next =
                e.key === "ArrowRight"
                  ? tabs[(index + 1) % 3]
                  : e.key === "ArrowLeft"
                    ? tabs[(index + 2) % 3]
                    : e.key === "Home"
                      ? tabs[0]
                      : e.key === "End"
                        ? tabs[2]
                        : null;
              if (next) {
                e.preventDefault();
                setTab(next);
                requestAnimationFrame(() =>
                  document.getElementById(`tab-${next}`)?.focus(),
                );
              }
            }}
            onClick={() => setTab(id)}
          >
            {id === "brain"
              ? "Brain"
              : id === "sensors"
                ? "Sensors"
                : "Measures"}
          </button>
        ))}
      </div>
      {(["brain", "sensors", "measurements"] as const)
        .filter((id) => id !== tab)
        .map((id) => (
          <div
            key={id}
            role="tabpanel"
            hidden
            id={`inspection-${id}`}
            aria-labelledby={`tab-${id}`}
          />
        ))}
      <div
        role="tabpanel"
        id={`inspection-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {!selection ? (
          <p className="inspector-empty">
            Create an experiment to inspect the observations, neural activity,
            and motor commands of its first controller.
          </p>
        ) : tab === "brain" ? (
          <Brain
            key={selection.genome.id}
            parameters={selection.genome.parameters}
            decision={frame?.decision ?? null}
            focus={focus}
            setFocus={setFocus}
            threshold={threshold}
            setThreshold={setThreshold}
          />
        ) : tab === "sensors" ? (
          <Sensors decision={frame?.decision ?? null} />
        ) : (
          <div className="measurement-view">
            <p className="inspector-description">
              Current body state at tick {state?.tick ?? 0}. Observation inputs
              belong to the separate decision tick above.
            </p>
            <dl className="measurements">
              <div>
                <dt>Food collected</dt>
                <dd>{state?.foodCollected ?? 0}</dd>
              </div>
              <div>
                <dt>Energy</dt>
                <dd>
                  {state?.energy.toFixed(3) ?? "—"} /{" "}
                  {selection.scenario.config.maxEnergy}
                </dd>
              </div>
              <div>
                <dt>Distance</dt>
                <dd>{state?.distanceTravelled.toFixed(3) ?? "—"} units</dd>
              </div>
              <div>
                <dt>Contact time</dt>
                <dd>{((state?.contactTicks ?? 0) / 30).toFixed(3)} s</dd>
              </div>
              <div>
                <dt>Survival time</dt>
                <dd>{((state?.tick ?? 0) / 30).toFixed(3)} s</dd>
              </div>
              <div>
                <dt>Signed speed</dt>
                <dd>{state?.speed.toFixed(3) ?? "—"} units / s</dd>
              </div>
              <div>
                <dt>Angular speed</dt>
                <dd>{state?.angularSpeed.toFixed(3) ?? "—"} rad / s</dd>
              </div>
              <div>
                <dt>Recorded trial food</dt>
                <dd>
                  {selection.recordedResult?.foodCollected ??
                    "Unscored preview"}
                </dd>
              </div>
              <div>
                <dt>Replay result</dt>
                <dd>
                  {frame?.result
                    ? `${frame.result.foodCollected} food`
                    : "Episode in progress"}
                </dd>
              </div>
            </dl>
            <div className="provenance">
              <span className="eyebrow">Evaluation conditions</span>
              <p>
                Generation {selection.generation} · trial {selection.trial + 1}
              </p>
              <p>Objective: food collected</p>
              <p>
                World{" "}
                <code title={selection.scenario.hash}>
                  {selection.scenario.hash.slice(0, 12)}
                </code>
              </p>
              <p>
                Controller{" "}
                <code title={selection.genome.parameterHash}>
                  {selection.genome.parameterHash.slice(0, 12)}
                </code>
              </p>
              <p className="small muted">
                Weights remain fixed throughout this episode. Food, contact
                time, and distance are reported separately.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
