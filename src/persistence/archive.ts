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
    formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    engineVersion: z.string().max(100),
    kind: z.enum(["checkpoint", "lineage"]),
    ancestry: z.enum(["partial", "complete"]),
    entries: z
      .array(
        z
          .object({
            path: z.string().max(128),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().nonnegative().max(ARCHIVE_LIMITS.expanded),
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
    lineage: undefined,
    checkpoint: {
      ...session.checkpoint,
      population: session.checkpoint.population.map(external),
    },
    replays: session.replays.map((r) => ({ ...r, genome: external(r.genome) })),
    bookmark: session.bookmark
      ? { ...session.bookmark, genome: external(session.bookmark.genome) }
      : null,
    comparisons: (session.comparisons ?? []).map((c) => {
      const controller = c.source.definition.controller;
      if (controller.kind !== "neural") return c;
      const key = parameterHash(controller.parameters);
      files[parameterPath(key)] = parameterBytes(controller.parameters);
      return {
        ...c,
        source: {
          ...c.source,
          definition: {
            ...c.source.definition,
            controller: { ...controller, parameters: { $parameter: key } },
          },
        },
      };
    }),
  };
  if (session.lineage) {
    const blocks: Uint8Array[] = [],
      offsets = new Map<string, number>();
    const lineage = {
      ...session.lineage,
      nodes: session.lineage.nodes.map((node) => {
        if (node.storage.kind !== "full") return node;
        const key = node.genome.parameterHash;
        if (files[parameterPath(key)])
          return {
            ...node,
            storage: { ...node.storage, parameters: { $parameter: key } },
          };
        let offset = offsets.get(key);
        if (offset === undefined) {
          offset = blocks.length * 1112;
          offsets.set(key, offset);
          blocks.push(parameterBytes(node.storage.parameters));
        }
        return {
          ...node,
          storage: {
            ...node.storage,
            parameters: { $lineageParameter: key, offset },
          },
        };
      }),
    };
    files["lineage.json"] = strToU8(encode(lineage));
    if (blocks.length) {
      const bytes = new Uint8Array(blocks.length * 1112);
      blocks.forEach((b, i) => bytes.set(b, i * 1112));
      files["lineage-parameters.f32"] = bytes;
    }
  }
  files["session.json"] = strToU8(encode(data));
  const manifest = {
    format: "evolution-lab",
    formatVersion: session.lineage ? 3 : 2,
    engineVersion: ENGINE_VERSION,
    kind: session.lineage ? "lineage" : "checkpoint",
    ancestry: session.lineage?.fromGeneration === 0 ? "complete" : "partial",
    entries: Object.entries(files).map(([path, bytes]) => ({
      path,
      sha256: digest(bytes),
      bytes: bytes.length,
    })),
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  if (
    Object.keys(files).length > ARCHIVE_LIMITS.entries ||
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
        name === "lineage.json" ||
        name === "lineage-parameters.f32" ||
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
          : name === "lineage.json" || name === "lineage-parameters.f32"
            ? ARCHIVE_LIMITS.expanded
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
  if (
    manifest.formatVersion < 3
      ? manifest.kind !== "checkpoint" || manifest.ancestry !== "partial"
      : manifest.kind !== "lineage"
  )
    throw new Error("Invalid archive kind or ancestry version");
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
  const offsets = new Set<number>();
  const revive = (_key: string, value: unknown): unknown => {
    if (
      value &&
      typeof value === "object" &&
      ("$parameter" in value || "$lineageParameter" in value)
    ) {
      const reference = value as {
        $parameter?: string;
        $lineageParameter?: string;
        offset?: number;
      };
      const aggregate = "$lineageParameter" in value;
      const key = aggregate
        ? reference.$lineageParameter
        : reference.$parameter;
      if (
        Object.keys(value).length !== (aggregate ? 2 : 1) ||
        typeof key !== "string" ||
        !/^[a-f0-9]{64}$/.test(key) ||
        (aggregate &&
          (manifest.formatVersion !== 3 ||
            !Number.isInteger(reference.offset) ||
            reference.offset! < 0 ||
            reference.offset! % 1112 !== 0))
      )
        throw new Error("Invalid parameter reference");
      const path = aggregate ? "lineage-parameters.f32" : parameterPath(key),
        file = files.get(path);
      const data =
        aggregate && file
          ? file.subarray(reference.offset!, reference.offset! + 1112)
          : file;
      if (
        !data ||
        data.length !== 1112 ||
        (aggregate && file!.length % 1112 !== 0)
      )
        throw new Error("Missing or truncated parameter data");
      used.add(path);
      if (aggregate) offsets.add(reference.offset!);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength),
        p = new Float32Array(278);
      for (let i = 0; i < 278; i++) p[i] = view.getFloat32(i * 4, true);
      if (!p.every(Number.isFinite) || parameterHash(p) !== key)
        throw new Error("Invalid parameter checksum");
      return { $evo: "float32le", bytes: Array.from(data) };
    }
    return value;
  };
  const raw = JSON.parse(strFromU8(files.get("session.json")!), revive);
  if ("lineage" in raw)
    throw new Error("Lineage must use the version-three archive record");
  if (manifest.kind === "lineage") {
    const lineage = files.get("lineage.json");
    if (!lineage) throw new Error("Missing lineage archive record");
    used.add("lineage.json");
    raw.lineage = JSON.parse(strFromU8(lineage), revive);
    if (
      (raw.lineage.fromGeneration === 0 ? "complete" : "partial") !==
      manifest.ancestry
    )
      throw new Error(
        "Archive ancestry claim does not match retained coverage",
      );
  }
  const aggregate = files.get("lineage-parameters.f32");
  if (aggregate && offsets.size * 1112 !== aggregate.length)
    throw new Error("Unreferenced lineage parameters");
  if (used.size !== files.size)
    throw new Error("Archive contains unreferenced records");
  const session = parseSession(decode(JSON.stringify(raw)));
  if (manifest.formatVersion === 1 && session.comparisons?.length)
    throw new Error("Comparisons require archive version 2");
  return session;
}
