import type { WorkbenchStore, Settings } from "../store";
import { useView } from "../hooks";
import { Preview } from "../arena/Arena";
export function Setup({
  store,
  compact,
}: {
  store: WorkbenchStore;
  compact: boolean;
}) {
  const v = useView(store),
    s = v.draft;
  const number = (
    key: keyof Settings,
    label: string,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label>
      {label}
      <input
        name={key}
        type="number"
        value={Number.isFinite(s[key]) ? String(s[key]) : ""}
        min={min}
        max={max}
        step={step}
        required
        onChange={(e) =>
          store.updateDraft({
            [key]: e.target.value === "" ? NaN : Number(e.target.value),
          })
        }
      />
    </label>
  );
  return (
    <aside className="panel setup-panel">
      <details open={!compact}>
        <summary className="panel-title">Experiment settings</summary>
        <p className="muted small">Draft settings apply to a new experiment.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void store.create();
          }}
        >
          <fieldset
            disabled={
              !v.ready || v.failed || v.initializing || !!v.status?.training
            }
          >
            <label>
              Experiment name
              <input
                name="name"
                value={s.name}
                maxLength={64}
                required
                onChange={(e) => store.updateDraft({ name: e.target.value })}
              />
            </label>
            <label>
              Environment
              <select
                name="preset"
                value={s.preset}
                onChange={(e) =>
                  store.updateDraft({
                    preset: e.target.value as Settings["preset"],
                  })
                }
              >
                <option value="open">Open arena</option>
                <option value="obstacles">Obstacle arena</option>
              </select>
            </label>
            <label>
              Random seed
              <input
                name="seed"
                value={s.seed}
                maxLength={64}
                required
                onChange={(e) => store.updateDraft({ seed: e.target.value })}
              />
            </label>
            <div className="field-pair">
              {number("population", "Population", 16, 512)}
              {number("foodCount", "Food", 1, 200)}
            </div>
            {s.preset === "obstacles"
              ? number("obstacleCount", "Obstacles", 1, 10)
              : null}
            {number("seconds", "Episode seconds", 5, 180)}
            <details className="advanced">
              <summary>Evolution settings</summary>
              {number("trials", "Training trials", 1, 8)}
              <div className="field-pair">
                {number("elites", "Elites", 0, s.population)}
                {number("immigrants", "Immigrants", 0, s.population)}
              </div>
              {number(
                "mutationProbability",
                "Mutation probability",
                0,
                1,
                0.01,
              )}
              {number("mutationSigma", "Mutation magnitude", 0, 1, 0.01)}
            </details>
            {v.configError ? (
              <p className="field-error" role="alert">
                {v.configError}
              </p>
            ) : null}
            <button
              className="primary full"
              type="submit"
              disabled={!!v.configError}
            >
              {v.initializing
                ? "Creating…"
                : v.definition
                  ? "Start new experiment"
                  : "Create experiment"}
            </button>
          </fieldset>
        </form>
        <div className="preview-label">
          Draft world <span>First training trial</span>
        </div>
        <Preview scenario={v.preview} />
      </details>
      <p className="session-note">
        <span className="session-mark" /> Session only. Keep this tab open;
        reloading clears the experiment.
      </p>
    </aside>
  );
}
