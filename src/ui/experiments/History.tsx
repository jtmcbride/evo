import { memo, useMemo } from "react";
import type { WorkbenchStore, GenerationSummary } from "../store";
import { useView } from "../hooks";
const Chart = memo(function Chart({
  history,
}: {
  history: GenerationSummary[];
}) {
  const points = useMemo(() => {
    const data = history.slice(-100),
      max = Math.max(
        1,
        ...data.flatMap((d) => [d.best, d.median, d.validation ?? 0]),
      );
    const x = (i: number) =>
        44 + (data.length < 2 ? 0 : i / (data.length - 1)) * 650,
      y = (value: number) => 145 - (value / max) * 115;
    const path = (key: "best" | "median" | "validation") =>
      data
        .flatMap((d, i) => (d[key] === null ? [] : [`${x(i)},${y(d[key]!)}`]))
        .join(" ");
    return {
      data,
      max,
      x,
      y,
      best: path("best"),
      median: path("median"),
      validation: path("validation"),
    };
  }, [history]);
  return (
    <svg
      className="progress-chart"
      viewBox="0 0 730 180"
      role="img"
      aria-label="Training best and median food collection with fixed validation results"
    >
      <title>Food collected per trial across generations</title>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line
            x1={44}
            x2={694}
            y1={points.y(points.max * f)}
            y2={points.y(points.max * f)}
            stroke="#dce6ef"
          />
          <text x={34} y={points.y(points.max * f) + 4} textAnchor="end">
            {(points.max * f).toFixed(1)}
          </text>
        </g>
      ))}
      <polyline
        points={points.best}
        fill="none"
        stroke="#3458d4"
        strokeWidth={2.5}
      />
      <polyline
        points={points.median}
        fill="none"
        stroke="#087e8b"
        strokeWidth={2}
        strokeDasharray="3 4"
      />
      <polyline
        points={points.validation}
        fill="none"
        stroke="#b86d12"
        strokeWidth={2}
        strokeDasharray="8 4"
      />
      {points.data.map((d, i) => (
        <g key={d.generation}>
          <circle
            cx={points.x(i)}
            cy={points.y(d.best)}
            r={2.5}
            fill="#3458d4"
          />
          {d.validation !== null ? (
            <rect
              x={points.x(i) - 3}
              y={points.y(d.validation) - 3}
              width={6}
              height={6}
              fill="#b86d12"
            />
          ) : null}
        </g>
      ))}
      <text x={44} y={169}>
        Generation {points.data[0]?.generation ?? 0}
      </text>
      <text x={694} y={169} textAnchor="end">
        {points.data.at(-1)?.generation ?? 0}
      </text>
      {!history.length ? (
        <text x={365} y={85} textAnchor="middle">
          Train a generation to begin measuring.
        </text>
      ) : null}
    </svg>
  );
});
export function History({ store }: { store: WorkbenchStore }) {
  const v = useView(store);
  return (
    <section
      className="panel history-panel"
      id="history-panel"
      aria-label="Experiment history"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Evolutionary record</span>
          <h2>Behavior, measured over generations</h2>
        </div>
        <span className="small muted">Food / trial</span>
      </div>
      <div className="chart-legend">
        <span className="legend-best">━ Training best</span>
        <span className="legend-median">┄ Training median</span>
        <span className="legend-validation">▰ Fixed validation</span>
      </div>
      <Chart history={v.history} />
      {v.branchOrigins.some((o) =>
        o.changes.some((c) => c.group === "world"),
      ) && (
        <p className="chart-caption">
          Environment settings changed at the recorded branch points. Use the
          common evaluation matrix to compare controllers across those
          environments.
        </p>
      )}
      <p className="chart-caption">
        Training maps rotate each generation. Validation uses fixed maps every
        10 generations and never selects parents.
      </p>
      <div className="champion-list" aria-label="Generation champions">
        {v.history.length ? (
          v.history
            .slice(-50)
            .reverse()
            .map((row) => (
              <button
                key={row.generation}
                data-commit-id={row.commitId}
                aria-pressed={v.selection?.historyGeneration === row.generation}
                onClick={() => void store.selectChampion(row.generation)}
                disabled={
                  !v.replayGenerations.includes(row.generation) ||
                  v.loadingPlayback
                }
              >
                <span>Generation {row.generation} champion</span>
                <strong>
                  {row.best.toFixed(2)} <small>food / trial</small>
                </strong>
                <span className="muted small">Replay original trials ↗</span>
              </button>
            ))
        ) : (
          <p className="empty-history">
            A champion appears after each evaluated generation. Select one to
            replay the exact training conditions.
          </p>
        )}
      </div>
      <p className="small muted retention-note">
        Latest 50 champion replays and 1,000 generation summaries are retained
        in this tab. Chart shows the latest 100 generations.
      </p>
      {v.history.length ? (
        <details className="data-details">
          <summary>Generation measurements</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Generation</th>
                  <th>Training best</th>
                  <th>Training median</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {v.history.map((r) => (
                  <tr key={r.generation}>
                    <td>{r.generation}</td>
                    <td>{r.best.toFixed(3)}</td>
                    <td>{r.median.toFixed(3)}</td>
                    <td>
                      {r.validation === null
                        ? "Not scheduled"
                        : r.validation.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
