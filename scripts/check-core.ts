import { readdir, readFile } from "node:fs/promises";
for (const entry of await readdir("src/core", { recursive: true })) {
  if (!entry.endsWith(".ts")) continue;
  const source = await readFile(`src/core/${entry}`, "utf8");
  if (
    /from\s+['"](?:react|dexie|node:)|\b(?:window|document|performance|Date|Math\.random|Worker|indexedDB)\b/.test(
      source,
    )
  )
    throw new Error(`Forbidden core dependency: ${entry}`);
}
