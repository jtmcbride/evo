import { createRoot } from "react-dom/client";
import { WorkbenchStore } from "./ui/store";
import { App } from "./ui/App";
const store = new WorkbenchStore();
window.addEventListener("pagehide", () => store.dispose(), { once: true });
createRoot(document.getElementById("root")!).render(<App store={store} />);
