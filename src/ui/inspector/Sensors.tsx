import type { DecisionTrace } from "../../core/episode";
import { DIRECTIONS, INPUT_LABELS } from "./network";
import { Motors } from "./Brain";
function Proximity({
  value,
  label,
}: {
  value: number | undefined;
  label: string;
}) {
  return (
    <div className="sensor-reading">
      <div
        className="sensor-meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={value ?? 0}
      >
        <i style={{ width: `${(value ?? 0) * 100}%` }} />
      </div>
      <output title={String(value)}>
        {value === undefined ? "—" : value.toFixed(3)}
      </output>
    </div>
  );
}
export function Sensors({ decision }: { decision: DecisionTrace | null }) {
  return (
    <div className="sensors-view">
      <p className="inspector-description">
        Observations at decision {decision?.tick ?? "—"}. Larger proximity
        readings mean closer objects. Directions turn with the agent.
      </p>
      <div className="sensor-grid-head">
        <span>Direction</span>
        <span>Food</span>
        <span>Obstacle</span>
      </div>
      {DIRECTIONS.map((direction, i) => (
        <div className="sensor-row" key={direction}>
          <span>{direction}</span>
          <Proximity
            label={`Food ${direction.toLowerCase()} proximity`}
            value={decision?.inputs[i]}
          />
          <Proximity
            label={`Obstacle ${direction.toLowerCase()} proximity`}
            value={decision?.inputs[8 + i]}
          />
        </div>
      ))}
      <dl className="sensor-state">
        {INPUT_LABELS.slice(16).map((label, i) => (
          <div key={label}>
            <dt>
              I{16 + i} · {label}
            </dt>
            <dd title={String(decision?.inputs[16 + i])}>
              {decision ? decision.inputs[16 + i].toFixed(4) : "—"}
            </dd>
          </div>
        ))}
      </dl>
      <Motors decision={decision} />
      <details className="inspector-details">
        <summary>All 20 input values</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Observation</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {INPUT_LABELS.map((label, i) => (
                <tr key={i}>
                  <td>I{i}</td>
                  <td>{label}</td>
                  <td
                    data-testid={`input-${i}`}
                    data-value={decision?.inputs[i] ?? ""}
                    title={String(decision?.inputs[i])}
                  >
                    {decision ? decision.inputs[i].toFixed(6) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
