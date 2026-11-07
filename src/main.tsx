import { createRoot } from "react-dom/client";
import { WorkbenchStore } from "./ui/store";
import { App } from "./ui/App";
import { IndexedRepository } from "./persistence/database";
import { SimulationClient } from "./runtime/client";
const root = createRoot(document.getElementById("root")!);
let store = new WorkbenchStore(new SimulationClient(), new IndexedRepository()),
  instance = 0;
const render = () => root.render(<App key={instance} store={store} />);
window.addEventListener("pagehide", () => store.dispose());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    store = new WorkbenchStore(new SimulationClient(), new IndexedRepository());
    instance++;
    render();
  }
});
render();
