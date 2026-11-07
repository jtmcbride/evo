import { SimulationRuntime } from "./runtime";
const host = self as unknown as {
  postMessage: (event: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
  close: () => void;
};
const runtime = new SimulationRuntime(
  crypto.randomUUID(),
  (event) => host.postMessage(event),
  () => performance.now(),
);
let timer: ReturnType<typeof setTimeout> | null = null;
function schedule() {
  if (timer === null && runtime.needsWork)
    timer = setTimeout(
      () => {
        timer = null;
        runtime.pump();
        schedule();
      },
      runtime.hasTrainingWork ? 0 : 16,
    );
}
host.onmessage = (event) => {
  runtime.receive(event.data);
  if (runtime.status().disposed) {
    if (timer !== null) clearTimeout(timer);
    host.close();
    return;
  }
  schedule();
};
