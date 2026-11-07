import { memo, useMemo } from "react";
import type { DecisionTrace } from "../../core/episode";
import {
  connections,
  NEURONS,
  NODE_BY_ID,
  bias,
  type Connection,
} from "./network";
const fmt = (value: number | undefined) =>
  value === undefined ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
const Edges = memo(function Edges({ edges }: { edges: Connection[] }) {
  return (
    <g aria-hidden="true">
      {edges.map((edge) => {
        const a = NODE_BY_ID.get(edge.from)!,
          b = NODE_BY_ID.get(edge.to)!;
        return (
          <line
            key={edge.index}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={edge.weight < 0 ? "#b86d12" : "#3458d4"}
            strokeOpacity={Math.min(0.65, 0.1 + Math.abs(edge.weight) * 0.7)}
            strokeWidth={0.5 + Math.min(1, Math.abs(edge.weight))}
            strokeDasharray={edge.weight < 0 ? "3 2" : undefined}
          >
            <title>{`${edge.from} → ${edge.to}: ${edge.weight}`}</title>
          </line>
        );
      })}
    </g>
  );
});
export function Motors({ decision }: { decision: DecisionTrace | null }) {
  return (
    <div className="motor-pair">
      {["Left", "Right"].map((name, i) => {
        const value = decision?.outputs[i] ?? 0;
        return (
          <div className="motor-command" key={name}>
            <div>
              <span>{name} motor</span>
              <strong title={decision ? String(value) : "No decision yet"}>
                {decision ? fmt(value) : "—"}
              </strong>
            </div>
            <div
              className="signed-track"
              role="meter"
              aria-label={`${name} motor command`}
              aria-valuemin={-1}
              aria-valuemax={1}
              aria-valuenow={value}
            >
              <i
                style={{
                  left: `${value < 0 ? 50 - Math.abs(value) * 50 : 50}%`,
                  width: `${Math.abs(value) * 50}%`,
                  background: value < 0 ? "#b86d12" : "#3458d4",
                }}
              />
              <b />
            </div>
          </div>
        );
      })}
    </div>
  );
}
export function Brain({
  parameters,
  decision,
  focus,
  setFocus,
  threshold,
  setThreshold,
}: {
  parameters: Float32Array;
  decision: DecisionTrace | null;
  focus: string;
  setFocus: (value: string) => void;
  threshold: number;
  setThreshold: (value: number) => void;
}) {
  const edges = useMemo(() => connections(parameters), [parameters]),
    visible = useMemo(
      () =>
        edges.filter(
          (e) =>
            Math.abs(e.weight) >= threshold &&
            (!focus || e.from === focus || e.to === focus),
        ),
      [edges, focus, threshold],
    );
  const values = useMemo(
    () =>
      new Map(
        NEURONS.map((n) => [
          n.id,
          n.layer === "input"
            ? decision?.inputs[n.index]
            : n.layer === "hidden"
              ? decision?.hidden?.[n.index]
              : decision?.outputs[n.index],
        ]),
      ),
    [decision],
  );
  const selected = NODE_BY_ID.get(focus);
  return (
    <div className="brain-view">
      <div className="brain-controls">
        <label>
          Focus neuron
          <select
            aria-label="Focus neuron"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          >
            <option value="">All neurons</option>
            {NEURONS.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id} · {n.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Minimum weight magnitude <span>{threshold.toFixed(2)}</span>
          <input
            aria-label="Minimum weight magnitude"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="brain-columns">
        <span>20 observations</span>
        <span>12 hidden</span>
        <span>2 motors</span>
      </div>
      <svg
        className="brain-graph"
        viewBox="0 0 300 438"
        role="group"
        aria-label="Neural controller with 20 inputs, 12 hidden neurons and 2 outputs"
      >
        <Edges edges={visible} />
        {NEURONS.map((n) => {
          const value = values.get(n.id),
            negative = (value ?? 0) < 0,
            active = Math.abs(value ?? 0);
          return (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              aria-label={`${n.id}: ${n.label}`}
              aria-pressed={focus === n.id}
              data-activation={value ?? ""}
              onClick={() => setFocus(focus === n.id ? "" : n.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setFocus(focus === n.id ? "" : n.id);
                }
              }}
              className="neuron"
            >
              <title>{`${n.id} · ${n.label}\nActivation: ${value === undefined ? "No decision yet" : value}${n.layer === "input" ? "" : `\nBias: ${bias(parameters, n)}`}`}</title>
              <circle
                cx={n.x}
                cy={n.y}
                r={n.layer === "output" ? 8 : 6}
                fill={
                  active > 0.001 ? (negative ? "#f4d8b5" : "#a4b5f4") : "#fff"
                }
                fillOpacity={active > 0.001 ? 0.4 + active * 0.6 : 1}
                stroke={
                  focus === n.id ? "#14263d" : negative ? "#a45e0b" : "#3458d4"
                }
                strokeWidth={focus === n.id ? 2.5 : 1.1}
                strokeDasharray={negative ? "2 1" : undefined}
              />
              <text
                x={
                  n.layer === "input"
                    ? n.x - 11
                    : n.layer === "output"
                      ? n.x + 12
                      : n.x
                }
                y={n.y + (n.layer === "hidden" ? -10 : 3)}
                textAnchor={
                  n.layer === "input"
                    ? "end"
                    : n.layer === "output"
                      ? "start"
                      : "middle"
                }
              >
                {n.id}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="weight-legend">
        <span>━ Positive weight</span>
        <span>┄ Negative weight</span>
        <span>{visible.length} / 264 shown</span>
      </div>
      {selected ? (
        <p className="focused-value">
          <strong>{selected.id}</strong> activation{" "}
          <output
            data-testid="focused-activation"
            title={String(values.get(selected.id))}
          >
            {fmt(values.get(selected.id))}
          </output>
          {selected.layer !== "input" ? (
            <span>Bias {fmt(bias(parameters, selected)!)}</span>
          ) : null}
        </p>
      ) : (
        <p className="brain-hint">
          Select a neuron to follow its connections. Activity alone does not
          establish its function.
        </p>
      )}
      <Motors decision={decision} />
      <details className="inspector-details">
        <summary>Connection weights</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {[...visible]
                .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
                .slice(0, 12)
                .map((e) => (
                  <tr key={e.index}>
                    <td>{e.from}</td>
                    <td>{e.to}</td>
                    <td title={String(e.weight)}>{fmt(e.weight)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Largest 12 of the filtered connections. Dashes and signed values
          distinguish negative weights.
        </p>
      </details>
      <details className="inspector-details">
        <summary>Activation values</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Neuron</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {NEURONS.map((n) => (
                <tr key={n.id}>
                  <td>
                    {n.id} · {n.label}
                  </td>
                  <td title={String(values.get(n.id))}>
                    {fmt(values.get(n.id))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details className="inspector-details">
        <summary>Bias values</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Neuron</th>
                <th>Bias</th>
              </tr>
            </thead>
            <tbody>
              {NEURONS.filter((n) => n.layer !== "input").map((n) => (
                <tr key={n.id}>
                  <td>{n.id}</td>
                  <td title={String(bias(parameters, n))}>
                    {fmt(bias(parameters, n)!)}
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
