/**
 * Route proposals drafted by an AI agent: moving/rotating the proposed
 * geometry on the map and turning a suggestion into template settings.
 * Pure functions.
 */
import type {
  LatLng,
  ProposalSuggestion,
  RouteProposalContent,
} from "@droneroute/shared";
import {
  DEFAULT_CORRIDOR_PARAMS,
  DEFAULT_FACADE_PARAMS,
  DEFAULT_GRID_PARAMS,
  DEFAULT_ORBIT_PARAMS,
  DEFAULT_TOWER_PARAMS,
  boundaryCorners,
  fromLocal,
  toLocal,
  type CorridorParams,
  type FacadeParams,
  type GridParams,
  type OrbitParams,
  type TowerParams,
} from "./templates";

/** How far the user has nudged a proposal from where the agent put it. */
export interface ProposalTransform {
  eastM: number;
  northM: number;
  /** Clockwise rotation about the proposal's pivot, in degrees. */
  rotationDeg: number;
}

export const NO_TRANSFORM: ProposalTransform = {
  eastM: 0,
  northM: 0,
  rotationDeg: 0,
};

/** Every position in a proposal, for bounds and pivot calculations. */
export function proposalPoints(proposal: RouteProposalContent): LatLng[] {
  return [
    ...(proposal.boundary ?? []),
    ...proposal.structures.map((s): LatLng => [s.latitude, s.longitude]),
    ...proposal.alignments.flatMap((a) => a.path),
  ];
}

/** Point the proposal rotates about: the middle of everything it contains. */
export function proposalPivot(proposal: RouteProposalContent): LatLng {
  const points = proposalPoints(proposal);
  if (points.length === 0) {
    const anchor = proposal.site.anchor;
    return anchor ? [anchor.latitude, anchor.longitude] : [0, 0];
  }
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  return [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
  ];
}

/** The proposal with every position moved and rotated by `transform`. */
export function transformProposal<T extends RouteProposalContent>(
  proposal: T,
  transform: ProposalTransform,
): T {
  const { eastM, northM, rotationDeg } = transform;
  if (eastM === 0 && northM === 0 && rotationDeg === 0) return proposal;

  const pivot = proposalPivot(proposal);
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const move = (points: LatLng[]): LatLng[] =>
    fromLocal(
      toLocal(points, pivot).map(([x, y]): [number, number] => [
        // Clockwise rotation in an east/north frame, then the offset
        x * cos + y * sin + eastM,
        -x * sin + y * cos + northM,
      ]),
      pivot,
    );
  const moveOne = (lat: number, lng: number) => move([[lat, lng]])[0];

  return {
    ...proposal,
    site: {
      ...proposal.site,
      anchor: proposal.site.anchor
        ? (() => {
            const [latitude, longitude] = moveOne(
              proposal.site.anchor.latitude,
              proposal.site.anchor.longitude,
            );
            return { latitude, longitude };
          })()
        : undefined,
    },
    boundary: proposal.boundary ? move(proposal.boundary) : undefined,
    structures: proposal.structures.map((s) => {
      const [latitude, longitude] = moveOne(s.latitude, s.longitude);
      return { ...s, latitude, longitude };
    }),
    alignments: proposal.alignments.map((a) => ({ ...a, path: move(a.path) })),
  };
}

/** Template settings a suggestion opens with. */
export type TemplateSeed =
  | { type: "grid"; params: GridParams }
  | { type: "corridor"; params: CorridorParams }
  | { type: "orbit"; params: OrbitParams }
  | { type: "tower"; params: TowerParams }
  | { type: "facade"; params: FacadeParams };

const DEFAULT_STANDOFF_M = 15;
const DEFAULT_FOOTPRINT_RADIUS_M = 10;

/**
 * Turn a suggestion into template settings, filling anything the agent left
 * out with the template's defaults. Returns null when the suggestion's
 * target is missing from the proposal.
 */
