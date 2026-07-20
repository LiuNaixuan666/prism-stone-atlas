import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

const MAX_PAYLOAD_BYTES = 900_000;

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const row = await env.DB.prepare(
    "SELECT payload, updated_at FROM collection_snapshots WHERE user_email = ?",
  ).bind(user.email.toLocaleLowerCase()).first<{ payload: string; updated_at: string }>();

  if (!row) return Response.json({ snapshot: null });
  try {
    return Response.json({ snapshot: JSON.parse(row.payload), updatedAt: row.updated_at });
  } catch {
    return Response.json({ snapshot: null });
  }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json() as { collection?: unknown; customStones?: unknown; expectedUpdatedAt?: string | null };
  if (!body.collection || typeof body.collection !== "object" || Array.isArray(body.collection) || !Array.isArray(body.customStones)) {
    return Response.json({ error: "Invalid collection snapshot" }, { status: 400 });
  }
  const payload = JSON.stringify({ collection: body.collection, customStones: body.customStones });
  if (new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES) {
    return Response.json({ error: "Collection snapshot is too large" }, { status: 413 });
  }

  const email = user.email.toLocaleLowerCase();
  const current = await env.DB.prepare(
    "SELECT updated_at FROM collection_snapshots WHERE user_email = ?",
  ).bind(email).first<{ updated_at: string }>();
  if (body.expectedUpdatedAt !== undefined && (current?.updated_at ?? null) !== body.expectedUpdatedAt) {
    return Response.json({ error: "Cloud backup changed", updatedAt: current?.updated_at ?? null }, { status: 409 });
  }

  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO collection_snapshots (user_email, payload, version, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(user_email) DO UPDATE SET payload = excluded.payload, version = 1, updated_at = excluded.updated_at`,
  ).bind(email, payload, updatedAt).run();
  return Response.json({ ok: true, updatedAt });
}
