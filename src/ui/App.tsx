import { useEffect, useState, useSyncExternalStore } from "react";
import type { WorkbenchStore } from "./store";
import { useView } from "./hooks";
import { Setup } from "./experiments/Setup";
import { Training } from "./experiments/Training";
import { History } from "./experiments/History";
import { Arena } from "./arena/Arena";
import { Inspector } from "./inspector/Inspector";
import "./styles.css";
const media = window.matchMedia("(max-width: 760px)");
const subscribeMedia = (f: () => void) => {
  media.addEventListener("change", f);
  return () => media.removeEventListener("change", f);
};
function Notices({ store }: { store: WorkbenchStore }) {
  const v = useView(store);
  return v.error ? (
    <div className="error-banner" role="alert">
      <span>
        {v.failed
          ? "The simulation stopped. Reload to start a new session. "
          : ""}
        {v.error}
      </span>
      <button onClick={() => store.clearError()}>Dismiss error</button>
    </div>
  ) : null;
}
export function App({ store }: { store: WorkbenchStore }) {
  const compact = useSyncExternalStore(subscribeMedia, () => media.matches),
    [pane, setPane] = useState<"inspector" | "history">("inspector");
  const inspect = () => {
    setPane("inspector");
    requestAnimationFrame(() =>
      document.getElementById("inspector-heading")?.focus(),
    );
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest('input,select,textarea,button,summary,[role="button"]')
      )
        return;
      const v = store.getView();
      if (!v.selection || v.loadingPlayback) return;
      if (e.code === "Space") {
        e.preventDefault();
        void store.playback("toggle");
      } else if (
        e.code === "ArrowRight" &&
        !v.status?.playing &&
        !v.status?.seeking
      ) {
        e.preventDefault();
        void store.playback("decision");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [store]);
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-symbol" aria-hidden="true">
            ⋮
          </span>
          <div>
            <h1>Evolution Lab</h1>
            <p>Foraging experiments · independent trials</p>
          </div>
        </div>
        <div className="header-note">
          <span className="pill">20 → 12 → 2</span>
          <a href={`${import.meta.env.BASE_URL}runtime.html`}>
            Runtime diagnostics ↗
          </a>
        </div>
      </header>
      <Notices store={store} />
      <Training store={store} />
      <main className="workbench" data-pane={pane}>
        <Setup store={store} compact={compact} />
        <Arena store={store} onInspect={inspect} />
        <div
          className="mobile-tabs"
          role="tablist"
          aria-label="Workbench panels"
        >
          <button
            role="tab"
            aria-selected={pane === "inspector"}
            aria-controls="inspector-panel"
            onClick={() => setPane("inspector")}
          >
            Inspector
          </button>
          <button
            role="tab"
            aria-selected={pane === "history"}
            aria-controls="history-panel"
            onClick={() => setPane("history")}
          >
            History
          </button>
        </div>
        <Inspector store={store} />
        <History store={store} />
      </main>
      <footer className="app-footer">
        <span>
          Evolution changes controllers between generations. Weights stay fixed
          within a trial.
        </span>
        <span>Engine 1 · local session</span>
      </footer>
    </div>
  );
}
