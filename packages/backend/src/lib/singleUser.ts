import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { getDb } from "../models/db.js";
import { hashPassword } from "../services/authService.js";

/** Email of the built-in account used when no sign-in is required. */
export const LOCAL_USER_EMAIL = "local@droneroute.local";

/**
 * Single-user mode: a personal self-hosted instance with no sign-in. Everyone
 * who can reach the server works in the same local workspace, so it must only
 * be enabled on instances that are not exposed to other people.
 */
export function isSingleUser(env: NodeJS.ProcessEnv = process.env): boolean {
  const selfHosted = (env.SELF_HOSTED ?? "true") === "true";
  return selfHosted && env.SINGLE_USER === "true";
}

/**
 * Id of the account that owns the local workspace, created on first use.
 * An instance that already has exactly one account keeps using it, so
 * missions saved before single-user mode was switched on stay visible.
 */
export function getLocalUserId(): string {
  const db = getDb();

  const local = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(LOCAL_USER_EMAIL) as { id: string } | undefined;
  if (local) return local.id;

  const others = db
    .prepare("SELECT id FROM users WHERE is_banned = 0 LIMIT 2")
    .all() as { id: string }[];
  if (others.length === 1) return others[0].id;

  const id = uuidv4();
  // Nobody knows this password, so the account can't be used to sign in
  const passwordHash = hashPassword(randomBytes(32).toString("hex"));
  db.prepare(
    "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
  ).run(id, LOCAL_USER_EMAIL, passwordHash);
  return id;
}
