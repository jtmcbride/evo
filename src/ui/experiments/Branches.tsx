import { memo, useState } from "react";
import { useView } from "../hooks";
import type { WorkbenchStore } from "../store";
import { configDiff } from "../../core/branch";
import { validateDefinition } from "../../core/evolution";
import type { BranchMatrix } from "../../core/branch/matrix";
import { ENGINE_VERSION } from "../../core/model";
const settingName = (key: string) =>
  (
    ({
      foodCount: "Food count",
      obstacleCount: "Obstacle count",
      bodyRadius: "Body radius",
      sensorRange: "Sensor range",
      vMax: "Maximum speed",
      mutationProbability: "Mutation probability",
      mutationSigma: "Mutation magnitude",
    }) as Record<string, string>
  )[key] ?? key;

const Matrix = memo(function Matrix({ matrix }: { matrix: BranchMatrix }) {
  return (
    <div
      className="branch-matrix"
      data-testid="branch-matrix"
      data-matrix-id={matrix.id}
    >
      <p className="branch-scroll-hint">
        Scroll horizontally to view both environment columns.
      </p>
      <div className="branch-table-scroll" tabIndex={0}>
        <table aria-label="Champion environment matrix">
          <thead>
            <tr>
              <th scope="col">Training-selected champion</th>
              {matrix.suites.map((s, i) => (
                <th key={i} scope="col">
                  {s.label}
                  <small>
                    {s.scenarios.length} maps · suite {s.id.slice(0, 12)}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.controllers.map((c, row) => (
              <tr key={row}>
                <th scope="row">
                  {c.name}
                  <small>
                    Selected at generation {c.generation}
                    <br />
                    <code>{c.genome.id}</code>
                  </small>
                </th>
                {matrix.suites.map((s, column) => {
                  const cell = matrix.cells.find(
                      (v) => v.controller === row && v.suite === column,
                    )!,
                    mean =
                      cell.results.reduce(
                        (sum, r) => sum + r.foodCollected,
                        0,
                      ) / cell.results.length;
                  return (
                    <td
                      key={column}
                      data-suite-id={s.id}
                      data-controller-id={c.genome.id}
                    >
                      <strong>{mean.toFixed(4)}</strong> mean food
                      <small>
                        {(
                          cell.results.reduce(
                            (sum, r) => sum + r.contactTicks,
                            0,
                          ) /
                          cell.results.length /
                          30
                        ).toFixed(3)}{" "}
                        s mean contact
                        <br />
                        {(
                          cell.results.reduce(
                            (sum, r) => sum + r.survivalTicks,
                            0,
                          ) /
                          cell.results.length /
                          30
                        ).toFixed(3)}{" "}
                        s mean survival
                      </small>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="branch-caption">
        Each column uses exactly the same realized maps for both controllers.
        Selection scores are not reused. These are exploratory comparisons; the
        displayed generation identifies each controller’s training budget.
      </p>
      <details>
        <summary>Recorded environments and cell trials</summary>
        {matrix.suites.map((s, index) => {
          const world = s.scenarios[0].config;
          return (
            <div key={index}>
              <h4>{s.label}</h4>
              <p className="branch-caption">
                Food {world.foodCount} · obstacles {world.obstacleCount} · body
                radius {world.bodyRadius} · sensor range {world.sensorRange} ·
                speed {world.vMax}
              </p>
              <div className="branch-table-scroll" tabIndex={0}>
                <table aria-label={`${s.label} cell trials`}>
                  <thead>
                    <tr>
                      <th scope="col">Map hash</th>
                      {matrix.controllers.map((c, i) => (
                        <th key={i} scope="col">
                          {c.name} food
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.scenarios.map((scene, trial) => (
                      <tr key={scene.hash}>
                        <th scope="row">
                          <code title={scene.hash}>
                            {scene.hash.slice(0, 20)}
                          </code>
                        </th>
                        {matrix.controllers.map((_, row) => (
                          <td
                            key={row}
                            title={
                              matrix.cells.find(
                                (c) =>
                                  c.controller === row && c.suite === index,
                              )!.results[trial].spec.hash
                            }
                          >
                            {
                              matrix.cells.find(
                                (c) =>
                                  c.controller === row && c.suite === index,
                              )!.results[trial].foodCollected
                            }
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </details>
    </div>
  );
});
function BranchPanel({ store }: { store: WorkbenchStore }) {
  const v = useView(store),
    definition = v.definition,
    origin = v.branchOrigins.at(-1);
  const [name, setName] = useState(
      `${(v.name ?? "Foraging").slice(0, 50)} branch`,
    ),
    [food, setFood] = useState(definition?.world.foodCount ?? 48),
    [obstacles, setObstacles] = useState(definition?.world.obstacleCount ?? 0),
    [radius, setRadius] = useState(definition?.world.bodyRadius ?? 8),
    [range, setRange] = useState(definition?.world.sensorRange ?? 140),
    [speed, setSpeed] = useState(definition?.world.vMax ?? 90),
    [probability, setProbability] = useState(
      definition?.evolution.mutationProbability ?? 0.1,
    ),
    [sigma, setSigma] = useState(definition?.evolution.mutationSigma ?? 0.05),
    [reference, setReference] = useState(origin?.sourceLocalId ?? ""),
    [count, setCount] = useState(3);
  let preview = definition ? structuredClone(definition) : null,
    error: string | null = null;
  if (preview) {
    preview.id = "branch-preview";
    Object.assign(preview.world, {
      foodCount: food,
      obstacleCount: obstacles,
      bodyRadius: radius,
      sensorRange: range,
      vMax: speed,
    });
    Object.assign(preview.evolution, {
      mutationProbability: probability,
      mutationSigma: sigma,
    });
    try {
      validateDefinition(preview);
      if (
        !name.trim() ||
        name.length > 64 ||
        food > 200 ||
        obstacles > 10 ||
        sigma > 1
      )
        throw new Error(
          "Use a name, up to 200 food, up to 10 obstacles, and mutation magnitude 0–1.",
        );
    } catch (e) {
      error = String(e);
    }
  }
  const ready =
    !!definition &&
    !!v.storage.id &&
    v.storage.state === "saved" &&
    !v.storage.blocked &&
    v.status?.phase === "readyToEvaluate" &&
    !v.status.training &&
    !v.initializing &&
    !v.comparing &&
    !v.lineageComparing &&
    !v.matrixComparing &&
    !v.matrixUnsaved &&
    !v.comparisonUnsaved &&
    v.branchOrigins.length < 16 &&
    !v.storage.archiveBusy;
  const changes = definition && preview ? configDiff(definition, preview) : [],
    matrix = v.matrices.find((m) => m.id === v.matrixId),
    busy =
      v.initializing ||
      v.matrixComparing ||
      v.comparing ||
      v.lineageComparing ||
      v.failed;
  return (
    <section
      className="panel branches-panel"
      aria-labelledby="branches-heading"
    >
      <div className="branches-heading">
        <div>
          <span className="eyebrow">Copied population · paired schedules</span>
          <h2 id="branches-heading">Branches & common evaluations</h2>
        </div>
      </div>
      <p>
        Branch a saved population at its existing generation. Source weights and
        history stay available in their experiment. Trial and evolutionary seed
        schedules remain paired; new births use the branch’s identity.
      </p>
      {origin && (
        <div className="branch-provenance">
          <strong>
            Branched from {origin.sourceName} at generation{" "}
            {origin.source.generation}
          </strong>
          <p>
            Source checkpoint{" "}
            <code data-testid="branch-source-hash">
              {origin.source.checkpointHash}
            </code>
          </p>
          <p>
            {origin.changes.length
              ? origin.changes
                  .map((c) => `${settingName(c.key)}: ${c.before} → ${c.after}`)
                  .join(" · ")
              : "Configuration unchanged; paired control branch."}
          </p>
          <button
            disabled={
              busy ||
              !v.storage.entries.some((e) => e.id === origin.sourceLocalId)
            }
            onClick={() => void store.loadSaved(origin.sourceLocalId)}
          >
            Open source experiment
          </button>
          {!v.storage.entries.some((e) => e.id === origin.sourceLocalId) && (
            <p className="branch-caption">
              The source save is not in this browser. Saved matrices replay from
              their recorded controllers and maps.
            </p>
          )}
          <details>
            <summary>Branch provenance chain</summary>
            <ol aria-label="Branch provenance chain">
              {v.branchOrigins.map((o, i) => (
                <li key={o.definition.id}>
                  {o.sourceName} →{" "}
                  {v.branchOrigins[i + 1]?.sourceName ?? v.name} at generation{" "}
                  {o.source.generation} · {o.source.members.length} copied
                  members · {o.changes.length} configuration changes{" "}
                  <code title={o.source.checkpointHash}>
                    {o.source.checkpointHash.slice(0, 16)}
                  </code>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
      <details className="branch-create">
        <summary>Create a branch</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (preview && ready && !error) {
              preview = { ...preview, id: `branch-${crypto.randomUUID()}` };
              void store.fork(name.trim(), preview);
            }
          }}
        >
          <div className="branch-fields">
            <label>
              Branch name
              <input
                aria-label="Branch name"
                maxLength={64}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {(
              [
                ["Branch food count", food, setFood, 1, 200, 1],
                ["Branch obstacle count", obstacles, setObstacles, 0, 10, 1],
                ["Branch body radius", radius, setRadius, 1, 50, 1],
                ["Branch sensor range", range, setRange, 1, 2000, 1],
                ["Branch maximum speed", speed, setSpeed, 1, 500, 1],
                [
                  "Branch mutation probability",
                  probability,
                  setProbability,
                  0,
                  1,
                  0.01,
                ],
                ["Branch mutation magnitude", sigma, setSigma, 0, 1, 0.01],
              ] as const
            ).map(([label, value, set, min, max, step]) => (
              <label key={label}>
                {label
                  .replace("Branch ", "")
                  .replace(/^./, (c) => c.toUpperCase())}
                <input
                  aria-label={label}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(e) => set(Number(e.target.value))}
                />
              </label>
            ))}
          </div>
          <div className="branch-table-scroll" tabIndex={0}>
            <table aria-label="Proposed branch changes">
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  <th scope="col">Source</th>
                  <th scope="col">Branch</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.group + c.key}>
                    <th scope="row">{settingName(c.key)}</th>
                    <td>{c.before}</td>
                    <td>{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!changes.length && (
            <p className="branch-caption">
              No configuration changes. The branch will preserve identical
              paired conditions.
            </p>
          )}
          <p className="branch-caption">
            {error ??
              (v.matrixUnsaved || v.comparisonUnsaved
                ? "Retry saving pending comparisons before branching."
                : v.branchOrigins.length >= 16
                  ? "This run already has sixteen branch points. Its checkpoint remains exportable."
                  : !ready
                    ? "Finish and save the active generation, then pause training before branching."
                    : `Ready to copy saved population ${v.status?.generation}.`)}
          </p>
          <button
            className="primary"
            disabled={!ready || !!error}
            type="submit"
          >
            Create branch from saved population
          </button>
        </form>
      </details>
      {origin && (
        <div className="branch-comparison-controls">
          <label>
            Reference experiment
            <select
              aria-label="Reference experiment"
              value={reference}
              disabled={busy}
              onChange={(e) => setReference(e.target.value)}
            >
              <option value="">Choose a saved experiment</option>
              {v.storage.entries
                .filter((e) => e.id !== v.storage.id)
                .map((e) => (
                  <option
                    key={e.id}
                    value={e.id}
                    disabled={e.engineVersion !== ENGINE_VERSION}
                  >
                    {e.name} · population {e.generation}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Maps per environment
            <input
              aria-label="Maps per environment"
              type="number"
              min={1}
              max={8}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <button
            disabled={
              busy ||
              !reference ||
              reference === v.storage.id ||
              !Number.isInteger(count) ||
              count < 1 ||
              count > 8
            }
            onClick={() => void store.compareBranches(reference, count)}
          >
            Compare training-selected champions
          </button>
        </div>
      )}
      <p role="status" className="branch-matrix-status">
        {v.matrixNotice ??
          (origin
            ? "Train each experiment before comparing its own training-selected champion on the source and branch environment suites."
            : "Create or load a branch to compare its champion across both environments.")}
      </p>
      {v.matrixUnsaved && (
        <button disabled={busy} onClick={() => void store.retryMatrices()}>
          Retry matrix save
        </button>
      )}
      {matrix && (
        <>
          <div className="branch-comparison-controls">
            <label>
              Saved matrix
              <select
                aria-label="Saved branch matrix"
                value={matrix.id}
                onChange={(e) => store.selectMatrix(e.target.value)}
              >
                {v.matrices.map((m, i) => (
                  <option key={m.id} value={m.id}>
                    {i + 1} ·{" "}
                    {m.controllers
                      .map((c) => `${c.name} g${c.generation}`)
                      .join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() => void store.compareBranches("", 3, matrix)}
            >
              Replay saved matrix
            </button>
          </div>
          <Matrix matrix={matrix} />
        </>
      )}
    </section>
  );
}
export function Branches({ store }: { store: WorkbenchStore }) {
  const v = useView(store);
  return <BranchPanel key={v.storage.id ?? "new"} store={store} />;
}
