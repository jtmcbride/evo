import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(
  <main>
    <h1>Evolution Lab</h1>
    <p>
      The deterministic engine is available through the evaluate and evolve
      commands. Worker execution is available in the runtime diagnostics; the
      interactive workbench arrives in M5.
    </p>
    <a href={`${import.meta.env.BASE_URL}runtime.html`}>
      Open runtime diagnostics
    </a>
  </main>,
);
