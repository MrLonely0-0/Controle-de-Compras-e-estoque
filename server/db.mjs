import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
const url = process.env.DATABASE_URL;
if (!url && process.env.NODE_ENV === "production")
  throw new Error("DATABASE_URL é obrigatória em produção");
const pool = url ? new pg.Pool({ connectionString: url }) : null;
pool?.on("error", (e) =>
  console.error("Conexão PostgreSQL ociosa interrompida:", e.message),
);
const demoPath = process.env.DEMO_DB || ".data/demo";
if (!pool && !demoPath.includes("://"))
  await mkdir(dirname(demoPath), { recursive: true });
export const embedded = pool ? null : new PGlite(demoPath);
export const db = pool || embedded;
export const query = (s, p = []) => db.query(s, p);
export async function tx(fn) {
  if (embedded) return embedded.transaction(fn);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
const schema = await readFile(
  new URL("./schema.sql", import.meta.url),
  "utf-8",
);
export const migrate = () =>
  embedded
    ? embedded.exec(schema)
    : tx(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(61320742)");
        await c.query(schema);
      });
export function hash(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verify(password, stored) {
  return timingSafeEqual(
    Buffer.from(hash(password, stored.split(":")[0])),
    Buffer.from(stored),
  );
}
export async function listenChanges(fn) {
  if (embedded) return embedded.listen("changes", fn);
  async function connect() {
    const c = await pool.connect();
    c.on("notification", fn);
    try {
      await c.query("LISTEN changes");
    } catch (e) {
      c.release(e);
      throw e;
    }
    c.once("error", (e) => {
      c.release(e);
      retry();
    });
  }
  function retry() {
    setTimeout(() => connect().then(fn).catch(retry), 2000).unref();
  }
  await connect();
}
