import { Unzip, UnzipInflate, zipSync, strToU8, strFromU8 } from "fflate";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { encode, decode } from "../core/codec";
import { parameterHash } from "../core/canonical";
import { ENGINE_VERSION, type Genome } from "../core/model";
import { parseSession, type SavedSession } from "./model";
export const ARCHIVE_LIMITS = {
  compressed: 32 * 1024 * 1024,
  expanded: 64 * 1024 * 1024,
  session: 16 * 1024 * 1024,
  manifest: 128 * 1024,
  entries: 1024,
};
const digest = (bytes: Uint8Array) =>
  Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const parameterPath = (hash: string) => `parameters/${hash}.f32`;
function parameterBytes(p: Float32Array) {
  const bytes = new Uint8Array(1112),
    view = new DataView(bytes.buffer);
  p.forEach((value, i) => view.setFloat32(i * 4, value, true));
  return bytes;
}
const manifestSchema = z
  .object({
    format: z.literal("evolution-lab"),
    formatVersion: z.literal(1),
    engineVersion: z.string().max(100),
    kind: z.literal("checkpoint"),
    ancestry: z.literal("partial"),
    entries: z
      .array(
        z
          .object({
            path: z.string().max(128),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().nonnegative().max(ARCHIVE_LIMITS.session),
          })
          .strict(),
      )
      .min(2)
      .max(ARCHIVE_LIMITS.entries - 1),
  })
  .strict();
