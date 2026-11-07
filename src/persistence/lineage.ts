import {
  retainGenome,
  reconstructGenome,
  contentHash,
  validateLineage,
  type LineageBundle,
  type LineageNode,
  type GenomeMetadata,
} from "../core/lineage";
import type { Genome } from "../core/model";
import type { ExperimentCheckpoint } from "../core/evolution";
import type { GenerationCommit } from "../core/experiment";
import type { Replay, SavedSession } from "./model";

export interface LineageQuery {
  ancestorStart?: string;
  childrenOffset?: number;
}
export interface LineageView {
  genome: Genome;
  parent: Genome | null;
  ancestors: GenomeMetadata[];
  nextAncestor: string | null;
  missingAncestor: string | null;
  children: GenomeMetadata[];
  childrenOffset: number;
  childrenCount: number;
  fromGeneration: number;
  totalNodes: number;
  replay: Replay | null;
}
export function sessionGenomes(session: SavedSession) {
  const map = new Map(session.checkpoint.population.map((g) => [g.id, g]));
  for (const r of session.replays) map.set(r.genome.id, r.genome);
  if (session.bookmark)
    map.set(session.bookmark.genome.id, session.bookmark.genome);
  return [...map.values()].sort(
    (a, b) => a.birthGeneration - b.birthGeneration || a.id.localeCompare(b.id),
  );
}
export function initialLineage(session: SavedSession): LineageBundle {
  if (session.lineage) {
    validateLineage(session.lineage, session.checkpoint);
    return structuredClone(session.lineage);
  }
  const nodes = new Map<string, LineageNode>(),
    genomes = new Map<string, Genome>();
  for (const g of sessionGenomes(session)) {
    const parent = genomes.get(g.parentIds[0]);
    nodes.set(
      g.id,
      retainGenome(
        g,
        parent ? { genome: parent, node: nodes.get(parent.id)! } : undefined,
      ),
    );
    genomes.set(g.id, g);
  }
  return {
    version: 1,
    fromGeneration: session.checkpoint.generation,
    nodes: [...nodes.values()],
    generations: [],
  };
}
export function appendLineage(
  bundle: LineageBundle,
  previous: ExperimentCheckpoint,
  commit: GenerationCommit,
): LineageBundle {
  const nodes = new Map(bundle.nodes.map((n) => [n.genome.id, n])),
    parents = new Map(previous.population.map((g) => [g.id, g]));
  for (const g of commit.nextCheckpoint.population) {
    const old = nodes.get(g.id),
      parent = parents.get(g.parentIds[0]);
    if (old) {
      const { parameters, ...metadata } = g;
      void parameters;
      if (contentHash(old.genome) !== contentHash(metadata))
        throw new Error("Conflicting immutable lineage identity");
    } else
      nodes.set(
        g.id,
        retainGenome(
          g,
          parent && nodes.has(parent.id)
            ? { genome: parent, node: nodes.get(parent.id)! }
            : undefined,
        ),
      );
  }
  return {
    ...bundle,
    nodes: [...nodes.values()],
    generations: [
      ...bundle.generations,
      { ...structuredClone(commit.record), commitId: commit.id },
    ],
  };
}
export function lineageView(
  bundle: LineageBundle,
  genomeId: string,
  query: LineageQuery = {},
): LineageView {
  const nodes = new Map(bundle.nodes.map((n) => [n.genome.id, n])),
    lookup = (id: string) => nodes.get(id);
  const genome = reconstructGenome(genomeId, lookup),
    parentId = genome.parentIds[0],
    parent = nodes.has(parentId) ? reconstructGenome(parentId, lookup) : null;
  const ancestors: GenomeMetadata[] = [];
  let cursor: string | undefined = query.ancestorStart ?? parentId,
    missingAncestor: string | null = null;
  while (cursor && ancestors.length < 30) {
    const node = nodes.get(cursor);
    if (!node) {
      missingAncestor = cursor;
      cursor = undefined;
      break;
    }
    ancestors.push(structuredClone(node.genome));
    cursor = node.genome.parentIds[0];
  }
  const children = bundle.nodes
    .filter((n) => n.genome.parentIds[0] === genomeId)
    .sort(
      (a, b) =>
        a.genome.birthGeneration - b.genome.birthGeneration ||
        a.genome.id.localeCompare(b.genome.id),
    );
  const offset = query.childrenOffset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new Error("Invalid lineage page");
  const birth = bundle.generations.find(
      (r) => r.generation === genome.birthGeneration,
    ),
    slot = birth?.populationIds.indexOf(genomeId) ?? -1;
  return structuredClone({
    genome,
    parent,
    ancestors,
    nextAncestor: cursor ?? null,
    missingAncestor,
    children: children.slice(offset, offset + 20).map((n) => n.genome),
    childrenOffset: offset,
    childrenCount: children.length,
    fromGeneration: bundle.fromGeneration,
    totalNodes: bundle.nodes.length,
    replay:
      birth && slot >= 0
        ? {
            generation: birth.generation,
            genome,
            scenarios: birth.scenarios,
            results: birth.trials[slot],
          }
        : null,
  });
}