export function suggestionToSeed(
  proposal: RouteProposalContent,
  suggestion: ProposalSuggestion,
): TemplateSeed | null {
  const overlaps = {
    ...(suggestion.sideOverlap !== undefined
      ? { sideOverlap: suggestion.sideOverlap }
      : {}),
    ...(suggestion.forwardOverlap !== undefined
      ? { forwardOverlap: suggestion.forwardOverlap }
      : {}),
  };

  switch (suggestion.kind) {
    case "grid": {
      const boundary = proposal.boundary;
      if (!boundary || boundary.length < 3) return null;
      return {
        type: "grid",
        params: {
          ...DEFAULT_GRID_PARAMS,
          ...boundaryCorners(boundary),
          boundary,
          mode: "photogrammetry",
          altitude: suggestion.altitudeM ?? DEFAULT_GRID_PARAMS.altitude,
          crossHatch: suggestion.crossHatch ?? false,
          ...overlaps,
        },
      };
    }

    case "corridor": {
      const alignment = proposal.alignments.find(
        (a) => a.id === suggestion.targetId,
      );
      if (!alignment) return null;
      return {
        type: "corridor",
        params: {
          ...DEFAULT_CORRIDOR_PARAMS,
          path: alignment.path,
          widthM: alignment.widthM ?? DEFAULT_CORRIDOR_PARAMS.widthM,
          altitude: suggestion.altitudeM ?? DEFAULT_CORRIDOR_PARAMS.altitude,
          ...overlaps,
        },
      };
    }

    case "facade": {
      const alignment = proposal.alignments.find(
        (a) => a.id === suggestion.targetId,
      );
      if (!alignment) return null;
      const minAltitude =
        suggestion.minAltitudeM ?? DEFAULT_FACADE_PARAMS.minAltitude;
      return {
        type: "facade",
        params: {
          ...DEFAULT_FACADE_PARAMS,
          point1: alignment.path[0],
          point2: alignment.path[alignment.path.length - 1],
          distanceM: suggestion.standoffM ?? DEFAULT_FACADE_PARAMS.distanceM,
          minAltitude,
          maxAltitude: Math.max(
            minAltitude + 5,
            suggestion.maxAltitudeM ?? DEFAULT_FACADE_PARAMS.maxAltitude,
          ),
        },
      };
    }

    case "orbit":
    case "tower": {
      const structure = proposal.structures.find(
        (s) => s.id === suggestion.targetId,
      );
      if (!structure) return null;
      const center: [number, number] = [
        structure.latitude,
        structure.longitude,
      ];
      const radiusM = Math.round(
        (structure.footprintRadiusM ?? DEFAULT_FOOTPRINT_RADIUS_M) +
          (suggestion.standoffM ?? DEFAULT_STANDOFF_M),
      );
      const height = structure.heightM;

      if (suggestion.kind === "orbit") {
        return {
          type: "orbit",
          params: {
            ...DEFAULT_ORBIT_PARAMS,
            center,
            radiusM,
            // Clear the structure by a margin when its height is known
            altitude:
              suggestion.altitudeM ??
              Math.max(DEFAULT_ORBIT_PARAMS.altitude, (height ?? 0) + 15),
            aim: {
              mode: "structureHeight",
              height: height ? Math.round(height * 5) / 10 : 0,
            },
          },
        };
      }

      const minAltitude =
        suggestion.minAltitudeM ?? DEFAULT_TOWER_PARAMS.minAltitude;
      const maxAltitude = Math.max(
        minAltitude + 5,
        suggestion.maxAltitudeM ??
          (height ? height + 5 : DEFAULT_TOWER_PARAMS.maxAltitude),
      );
      return {
        type: "tower",
        params: {
          ...DEFAULT_TOWER_PARAMS,
          center,
          radiusM,
          minAltitude,
          maxAltitude,
          aim: {
            mode: "structureHeight",
            height:
              Math.round(((height ?? minAltitude + maxAltitude) / 2) * 10) / 10,
          },
        },
      };
    }
  }
}
