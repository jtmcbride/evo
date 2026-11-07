import { memo, useState } from "react";
import type { SensorComparison } from "../../core/comparison";
import type { WorkbenchStore } from "../store";
import { useView, useInspection } from "../hooks";
import { INPUT_LABELS } from "../inspector/network";
import { Trajectory } from "../arena/Trajectory";
import type { Intervention } from "../../core/model";
const label = (v: Intervention) =>
  v.kind === "sensorMask"
    ? INPUT_LABELS[v.channel]
    : v.kind === "hiddenClamp"
      ? `H${v.neuron} clamped to ${v.value}`
      : `Parameter ${v.parameter} restored from parent`;

const number = (v: number) => v.toFixed(4);
const exact = (v: number) => (Object.is(v, -0) ? "−0" : String(v));
function Outcomes({ record }: { record: SensorComparison }) {
  const a = record.control,
    b = record.masked,
    variant = record.intervention,
    channel = variant.kind === "sensorMask" ? variant.channel : -1;
  const raw =
    variant.kind === "sensorMask"
      ? b.firstDecision.rawInputs![channel]
      : variant.kind === "hiddenClamp"
        ? b.firstDecision.rawHidden![variant.neuron]
        : record.restoration!.child.parameters[variant.parameter];
  const effective =
    variant.kind === "sensorMask"
      ? b.firstDecision.inputs[channel]
      : variant.kind === "hiddenClamp"
        ? b.firstDecision.hidden![variant.neuron]
        : variant.value;
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
        Requested at tick <strong>{record.source.state.tick}</strong>;
        intervention begins at decision{" "}
        <strong data-testid="comparison-start-tick">
          {record.intervention.startTick}
        </strong>{" "}
        and stays active for the rest of this episode.
      </p>
      <div className="comparison-paths">
        <Trajectory
          scenario={record.source.definition.scenario}
          remaining={record.source.state.remaining}
          arm={a}
          label="Control · original observations"
        />
        <Trajectory
          scenario={record.source.definition.scenario}
          remaining={record.source.state.remaining}
          arm={b}
          label={`Modified · ${label(variant)}`}
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
                <th scope="col">Modified</th>
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
                <th scope="col">Modified</th>
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
        {label(variant)} at decision {record.intervention.startTick}: raw{" "}
        <strong data-testid="comparison-raw">{number(raw)}</strong> → effective{" "}
        <strong data-testid="comparison-effective">{number(effective)}</strong>.
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
                  <td>
                    {number(
                      (b.firstDecision.rawInputs ?? b.firstDecision.inputs)[i],
                    )}
                  </td>
                  <td>{number(b.firstDecision.inputs[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {variant.kind === "hiddenClamp" && (
        <details>
          <summary>Raw and effective hidden activations</summary>
          <div className="comparison-table-scroll" tabIndex={0}>
            <table aria-label="Clamped hidden activations">
              <thead>
                <tr>
                  <th scope="col">Neuron</th>
                  <th scope="col">Raw post-tanh</th>
                  <th scope="col">Effective</th>
                </tr>
              </thead>
              <tbody>
                {b.firstDecision.hidden!.map((v, i) => (
                  <tr key={i}>
                    <th scope="row">H{i}</th>
                    <td>{number(b.firstDecision.rawHidden![i])}</td>
                    <td>{number(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {variant.kind === "parentWeight" && (
        <p className="comparison-context">
          Parameter {variant.parameter}: child {exact(raw)} → parent{" "}
          {exact(variant.value)}. Parent <code>{variant.parentId}</code> ·
          weights <code>{variant.parentParameterHash}</code>. The saved child
          genome is unchanged.
        </p>
      )}
      <p className="comparison-caveat">
        This measures one intervention in this controller and scenario. An
        unchanged outcome here does not establish a sensor or neuron's role in
        other episodes. Both arms include the same episode prefix in their
        totals.
      </p>
    </div>
  );
}
const MemoOutcomes = memo(Outcomes);
export function Comparison({ store }: { store: WorkbenchStore }) {
  const v = useView(store),
    frame = useInspection(store),
    [channel, setChannel] = useState(16);
  const [kind, setKind] = useState<
      "sensorMask" | "hiddenClamp" | "parentWeight"
    >("sensorMask"),
    [neuron, setNeuron] = useState(0),
    [clamp, setClamp] = useState(0),
    [parameter, setParameter] = useState(0);
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
    !v.comparing &&
    !v.matrixComparing &&
    !v.lineageComparing;
  return (
    <section
      className="panel comparison-panel"
      aria-labelledby="comparison-heading"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Matched replay · evaluation only</span>
          <h2 id="comparison-heading">Sensor & brain interventions</h2>
        </div>
      </div>
      <p>
        Pause a trial to mask one input, clamp a hidden activation after tanh,
        or restore one parent weight. Two private copies start from the same
        body, food, energy and controller state. Training continues with the
        original controllers.
      </p>
      <div className="comparison-controls">
        <label>
          Intervention
          <select
            aria-label="Intervention type"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            disabled={v.comparing}
          >
            <option value="sensorMask">Sensor mask</option>
            <option value="hiddenClamp">Hidden neuron clamp</option>
            <option
              value="parentWeight"
              disabled={!v.selection?.genome.parentIds.length}
            >
              Restore parent weight
            </option>
          </select>
        </label>
        {kind === "sensorMask" && (
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
        )}
        {kind === "hiddenClamp" && (
          <>
            <label>
              Hidden neuron
              <select
                aria-label="Hidden neuron to clamp"
                value={neuron}
                onChange={(e) => setNeuron(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>
                    H{i}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Clamped activation
              <input
                aria-label="Clamped activation"
                type="number"
                min={-1}
                max={1}
                step={0.1}
                value={clamp}
                onChange={(e) => setClamp(Number(e.target.value))}
              />
            </label>
          </>
        )}
        {kind === "parentWeight" && (
          <label>
            Parameter to restore
            <input
              aria-label="Parameter to restore"
              type="number"
              min={0}
              max={277}
              value={parameter}
              onChange={(e) => setParameter(Number(e.target.value))}
            />
          </label>
        )}
        <button
          className="primary"
          disabled={
            !canRun ||
            (kind === "hiddenClamp" &&
              (!Number.isFinite(clamp) || Math.abs(clamp) > 1)) ||
            (kind === "parentWeight" &&
              (!Number.isInteger(parameter) ||
                parameter < 0 ||
                parameter > 277))
          }
          onClick={() =>
            void store.compareSensor(
              channel,
              undefined,
              kind === "hiddenClamp"
                ? { kind, neuron, value: clamp }
                : kind === "parentWeight"
                  ? { kind, parameter }
                  : undefined,
            )
          }
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
                    {i + 1} · {label(c.intervention)} · decision{" "}
                    {c.intervention.startTick} ·{" "}
                    {c.source.definition.controller.id.slice(-8)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={
                v.comparing ||
                v.lineageComparing ||
                v.matrixComparing ||
                v.initializing ||
                v.failed
              }
              onClick={() => void store.compareSensor(0, record)}
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