/** Synchronous codec used in the dedicated archive worker, never on the live simulation worker. */
export function createArchive(value: SavedSession): Uint8Array {
  const session = parseSession(value),
    files: Record<string, Uint8Array> = {};
  const external = (g: Genome) => {
    files[parameterPath(g.parameterHash)] = parameterBytes(g.parameters);
    return { ...g, parameters: { $parameter: g.parameterHash } };
  };
  const data = {
    ...session,
    checkpoint: {
      ...session.checkpoint,
      population: session.checkpoint.population.map(external),
    },
    replays: session.replays.map((r) => ({ ...r, genome: external(r.genome) })),
    bookmark: session.bookmark
      ? { ...session.bookmark, genome: external(session.bookmark.genome) }
      : null,
  };
  files["session.json"] = strToU8(encode(data));
  const manifest = {
    format: "evolution-lab",
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    kind: "checkpoint",
    ancestry: "partial",
    entries: Object.entries(files).map(([path, bytes]) => ({
      path,
      sha256: digest(bytes),
      bytes: bytes.length,
    })),
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  if (
    files["session.json"].length > ARCHIVE_LIMITS.session ||
    Object.values(files).reduce((s, b) => s + b.length, 0) >
      ARCHIVE_LIMITS.expanded
  )
    throw new Error("Checkpoint exceeds archive limits");
  const bytes = zipSync(files, { level: 6 });
  if (bytes.length > ARCHIVE_LIMITS.compressed)
    throw new Error("Checkpoint exceeds compressed archive limit");
  return bytes;
}
function unpack(bytes: Uint8Array) {
  if (bytes.length > ARCHIVE_LIMITS.compressed)
    throw new Error("Archive exceeds the 32 MiB file limit");
  if (bytes.length < 22) throw new Error("Archive is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (
    end < 0 ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== view.getUint16(end + 10, true) ||
    view.getUint32(end + 12, true) + view.getUint32(end + 16, true) !== end
  )
    throw new Error("Archive directory is incomplete or unsupported");
  const files = new Map<string, Uint8Array>(),
    names = new Set<string>();
  let expanded = 0,
    error: Error | null = null;
  const unzip = new Unzip((file) => {
    if (error) return;
    const name = file.name;
    if (
      names.size >= ARCHIVE_LIMITS.entries ||
      names.has(name) ||
      !(
        name === "manifest.json" ||
        name === "session.json" ||
        /^parameters\/[a-f0-9]{64}\.f32$/.test(name)
      )
    ) {
      error = new Error("Invalid, duplicate, or excessive archive entries");
      file.terminate();
      return;
    }
    names.add(name);
    const limit =
      name === "manifest.json"
        ? ARCHIVE_LIMITS.manifest
        : name === "session.json"
          ? ARCHIVE_LIMITS.session
          : 1112;
    if (file.originalSize !== undefined && file.originalSize > limit) {
      error = new Error("Archive entry exceeds its size limit");
      file.terminate();
      return;
    }
    let size = 0;
    const chunks: Uint8Array[] = [];
    file.ondata = (failure, data, final) => {
      if (error) return;
      if (failure) {
        error = failure;
        return;
      }
      size += data.length;
      expanded += data.length;
      if (size > limit || expanded > ARCHIVE_LIMITS.expanded) {
        error = new Error("Archive expanded-size limit exceeded");
        file.terminate();
        return;
      }
      chunks.push(data);
      if (final) {
        const output = new Uint8Array(size);
        let offset = 0;
        for (const c of chunks) {
          output.set(c, offset);
          offset += c.length;
        }
        files.set(name, output);
      }
    };
    try {
      file.start();
    } catch (failure) {
      error = failure instanceof Error ? failure : new Error(String(failure));
    }
  });
  unzip.register(UnzipInflate);
  // Small compressed chunks bound transient expansion before each actual-size check.
  for (let offset = 0; offset < bytes.length && !error; offset += 1024)
    unzip.push(
      bytes.subarray(offset, offset + 1024),
      offset + 1024 >= bytes.length,
    );
  if (error) throw error;
  if (names.size !== view.getUint16(end + 10, true))
    throw new Error("Archive directory count mismatch");
  if (
    files.size !== names.size ||
    !files.has("manifest.json") ||
    !files.has("session.json")
  )
    throw new Error("Archive is incomplete");
  return files;
}
export function readArchive(bytes: Uint8Array): SavedSession {
  const files = unpack(bytes),
    manifest = manifestSchema.parse(
      JSON.parse(strFromU8(files.get("manifest.json")!)),
    );
  if (manifest.engineVersion !== ENGINE_VERSION)
    throw new Error(`Unsupported engine version: ${manifest.engineVersion}`);
  const names = new Set(manifest.entries.map((e) => e.path));
  if (
    names.size !== manifest.entries.length ||
    names.size !== files.size - 1 ||
    !names.has("session.json")
  )
    throw new Error("Archive manifest entries do not match");
  for (const entry of manifest.entries) {
    const data = files.get(entry.path);
    if (!data || data.length !== entry.bytes || digest(data) !== entry.sha256)
      throw new Error(`Archive checksum mismatch: ${entry.path}`);
  }
  const used = new Set(["manifest.json", "session.json"]);
  const raw = JSON.parse(
    strFromU8(files.get("session.json")!),
    (_key, value) => {
      if (value && typeof value === "object" && "$parameter" in value) {
        if (
          Object.keys(value).length !== 1 ||
          typeof value.$parameter !== "string" ||
          !/^[a-f0-9]{64}$/.test(value.$parameter)
        )
          throw new Error("Invalid parameter reference");
        const path = parameterPath(value.$parameter),
          data = files.get(path);
        if (!data || data.length !== 1112)
          throw new Error("Missing or truncated parameter data");
        used.add(path);
        const view = new DataView(
            data.buffer,
            data.byteOffset,
            data.byteLength,
          ),
          p = new Float32Array(278);
        for (let i = 0; i < 278; i++) p[i] = view.getFloat32(i * 4, true);
        if (!p.every(Number.isFinite) || parameterHash(p) !== value.$parameter)
          throw new Error("Invalid parameter checksum");
        return { $evo: "float32le", bytes: Array.from(data) };
      }
      return value;
    },
  );
  if (used.size !== files.size)
    throw new Error("Archive contains unreferenced records");
  return parseSession(decode(JSON.stringify(raw)));
}
