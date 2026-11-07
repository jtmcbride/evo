import { test, expect } from "vitest";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { sha256 } from "@noble/hashes/sha2.js";
import { createArchive, readArchive } from "../../src/persistence/archive";
import { parameterHash } from "../../src/core/canonical";
import { savedFixture, nextFixture } from "./fixtures";
const sum = (bytes: Uint8Array) =>
  Array.from(sha256(bytes), (x) => x.toString(16).padStart(2, "0")).join("");
test("portable archive preserves population bits and deterministic continuation", () => {
  const original = savedFixture();
  original.checkpoint.population[0].parameters[0] = -0;
  original.checkpoint.population[0].parameterHash = parameterHash(
    original.checkpoint.population[0].parameters,
  );
  const restored = readArchive(createArchive(original));
  expect(restored).toEqual(original);
  expect(Object.is(restored.checkpoint.population[0].parameters[0], -0)).toBe(
    true,
  );
  expect(nextFixture(restored).commit.id).toBe(nextFixture(original).commit.id);
});
test("rejects damaged, missing, unsupported and truncated records", () => {
  const bytes = createArchive(savedFixture()),
    files = unzipSync(bytes),
    parameter = Object.keys(files).find((k) => k.endsWith(".f32"))!;
  files[parameter][0] ^= 1;
  expect(() => readArchive(zipSync(files))).toThrow("checksum");
  const missing = unzipSync(bytes);
  delete missing[parameter];
  expect(() => readArchive(zipSync(missing))).toThrow();
  const unsupported = unzipSync(bytes),
    manifest = JSON.parse(strFromU8(unsupported["manifest.json"]));
  manifest.engineVersion = "future-engine";
  unsupported["manifest.json"] = strToU8(JSON.stringify(manifest));
  expect(() => readArchive(zipSync(unsupported))).toThrow("Unsupported engine");
  expect(() => readArchive(bytes.subarray(0, bytes.length - 1))).toThrow(
    "incomplete",
  );
});
test("validates binary dimensions and references even when entry checksums match", () => {
  const files = unzipSync(createArchive(savedFixture())),
    parameter = Object.keys(files).find((k) => k.endsWith(".f32"))!,
    manifest = JSON.parse(strFromU8(files["manifest.json"]));
  files[parameter] = new Uint8Array(4);
  const entry = manifest.entries.find(
    (e: { path: string }) => e.path === parameter,
  );
  entry.bytes = 4;
  entry.sha256 = sum(files[parameter]);
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  expect(() => readArchive(zipSync(files))).toThrow("truncated");
});
test("bounds streamed expansion independently of a dishonest original-size header", () => {
  const bytes = zipSync(
      { "manifest.json": new Uint8Array(200000) },
      { level: 9 },
    ),
    view = new DataView(bytes.buffer);
  view.setUint32(22, 0, true);
  expect(() => readArchive(bytes)).toThrow("expanded-size");
  expect(() =>
    readArchive(zipSync({ "../session.json": strToU8("{}") })),
  ).toThrow("Invalid");
});
