import { useEffect, useRef } from "react";
import type { Scenario } from "../../core/model";
import type { WorkbenchStore } from "../store";
import { useView, useInspection } from "../hooks";
import { ArenaRenderer } from "./renderer";
export function Preview({ scenario }: { scenario: Scenario | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const renderer = new ArenaRenderer(canvas.current),
      draw = () =>
        renderer.draw(scenario, null, {
          showSensors: false,
          sensorOnly: false,
          showTrail: false,
        }),
      resize = new ResizeObserver(draw);
    resize.observe(canvas.current);
    draw();
    return () => resize.disconnect();
  }, [scenario]);
  return (
    <canvas
      ref={canvas}
      className="preview-canvas"
      role="img"
      aria-label={
        scenario
          ? "Seeded draft environment preview"
          : "Invalid environment preview"
      }
    />
  );
}
function ArenaCanvas({
  store,
  onInspect,
}: {
  store: WorkbenchStore;
  onInspect: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current!;
    const renderer = new ArenaRenderer(node);
    let raf = 0;
    const draw = () => {
      raf = 0;
      const v = store.getView();
      renderer.draw(
        v.selection?.scenario ?? v.preview,
        v.selection ? store.getFrame() : null,
        v,
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const offFrame = store.subscribeFrames(schedule),
      offView = store.subscribe(schedule),
      resize = new ResizeObserver(schedule);
    resize.observe(node);
    schedule();
    return () => {
      offFrame();
      offView();
      resize.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [store]);
  return (
    <canvas
      ref={canvas}
      className="arena-canvas"
      role="img"
      aria-label="Selected agent trial arena"
      onClick={(event) => {
        const v = store.getView(),
          s = store.getFrame()?.state;
        if (!s || v.sensorOnly) return;
        const rect = event.currentTarget.getBoundingClientRect(),
          c = v.selection!.scenario.config,
          scale = Math.min(rect.width / c.width, rect.height / c.height),
          x =
            (event.clientX - rect.left - (rect.width - c.width * scale) / 2) /
            scale,
          y =
            (event.clientY - rect.top - (rect.height - c.height * scale) / 2) /
            scale;
        if (Math.hypot(x - s.x, y - s.y) < 16) onInspect();
      }}
    />
  );
}
function PlaybackControls({ store }: { store: WorkbenchStore }) {
  const v = useView(store),
    frame = useInspection(store),
    disabled = !v.selection || v.loadingPlayback || v.failed,
    seeking = v.status?.seeking,
    playing = v.status?.playing;
  return (
    <div className="playback-controls">
      <div className="playback-buttons">
        <button
          className="primary"
          disabled={disabled || !!seeking || !!frame?.result}
          onClick={() => void store.playback("toggle")}
        >
          {playing ? "Pause trial" : "Play trial"}
        </button>
        <button
          disabled={disabled || !!playing || !!seeking}
          onClick={() => void store.playback("tick")}
          title="Advance one physics tick"
        >
          +1 tick
        </button>
        <button
          disabled={disabled || !!playing || !!seeking}
          onClick={() => void store.playback("decision")}
          title="Arrow right: advance to the next decision"
        >
          Step decision
        </button>
        <label className="speed-label">
          Speed
          <select
            aria-label="Playback speed"
            value={v.speed}
            disabled={disabled}
            onChange={(e) => void store.setSpeed(Number(e.target.value))}
          >
            {[0.25, 1, 2, 4, 8, 16].map((x) => (
              <option key={x} value={x}>
                {x}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="timeline">
        <span>
          {seeking ? "Seeking…" : `Tick ${frame?.state.tick ?? 0}`}
          <span>{((frame?.state.tick ?? 0) / 30).toFixed(2)} s</span>
        </span>
        <input
          aria-label="Playback tick"
          type="range"
          min={0}
          max={v.selection?.scenario.config.maxTicks ?? 1800}
          value={frame?.state.tick ?? 0}
          disabled={disabled || !!playing}
          onChange={(e) => void store.playback("seek", Number(e.target.value))}
        />
      </label>
      <div className="playback-note">
        {frame?.result
          ? `Episode ended · ${frame.result.terminalReason === "allFoodCollected" ? "all food collected" : frame.result.terminalReason === "energyExhausted" ? "energy exhausted" : "time limit"}`
          : "Space: play / pause · →: next decision"}
        <span>Playback is independent of training</span>
      </div>
    </div>
  );
}
export function Arena({
  store,
  onInspect,
}: {
  store: WorkbenchStore;
  onInspect: () => void;
}) {
  const v = useView(store),
    selection = v.selection;
  return (
    <section className="panel arena-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {selection ? "Independent trial" : "Seeded preview"}
          </span>
          <h2>{selection?.label ?? "A world ready for behavior"}</h2>
        </div>
        <button onClick={onInspect} disabled={!selection}>
          Inspect agent ↗
        </button>
      </div>
      <div className="specimen-bar">
        <label>
          Controller
          <select
            aria-label="Selected controller"
            value={selection ? `selected:${selection.genome.id}` : ""}
            disabled={!v.definition || v.initializing || v.loadingPlayback}
            onChange={(e) =>
              void store.selectPopulation(
                e.target.value.replace(/^population:/, ""),
              )
            }
          >
            {!selection ? (
              <option value="">Create an experiment first</option>
            ) : null}
            {selection ? (
              <option value={`selected:${selection.genome.id}`}>
                {selection.label} · born {selection.genome.birthGeneration}
              </option>
            ) : null}
            {v.population.map((g, i) => (
              <option key={g.id} value={`population:${g.id}`}>
                Population {v.status?.generation ?? 0} · slot {i + 1} · born{" "}
                {g.birthGeneration}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trial
          <select
            aria-label="Selected training trial"
            value={selection?.trial ?? 0}
            disabled={
              selection?.historyGeneration === null ||
              !selection ||
              v.loadingPlayback
            }
            onChange={(e) =>
              void store.selectChampion(
                selection!.historyGeneration!,
                Number(e.target.value),
              )
            }
          >
            {Array.from({ length: store.getTrialCount() }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="arena-surface">
        <ArenaCanvas store={store} onInspect={onInspect} />
        {v.loadingPlayback ? (
          <span className="arena-badge">Opening controller…</span>
        ) : !selection ? (
          <span className="arena-badge">
            Random controllers · private trial worlds
          </span>
        ) : (
          <span className="arena-badge">
            {v.sensorOnly ? "Sensor-only view" : "World view"} ·{" "}
            {selection.recordedResult
              ? "recorded training conditions"
              : "unscored preview"}
          </span>
        )}
      </div>
      <div className="view-controls">
        <label>
          <input
            type="checkbox"
            checked={v.sensorOnly}
            onChange={(e) => store.preference({ sensorOnly: e.target.checked })}
          />{" "}
          Sensor only
        </label>
        <label>
          <input
            type="checkbox"
            checked={v.showSensors}
            disabled={v.sensorOnly}
            onChange={(e) =>
              store.preference({ showSensors: e.target.checked })
            }
          />{" "}
          Sensor overlay
        </label>
        <label>
          <input
            type="checkbox"
            checked={v.showTrail}
            disabled={v.sensorOnly}
            onChange={(e) => store.preference({ showTrail: e.target.checked })}
          />{" "}
          Recent trail
        </label>
        <span>
          <i className="food-key" /> Food <i className="agent-key" /> Agent
        </span>
      </div>
      <PlaybackControls store={store} />
    </section>
  );
}
