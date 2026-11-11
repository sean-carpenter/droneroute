/**
 * Shape and limits of a route proposal. Proposals come from AI agents, so
 * everything is validated before it is stored or shown.
 */
import * as z from "zod/v4";
import type { RouteProposalContent } from "@droneroute/shared";

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const latLng = z.tuple([latitude, longitude]);
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(1000);
const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "ids use letters, digits, _ and - only");

const structure = z.object({
  id,
  name: shortText,
  latitude,
  longitude,
  heightM: z.number().min(0).max(1000).optional(),
  footprintRadiusM: z.number().min(0.5).max(2000).optional(),
  note: longText.optional(),
});

const alignment = z.object({
  id,
  name: shortText,
  path: z.array(latLng).min(2).max(500),
  widthM: z.number().min(1).max(2000).optional(),
});

const suggestion = z.object({
  kind: z.enum(["grid", "corridor", "orbit", "tower", "facade"]),
  targetId: z.string().min(1).max(40),
  title: shortText,
  rationale: longText,
  altitudeM: z.number().min(5).max(500).optional(),
  sideOverlap: z.number().min(0.1).max(0.95).optional(),
  forwardOverlap: z.number().min(0.1).max(0.95).optional(),
  crossHatch: z.boolean().optional(),
  standoffM: z.number().min(3).max(500).optional(),
  minAltitudeM: z.number().min(2).max(500).optional(),
  maxAltitudeM: z.number().min(2).max(500).optional(),
});

/** Field-by-field schema, also used as the MCP tool's input schema. */
export const proposalShape = {
  title: shortText,
  sourceNote: longText.optional(),
  site: z.object({
    address: z.string().trim().max(300).optional(),
    anchor: z.object({ latitude, longitude }).optional(),
    anchorSource: z.enum(["coordinates", "geocoded", "estimated"]),
  }),
  boundary: z.array(latLng).min(3).max(500).optional(),
  boundaryClosureErrorM: z.number().min(0).max(100000).optional(),
  structures: z.array(structure).max(100).default([]),
  alignments: z.array(alignment).max(50).default([]),
  suggestions: z.array(suggestion).min(1).max(20),
  assumptions: z.array(longText).max(30).default([]),
  warnings: z.array(longText).max(30).default([]),
};

const proposalSchema = z.object(proposalShape);

export type ProposalValidation =
  | { ok: true; proposal: RouteProposalContent }
  | { ok: false; error: string };

/** Validate a proposal, including that every suggestion points at something. */
export function validateProposal(input: unknown): ProposalValidation {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.join(".");
    return {
      ok: false,
      error: `Invalid proposal${where ? ` at ${where}` : ""}: ${issue.message}`,
    };
  }
  const proposal = parsed.data;

  const structureIds = new Set(proposal.structures.map((s) => s.id));
  const alignmentIds = new Set(proposal.alignments.map((a) => a.id));
  if (
    structureIds.size !== proposal.structures.length ||
    alignmentIds.size !== proposal.alignments.length
  ) {
    return { ok: false, error: "Structure and alignment ids must be unique" };
  }

  for (const s of proposal.suggestions) {
    const fail = (need: string): ProposalValidation => ({
      ok: false,
      error: `Suggestion "${s.title}" (${s.kind}) needs ${need}`,
    });
    if (s.kind === "grid") {
      if (s.targetId !== "boundary" || !proposal.boundary) {
        return fail('targetId "boundary" and a boundary polygon');
      }
    } else if (s.kind === "orbit" || s.kind === "tower") {
      if (!structureIds.has(s.targetId)) return fail("the id of a structure");
    } else if (!alignmentIds.has(s.targetId)) {
      return fail("the id of an alignment");
    }
    if (
      s.minAltitudeM !== undefined &&
      s.maxAltitudeM !== undefined &&
      s.minAltitudeM > s.maxAltitudeM
    ) {
      return fail("minAltitudeM to be at most maxAltitudeM");
    }
  }

  if (
    !proposal.boundary &&
    proposal.structures.length === 0 &&
    proposal.alignments.length === 0
  ) {
    return {
      ok: false,
      error: "A proposal needs a boundary, a structure or an alignment",
    };
  }

  return { ok: true, proposal };
}
