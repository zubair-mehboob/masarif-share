// Holds encrypted grocery lists while a shopkeeper fills them in. The phones
// encrypt and decrypt; this service only stores opaque text until it expires.

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const ALLOWED_TTL_SECONDS = new Set([3600, 21600, 86400]);
const ID = /^[A-Za-z0-9_-]{22}$/;
const OWNER_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const BLOB = /^[A-Za-z0-9_-]+$/;
// A 200-item list is a few kilobytes; this leaves room and stops bulk storage.
const MAX_BLOB_LENGTH = 64_000;
const MAX_BODY_LENGTH = 70_000;
// Limits per address. Mobile networks put many phones behind one address, so
// these only stop bulk abuse and stay far above what a few shoppers need.
const WRITES_PER_MINUTE = 300;
const CREATES_PER_HOUR = 120;

const PAGE_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-cache",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const fail = (status: number, error: string) => json(status, { error });

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isBlob(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_BLOB_LENGTH &&
    BLOB.test(value)
  );
}

/** The request body as an object, or null when it is too large or not JSON. */
async function readBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_LENGTH) {
    return null;
  }
  const text = await request.text();
  if (text.length > MAX_BODY_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function bearer(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    request.headers.get("Authorization") ?? "",
  );
  return match?.[1] ?? null;
}

/**
 * Counts this write against the caller's address and says whether it is
 * within the limit. An address is stored only as a hash that changes every
 * window, and the rows are removed by the daily cleanup.
 */
async function allowWrite(
  env: Env,
  request: Request,
  kind: "write" | "create",
  now: number,
): Promise<boolean> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const windowMs = kind === "create" ? 3_600_000 : 60_000;
  const limit = kind === "create" ? CREATES_PER_HOUR : WRITES_PER_MINUTE;
  const window = Math.floor(now / windowMs);
  const bucket = await sha256Hex(`${kind}:${window}:${address}`);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(bucket, (window + 1) * windowMs)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

async function createShare(env: Env, request: Request): Promise<Response> {
  const now = Date.now();
  if (!(await allowWrite(env, request, "create", now))) {
    return fail(429, "Too many lists created. Try again later.");
  }
  const body = await readBody(request);
  if (!body) return fail(400, "Invalid request.");
  const { id, ownerToken, ttlSeconds, list } = body;
  if (
    typeof id !== "string" ||
    !ID.test(id) ||
    typeof ownerToken !== "string" ||
    !OWNER_TOKEN.test(ownerToken) ||
    typeof ttlSeconds !== "number" ||
    !ALLOWED_TTL_SECONDS.has(ttlSeconds) ||
    !isBlob(list)
  ) {
    return fail(400, "Invalid request.");
  }
  const expiresAt = now + ttlSeconds * 1000;
  const result = await env.DB.prepare(
    `INSERT INTO shares (id, owner_token_hash, list_blob, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  )
    .bind(id, await sha256Hex(ownerToken), list, expiresAt, now)
    .run();
  if (result.meta.changes !== 1) return fail(409, "That id is already used.");
  return json(201, { id, expiresAt });
}

async function readShare(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT list_blob, fill_blob, list_rev, fill_rev, expires_at
     FROM shares WHERE id = ? AND expires_at > ?`,
  )
    .bind(id, Date.now())
    .first<{
      list_blob: string;
      fill_blob: string | null;
      list_rev: number;
      fill_rev: number;
      expires_at: number;
    }>();
  if (!row) return fail(404, "This list has expired or does not exist.");
  return json(200, {
    list: row.list_blob,
    fill: row.fill_blob,
    listRev: row.list_rev,
    fillRev: row.fill_rev,
    expiresAt: row.expires_at,
  });
}

/** 404 for a missing or expired share, 403 for a wrong owner token, else null. */
async function ownerProblem(
  env: Env,
  request: Request,
  id: string,
  now: number,
): Promise<Response | null> {
  const token = bearer(request);
  const row = await env.DB.prepare(
    "SELECT owner_token_hash FROM shares WHERE id = ? AND expires_at > ?",
  )
    .bind(id, now)
    .first<{ owner_token_hash: string }>();
  if (!row) return fail(404, "This list has expired or does not exist.");
  if (!token || (await sha256Hex(token)) !== row.owner_token_hash) {
    return fail(403, "Only the phone that shared this list can do that.");
  }
  return null;
}

async function replaceList(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  const now = Date.now();
  if (!(await allowWrite(env, request, "write", now))) {
    return fail(429, "Too many changes. Try again in a minute.");
  }
  const problem = await ownerProblem(env, request, id, now);
  if (problem) return problem;
  const body = await readBody(request);
  if (!body || !isBlob(body.list)) return fail(400, "Invalid request.");
  await env.DB.prepare(
    "UPDATE shares SET list_blob = ?, list_rev = list_rev + 1 WHERE id = ? AND expires_at > ?",
  )
    .bind(body.list, id, now)
    .run();
  return json(200, { ok: true });
}

// Anyone holding the link may fill the list; the link itself is the permission.
// What they send is checked for size only, since it is encrypted.
async function replaceFill(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  const now = Date.now();
  if (!(await allowWrite(env, request, "write", now))) {
    return fail(429, "Too many changes. Try again in a minute.");
  }
  const body = await readBody(request);
  if (!body || !isBlob(body.fill)) return fail(400, "Invalid request.");
  const result = await env.DB.prepare(
    "UPDATE shares SET fill_blob = ?, fill_rev = fill_rev + 1 WHERE id = ? AND expires_at > ?",
  )
    .bind(body.fill, id, now)
    .run();
  if (result.meta.changes !== 1) {
    return fail(404, "This list has expired or does not exist.");
  }
  return json(200, { ok: true });
}

async function deleteShare(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  const problem = await ownerProblem(env, request, id, Date.now());
  if (problem) return problem;
  await env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run();
  return json(200, { ok: true });
}

async function page(env: Env, request: Request, path: string): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
  const response = new Response(asset.body, asset);
  for (const [name, value] of Object.entries(PAGE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (pathname === "/api/lists") {
    return method === "POST"
      ? createShare(env, request)
      : fail(405, "Method not allowed.");
  }
  const api = /^\/api\/lists\/([^/]+)(?:\/(list|fill))?$/.exec(pathname);
  if (api) {
    const [, id = "", part] = api;
    if (!ID.test(id)) return fail(404, "This list has expired or does not exist.");
    if (!part && method === "GET") return readShare(env, id);
    if (!part && method === "DELETE") return deleteShare(env, request, id);
    if (part === "list" && method === "PUT") return replaceList(env, request, id);
    if (part === "fill" && method === "PUT") return replaceFill(env, request, id);
    return fail(405, "Method not allowed.");
  }
  if (pathname.startsWith("/api/")) return fail(404, "Not found.");

  if (method !== "GET" && method !== "HEAD") {
    return fail(405, "Method not allowed.");
  }
  // Every list shares one page; the id is read from the address by the page.
  if (/^\/l\/[A-Za-z0-9_-]{22}$/.test(pathname)) {
    return page(env, request, "/list.html");
  }
  if (pathname === "/list.js" || pathname === "/list.css") {
    return page(env, request, pathname);
  }
  return new Response("Masarif list sharing.", {
    status: pathname === "/" ? 200 : 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch {
      return fail(500, "Something went wrong. Try again.");
    }
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM shares WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(now),
    ]);
  },
} satisfies ExportedHandler<Env>;
