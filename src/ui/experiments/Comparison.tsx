import { memo, useState } from "react";
import type { ComparisonArm, SensorComparison } from "../../core/comparison";
import type { WorkbenchStore } from "../store";
import { useView, useInspection } from "../hooks";
import { INPUT_LABELS } from "../inspector/network";

function Trajectory({
  record,
  arm,
  label,
}: {
  record: SensorComparison;
  arm: ComparisonArm;
  label: string;
}) {
  const s = record.source.definition.scenario,
    first = arm.trajectory[0],
    last = arm.trajectory.at(-1)!;
  return (
    <figure className="comparison-trajectory">
      <figcaption>
        {label}
        <span>
          {arm.result.foodCollected} food · {arm.result.terminalReason}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${s.config.width} ${s.config.height}`}
        role="img"
        aria-label={`${label} trajectory from tick ${record.intervention.startTick} to ${last.tick}`}
      >
        {s.obstacles.map((o) => (
          <rect
            key={o.id}
            x={o.x}
            y={o.y}
            width={o.width}
            height={o.height}
            className="comparison-obstacle"
          />
        ))}
        {s.food
          .filter((_, i) => record.source.state.remaining[i])
          .map((f) => (
            <circle
              key={f.id}
              cx={f.x}
              cy={f.y}
              r={s.config.foodRadius}
              className="comparison-food"
            />
          ))}
        <polyline
          points={arm.trajectory.map((p) => `${p.x},${p.y}`).join(" ")}
          className="comparison-path"
        />
        <circle
          cx={first.x}
          cy={first.y}
          r={s.config.bodyRadius}
          className="comparison-start"
        />
        <circle
          cx={last.x}
          cy={last.y}
          r={s.config.bodyRadius}
          className="comparison-end"
        />
      </svg>
    </figure>
  );
}
const number = (v: number) => v.toFixed(4);
function Outcomes({ record }: { record: SensorComparison }) {
  const a = record.control,
    b = record.masked,
    channel = record.intervention.channel;
  const metrics: [string, number, number][] = [
    ["Food collected", a.result.foodCollected, b.result.foodCollected],
    ["Distance", a.result.distanceTravelled, b.result.distanceTravelled],
    [
      "Contact time (s)",
      a.result.contactTicks / 30,
      b.result.contactTicks / 30,
    ],
    ["Survival (s)", a.result.survivalTicks / 30, b.result.survivalTicks / 30],
    ["Energy remaining", a.result.remainingEnergy, b.result.remainingEnergy],
  ];
  return (
    <div className="comparison-outcomes" data-comparison-id={record.id}>
      <p className="comparison-context">
        Controller <code>{record.source.definition.controller.id}</code> ·
        scenario{" "}
        <code title={record.source.definition.scenario.hash}>
          {record.source.definition.scenario.hash.slice(0, 12)}
        </code>
        <br />
        Requested at tick <strong>{record.source.state.tick}</strong>; mask
        begins at decision{" "}
        <strong data-testid="comparison-start-tick">
          {record.intervention.startTick}
        </strong>{" "}
        and stays active for the rest of this episode.
      </p>
      <div className="comparison-paths">
        <Trajectory
          record={record}
          arm={a}
          label="Control · original observations"
        />
        <Trajectory
          record={record}
          arm={b}
          label={`Masked · ${INPUT_LABELS[channel]}`}
        />
      </div>
      <p className="comparison-legend">
        Hollow circle: matched start. Filled circle: endpoint. Paths sampled
        every three physics ticks; dots show food present at the requested tick.
      </p>
      <div className="comparison-tables">
        <div className="comparison-table-scroll" tabIndex={0}>
          <table aria-label="Comparison outcomes">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Control</th>
                <th scope="col">Masked</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(([label, control, masked]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{number(control)}</td>
                  <td>{number(masked)}</td>
                  <td>{number(masked - control)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p>
            <strong>
              {record.actionDifferences.changed} of{" "}
              {record.actionDifferences.compared}
            </strong>{" "}
            overlapping decisions produced different motor commands.
          </p>
          <p>First affected decision · tick {a.firstDecision.tick}</p>
          <table aria-label="First affected motor commands">
            <thead>
              <tr>
                <th scope="col">Motor</th>
                <th scope="col">Control</th>
                <th scope="col">Masked</th>
              </tr>
            </thead>
            <tbody>
              {["Left", "Right"].map((label, i) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{number(a.firstDecision.outputs[i])}</td>
                  <td>{number(b.firstDecision.outputs[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="comparison-mask-value">
        {INPUT_LABELS[channel]} at decision {record.intervention.startTick}: raw{" "}
        <strong data-testid="comparison-raw">
          {number(b.firstDecision.rawInputs![channel])}
        </strong>{" "}
        → effective{" "}
        <strong data-testid="comparison-effective">
          {number(b.firstDecision.inputs[channel])}
        </strong>
        .
      </p>
      <details>
        <summary>All observations at the first affected decision</summary>
        <div className="comparison-table-scroll" tabIndex={0}>
          <table aria-label="Raw and effective comparison observations">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Control</th>
                <th scope="col">Masked raw</th>
                <th scope="col">Masked effective</th>
              </tr>
            </thead>
            <tbody>
              {INPUT_LABELS.map((label, i) => (
                <tr
                  key={label}
                  className={i === channel ? "masked-row" : undefined}
                >
                  <th scope="row">
                    {i} · {label}
                  </th>
                  <td>{number(a.firstDecision.inputs[i])}</td>
                  <td>{number(b.firstDecision.rawInputs![i])}</td>
                  <td>{number(b.firstDecision.inputs[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="comparison-caveat">
        This measures the effect of masking one input in this controller and
        scenario. A zero value or unchanged outcome here does not establish a
        sensor’s role in other episodes. Both arms include the same episode
        prefix in their totals.
      </p>
    </div>
  );
}
const MemoOutcomes = memo(Outcomes);
export function Comparison({ store }: { store: WorkbenchStore }) {
  const v = useView(store),
    frame = useInspection(store),
    [channel, setChannel] = useState(16);
  const record = v.comparisons.find((c) => c.id === v.comparisonId),
    tick = frame?.state.tick ?? 0;
  const canRun =
    !!v.selection &&
    !!frame &&
    !v.loadingPlayback &&
    !v.initializing &&
    !v.failed &&
    !v.status?.playing &&
    !v.status?.seeking &&
    !frame.state.terminal &&
    !v.comparing;
  return (
    <section
      className="panel comparison-panel"
      aria-labelledby="comparison-heading"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Matched replay · evaluation only</span>
          <h2 id="comparison-heading">Sensor intervention</h2>
        </div>
      </div>
      <p>
        Pause a trial and mask one input to zero. Two private copies start from
        the same body, food, energy and controller state. Training continues
        with the original controllers.
      </p>
      <div className="comparison-controls">
        <label>
          Sensor to mask
          <select
            aria-label="Sensor to mask"
            value={channel}
            onChange={(e) => setChannel(Number(e.target.value))}
            disabled={v.comparing}
          >
            {INPUT_LABELS.map((label, i) => (
              <option key={label} value={i}>
                {i} · {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={!canRun}
          onClick={() => void store.compareSensor(channel)}
        >
          {v.comparing ? "Comparing…" : "Run matched comparison"}
        </button>
        <span className="comparison-timing">
          {v.status?.playing
            ? "Pause the trial to choose a starting tick."
            : frame?.state.terminal
              ? "Seek to a tick before the episode ends."
              : `Paused tick ${tick} → decision ${Math.ceil(tick / 3) * 3}`}
        </span>
      </div>
      <p role="status" className="comparison-status">
        {v.comparisonNotice ??
          (v.comparisons.length
            ? `${v.comparisons.length} saved comparison${v.comparisons.length === 1 ? "" : "s"} restored.`
            : "Comparisons save with this experiment and are included in checkpoint exports.")}
      </p>
      {v.comparisonUnsaved && (
        <button
          disabled={v.comparing}
          onClick={() => void store.retryComparisons()}
        >
          Retry comparison save
        </button>
      )}
      {record && (
        <>
          <div className="comparison-controls comparison-saved">
            <label>
              Saved comparison
              <select
                aria-label="Saved comparison"
                value={record.id}
                onChange={(e) => store.selectComparison(e.target.value)}
              >
                {v.comparisons.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {i + 1} · {INPUT_LABELS[c.intervention.channel]} · decision{" "}
                    {c.intervention.startTick} ·{" "}
                    {c.source.definition.controller.id.slice(-8)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={v.comparing || v.initializing || v.failed}
              onClick={() =>
                void store.compareSensor(record.intervention.channel, record)
              }
            >
              Replay saved comparison
            </button>
          </div>
          <MemoOutcomes record={record} />
        </>
      )}
    </section>
  );
}
