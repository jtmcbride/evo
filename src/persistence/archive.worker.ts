import { createArchive, readArchive } from "./archive";
const host = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (data: unknown, transfer?: Transferable[]) => void;
};
host.onmessage = (event) => {
  try {
    if (event.data.type === "export") {
      const bytes = createArchive(event.data.session);
      host.postMessage({ ok: true, bytes }, [bytes.buffer as ArrayBuffer]);
    } else if (event.data.type === "import") {
      host.postMessage({
        ok: true,
        session: readArchive(new Uint8Array(event.data.bytes)),
      });
    } else throw new Error("Invalid archive operation");
  } catch (error) {
    host.postMessage({
      ok: false,
      message: (error instanceof Error ? error.message : String(error)).slice(
        0,
        2000,
      ),
    });
  }
};
