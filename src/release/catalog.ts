import { z } from "zod";

export const exampleManifest = z
  .object({
    formatVersion: z.literal(1),
    suiteId: z.literal("benchmark-open-v1"),
    run: z.number().int().min(0).max(19),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    selectionRule: z.string().min(1).max(300),
    generatedRuntime: z
      .object({
        userAgent: z.string().max(1000),
        platform: z.string().max(100),
      })
      .strict(),
    examples: z
      .array(
        z
          .object({
            id: z.enum(["initial", "final"]),
            title: z.string().min(1).max(80),
            description: z.string().min(1).max(500),
            file: z.string().regex(/^[a-z0-9-]+\.evolab$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            generation: z.number().int().min(0).max(199),
            validationMean: z.number().finite().min(0).max(48),
          })
          .strict(),
      )
      .length(2),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.examples.map((e) => e.id)).size !== 2 ||
      new Set(value.examples.map((e) => e.file)).size !== 2
    )
      ctx.addIssue({
        code: "custom",
        message: "Examples must have distinct identities and files",
      });
  });
export type ExampleManifest = z.infer<typeof exampleManifest>;
export async function fetchExampleManifest(): Promise<ExampleManifest> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}examples/manifest.json`,
  );
  if (!response.ok)
    throw new Error(`Example catalog unavailable (${response.status})`);
  const text = await response.text();
  if (text.length > 64 * 1024) throw new Error("Example catalog too large");
  return exampleManifest.parse(JSON.parse(text));
}
export async function fetchExampleArchive(
  example: ExampleManifest["examples"][number],
): Promise<File> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}examples/${example.file}`,
  );
  if (!response.ok)
    throw new Error(`Example download failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 32 * 1024 * 1024)
    throw new Error("Example exceeds archive size limit");
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== example.sha256)
    throw new Error("Example checksum mismatch; reload the catalog and retry");
  return new File([bytes], example.file, { type: "application/zip" });
}
