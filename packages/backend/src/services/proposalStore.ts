import { v4 as uuidv4 } from "uuid";
import type {
  RouteProposal,
  RouteProposalContent,
  RouteProposalStatus,
} from "@droneroute/shared";
import { getDb } from "../models/db.js";

/** Pending proposals kept per user; older ones are dropped beyond this. */
const MAX_PROPOSALS_PER_USER = 100;

interface Row {
  id: string;
  payload: string;
  status: RouteProposalStatus;
  created_at: string;
}

function toProposal(row: Row): RouteProposal {
  return {
    ...(JSON.parse(row.payload) as RouteProposalContent),
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function createProposal(
  userId: string,
  content: RouteProposalContent,
): RouteProposal {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO route_proposals (id, user_id, title, payload) VALUES (?, ?, ?, ?)",
  ).run(id, userId, content.title, JSON.stringify(content));

  // Keep the table bounded: an agent stuck in a loop must not fill the disk
  db.prepare(
    `DELETE FROM route_proposals WHERE user_id = ? AND id NOT IN (
       SELECT id FROM route_proposals WHERE user_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?
     )`,
  ).run(userId, userId, MAX_PROPOSALS_PER_USER);

  return getProposal(userId, id)!;
}

export function listProposals(userId: string): RouteProposal[] {
  const rows = getDb()
    .prepare(
      "SELECT id, payload, status, created_at FROM route_proposals WHERE user_id = ? ORDER BY created_at DESC, rowid DESC",
    )
    .all(userId) as Row[];
  return rows.map(toProposal);
}

export function getProposal(userId: string, id: string): RouteProposal | null {
  const row = getDb()
    .prepare(
      "SELECT id, payload, status, created_at FROM route_proposals WHERE id = ? AND user_id = ?",
    )
    .get(id, userId) as Row | undefined;
  return row ? toProposal(row) : null;
}

export function setProposalStatus(
  userId: string,
  id: string,
  status: RouteProposalStatus,
): boolean {
  const result = getDb()
    .prepare(
      "UPDATE route_proposals SET status = ? WHERE id = ? AND user_id = ?",
    )
    .run(status, id, userId);
  return result.changes > 0;
}

export function deleteProposal(userId: string, id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM route_proposals WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return result.changes > 0;
}
