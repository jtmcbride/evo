import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { encode } from "../src/core/codec";
import type { ExperimentCheckpoint } from "../src/core/evolution";
import type { GenerationCommit } from "../src/core/experiment";
export interface Runtime {
  node: string;
  platform: string;
  arch: string;
}
export class FileCommitStore {
  private constructor(
    private out: string,
    private runtime: Runtime,
    private expectedHead: string,
  ) {}
  static async open(
    out: string,
    runtime: Runtime,
    checkpoint: ExperimentCheckpoint,
    resume: boolean,
  ) {
    await mkdir(out, { recursive: true });
    const lock = join(out, ".writer-lock");
    await mkdir(lock).catch(() => {
      throw new Error(
        "Output is locked by another writer. After a crash, resume into a new --out directory.",
      );
    });
    const store = new FileCommitStore(
      out,
      runtime,
      encode({ runtime, checkpoint }),
    );
    try {
      const previous = await readFile(
        join(out, "checkpoint.evo"),
        "utf8",
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (previous !== null && (!resume || previous !== store.expectedHead))
        throw new Error(
          "Output head differs; choose another --out or resume its current checkpoint",
        );
      if (previous === null)
        await store.atomic(join(out, "checkpoint.evo"), store.expectedHead);
      return store;
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  private async atomic(path: string, body: string) {
    await writeFile(`${path}.tmp`, body);
    await rename(`${path}.tmp`, path);
  }
  async put(commit: GenerationCommit) {
    const next = encode({
        runtime: this.runtime,
        checkpoint: commit.nextCheckpoint,
      }),
      head = await readFile(join(this.out, "checkpoint.evo"), "utf8");
    if (head !== this.expectedHead && head !== next)
      throw new Error("Output head changed during evaluation");
    const dir = join(this.out, `generation-${commit.record.generation}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "commit.evo"),
      body = encode(commit);
    const previous = await readFile(path, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (previous !== null && previous !== body)
      throw new Error("Conflicting generation commit");
    if (previous === null) await this.atomic(path, body);
    await this.atomic(join(this.out, "checkpoint.evo"), next);
    this.expectedHead = next;
  }
  async close() {
    await rm(join(this.out, ".writer-lock"), { recursive: true, force: true });
  }
}
