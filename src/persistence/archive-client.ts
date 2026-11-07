import { type SavedSession } from "./model";
function job(
  message: unknown,
  transfer: Transferable[] = [],
): Promise<{ bytes: Uint8Array; session: SavedSession }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./archive.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("Archive operation timed out"));
    }, 30000);
    worker.onmessage = (event) => {
      finish();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Archive worker failed"));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new Error("Archive response could not be decoded"));
    };
    try {
      worker.postMessage(message, transfer);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
export async function exportCheckpoint(session: SavedSession) {
  return (await job({ type: "export", session })).bytes;
}
export async function importCheckpoint(file: File) {
  if (file.size > 32 * 1024 * 1024)
    throw new Error("Archive exceeds the 32 MiB file limit");
  const bytes = await file.arrayBuffer();
  return (await job({ type: "import", bytes }, [bytes])).session;
}
