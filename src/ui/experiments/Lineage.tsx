import { memo, useState } from "react";
import type { WorkbenchStore } from "../store";
import { useView } from "../hooks";
import type { GenomeMetadata } from "../../core/lineage";
import type { ControllerComparison } from "../../core/comparison/controllers";
import { Trajectory } from "../arena/Trajectory";

function relativeParameter(index: number) {
  if (index < 240) return `I${index % 20} → H${Math.floor(index / 20)}`;
  if (index < 252) return `H${index - 240} bias`;
  if (index < 276)
    return `H${(index - 252) % 12} → O${Math.floor((index - 252) / 12)}`;
  return `O${index - 276} bias`;
}
const exact = (value: number | undefined) =>
  value === undefined
    ? "Unavailable"
    : Object.is(value, -0)
      ? "−0"
      : String(value);
function Relative({
  genome,
  relation,
  store,
}: {
  genome: GenomeMetadata;
  relation: "ancestor" | "child";
  store: WorkbenchStore;
}) {
  return (
    <li>
      <button
        aria-label={`Inspect ${relation} ${genome.id}`}
        onClick={() => void store.browseLineage(genome.id)}
      >
        <span>
          Born {genome.birthGeneration} · {genome.origin}
        </span>
        <code>{genome.id}</code>
      </button>
    </li>
  );
}
const PairResults = memo(function PairResults({
  comparison,
}: {
  comparison: ControllerComparison;
}) {
  const [trial, setTrial] = useState(0),
    current = comparison.trials[Math.min(trial, comparison.trials.length - 1)];
  const mean = (
    side: "parent" | "child",
    metric:
      "foodCollected" | "distanceTravelled" | "contactTicks" | "survivalTicks",
  ) =>
    comparison.trials.reduce((sum, t) => sum + t[side].result[metric], 0) /
    comparison.trials.length;
  const metrics: [
    string,
    "foodCollected" | "distanceTravelled" | "contactTicks" | "survivalTicks",
    number,
  ][] = [
    ["Mean food", "foodCollected", 1],
    ["Mean distance", "distanceTravelled", 1],
    ["Mean contact (s)", "contactTicks", 30],
    ["Mean survival (s)", "survivalTicks", 30],
  ];
  return (
    <div
      className="lineage-pair"
      data-testid="lineage-pair"
      data-suite-id={comparison.suiteId}
    >
      <p>
        Shared suite <code>{comparison.suiteId.slice(0, 16)}</code> ·{" "}
        {comparison.trials.length} map
        {comparison.trials.length === 1 ? "" : "s"} · both start at tick 0.
      </p>
      <div className="lineage-table-scroll" tabIndex={0}>
        <table aria-label="Parent and child outcomes">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">Parent</th>
              <th scope="col">Child</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(([label, key, scale]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{(mean("parent", key) / scale).toFixed(4)}</td>
                <td>{(mean("child", key) / scale).toFixed(4)}</td>
                <td>
                  {((mean("child", key) - mean("parent", key)) / scale).toFixed(
                    4,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="lineage-trial">
        Comparison trial
        <select
          aria-label="Parent-child comparison trial"
          value={trial}
          onChange={(e) => setTrial(Number(e.target.value))}
        >
          {comparison.trials.map((t, i) => (
            <option key={t.scenario.hash} value={i}>
              {i + 1} · {t.scenario.hash.slice(0, 12)}
            </option>
          ))}
        </select>
      </label>
      <div className="comparison-paths">
        <Trajectory
          scenario={current.scenario}
          arm={current.parent}
          label="Parent"
        />
        <Trajectory
          scenario={current.scenario}
          arm={current.child}
          label="Child"
        />
      </div>
      <p className="lineage-pair-context">
        Parent <code>{comparison.parentId}</code>
        <br />
        Child <code>{comparison.childId}</code>
        <br />
        Map{" "}
        <code data-testid="lineage-comparison-map">
          {current.scenario.hash}
        </code>
      </p>
      <p className="lineage-caption">
        Paths sample every three physics ticks. A hollow circle marks the start;
        a filled circle marks the endpoint. This exploratory comparison does not
        affect training or selection. Comparison results stay in this view; the
        full lineage archive retains the weights and original maps for rerunning
        them.
      </p>
    </div>
  );
});
export function Lineage({ store }: { store: WorkbenchStore }) {
  const v = useView(store),
    family = v.lineage,
    [suite, setSuite] = useState<"selected" | "recorded">("selected");
  const [lookup, setLookup] = useState("");
  const selected = family?.genome,
    changes = selected?.mutation?.changes;
  const busy = v.lineageLoading || v.initializing || v.failed;
  return (
    <section className="panel lineage-panel" aria-labelledby="lineage-heading">
      <div className="lineage-heading">
        <div>
          <span className="eyebrow">
            Inherited weights · every retained birth
          </span>
          <h2 id="lineage-heading">Controller lineage</h2>
        </div>
        <button
          disabled={!v.selection || busy}
          onClick={() => void store.browseLineage(v.selection!.genome.id)}
        >
          Follow selected controller
        </button>
      </div>
      <p className="lineage-intro">
        Trace a controller’s ancestors, inspect its recorded parameter changes,
        and explore its children—including those that left the population.
      </p>
      <form
        className="lineage-lookup"
        onSubmit={(e) => {
          e.preventDefault();
          if (lookup.trim()) void store.browseLineage(lookup.trim());
        }}
      >
        <label>
          Controller ID
          <input
            aria-label="Retained controller ID"
            value={lookup}
            maxLength={256}
            placeholder="Paste a retained controller ID"
            onChange={(e) => setLookup(e.target.value)}
          />
        </label>
        <button disabled={!lookup.trim() || busy}>
          Find retained controller
        </button>
      </form>
      {v.lineageError && (
        <p className="lineage-error" role="status">
          {v.lineageError}
        </p>
      )}
      {!family ? (
        <p className="lineage-caption">
          {v.lineageLoading
            ? "Loading retained ancestry…"
            : "Create an experiment to begin retaining its lineage."}
        </p>
      ) : (
        <>
          <p className="lineage-coverage">
            {family.totalNodes} births retained ·{" "}
            {family.fromGeneration === 0
              ? "History retained from generation 0"
              : `Complete generation records begin at generation ${family.fromGeneration}; earlier history is incomplete.`}
            {v.lineageLoading ? " · Loading…" : ""}
          </p>
          <div className="lineage-family">
            <div className="lineage-relatives">
              <h3>Ancestors</h3>
              {family.ancestors.length ? (
                <ol aria-label="Ancestry path">
                  {family.ancestors.map((g) => (
                    <Relative
                      key={g.id}
                      genome={g}
                      relation="ancestor"
                      store={store}
                    />
                  ))}
                </ol>
              ) : (
                <p>
                  {selected!.parentIds.length
                    ? "The parent is unavailable in this checkpoint."
                    : "This controller has no parent."}
                </p>
              )}
              {family.nextAncestor && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void store.browseLineage(selected!.id, {
                      ancestorStart: family.nextAncestor!,
                    })
                  }
                >
                  Older ancestors
                </button>
              )}
              {family.missingAncestor && (
                <p className="lineage-caption">
                  Earlier ancestor unavailable:{" "}
                  <code>{family.missingAncestor}</code>
                </p>
              )}
            </div>
            <div
              className="lineage-selected"
              data-testid="lineage-selected"
              data-genome-id={selected!.id}
            >
              <span className="lineage-origin">
                {selected!.origin} · born {selected!.birthGeneration}
              </span>
              <h3>Inspected controller</h3>
              <code>{selected!.id}</code>
              <p className="lineage-caption">
                Weight fingerprint{" "}
                <code
                  title={selected!.parameterHash}
                  data-testid="lineage-parameter-hash"
                >
                  {selected!.parameterHash}
                </code>
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void store.replayAncestor(selected!.id)}
              >
                Replay retained controller
              </button>
              <p className="lineage-caption">
                {family.replay
                  ? `${family.replay.scenarios.length} recorded trial${family.replay.scenarios.length === 1 ? "" : "s"} from generation ${family.replay.generation} available.`
                  : "No original evaluation is retained for this birth. Replay uses the selected trial map as a new evaluation."}
              </p>
              {selected!.origin === "mutation" && (
                <details className="lineage-mutations">
                  <summary>
                    {changes
                      ? `${changes.length} recorded parameter changes`
                      : "Mutation patch unavailable"}
                  </summary>
                  {changes && (
                    <div className="lineage-table-scroll" tabIndex={0}>
                      <table aria-label="Mutation parameter values">
                        <thead>
                          <tr>
                            <th scope="col">Index</th>
                            <th scope="col">Connection / bias</th>
                            <th scope="col">Parent value</th>
                            <th scope="col">Child value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changes.map((c) => (
                            <tr key={c.index} data-parameter-index={c.index}>
                              <th scope="row">{c.index}</th>
                              <td>{relativeParameter(c.index)}</td>
                              <td>
                                {exact(family.parent?.parameters[c.index])}
                              </td>
                              <td>{exact(selected!.parameters[c.index])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </details>
              )}
            </div>
            <div className="lineage-relatives">
              <h3>
                Children <span>{family.childrenCount}</span>
              </h3>
              {family.children.length ? (
                <ol aria-label="Retained children">
                  {family.children.map((g) => (
                    <Relative
                      key={g.id}
                      genome={g}
                      relation="child"
                      store={store}
                    />
                  ))}
                </ol>
              ) : (
                <p>No children recorded yet.</p>
              )}
              <div className="lineage-pages">
                <button
                  disabled={busy || family.childrenOffset === 0}
                  onClick={() =>
                    void store.browseLineage(selected!.id, {
                      childrenOffset: Math.max(0, family.childrenOffset - 20),
                    })
                  }
                >
                  Previous children
                </button>
                <button
                  disabled={
                    busy || family.childrenOffset + 20 >= family.childrenCount
                  }
                  onClick={() =>
                    void store.browseLineage(selected!.id, {
                      childrenOffset: family.childrenOffset + 20,
                    })
                  }
                >
                  Next children
                </button>
              </div>
            </div>
          </div>
          <div className="lineage-compare-controls">
            <label>
              Shared comparison maps
              <select
                aria-label="Shared comparison maps"
                value={suite}
                onChange={(e) =>
                  setSuite(e.target.value as "selected" | "recorded")
                }
              >
                <option value="selected">Selected trial map</option>
                <option value="recorded" disabled={!family.replay}>
                  Child’s recorded trials
                  {family.replay
                    ? ` (${family.replay.scenarios.length})`
                    : " · unavailable"}
                </option>
              </select>
            </label>
            <button
              disabled={
                !family.parent ||
                busy ||
                v.comparing ||
                v.lineageComparing ||
                v.matrixComparing ||
                (suite === "recorded" ? !family.replay : !v.selection)
              }
              onClick={() => void store.compareLineage(suite)}
            >
              {v.lineageComparing
                ? "Comparing controllers…"
                : "Compare parent and child"}
            </button>
          </div>
          <p className="lineage-caption" role="status">
            {v.lineageNotice ??
              (family.parent
                ? "Both frozen controllers will start fresh on each shared map. Their original selection scores are not substituted."
                : "Inspect a child with a retained parent to compare inherited behavior.")}
          </p>
          {v.lineageComparison && (
            <PairResults
              key={v.lineageComparison.suiteId + v.lineageComparison.childId}
              comparison={v.lineageComparison}
            />
          )}
        </>
      )}
    </section>
  );
}
