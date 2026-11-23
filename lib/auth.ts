/* auth.ts: team ID login, plus the My team and mini-league lookups. Sessions are signed tokens. */
import { getEntry, json, type Env } from "./fpl";

const enc = new TextEncoder();
const dec = new TextDecoder();
const SESSION_SECONDS = 7 * 24 * 60 * 60;

type Claims = { exp: number; typ: string; id?: string };

const b64u = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const unb64u = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (secret: string) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function sign(claims: Claims, secret: string): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64u(new Uint8Array(sig))}`;
}

async function verify(token: string, secret: string): Promise<Claims | null> {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const claims = JSON.parse(dec.decode(unb64u(body))) as Claims;
    return Date.now() / 1000 < claims.exp ? claims : null;
  } catch {
    return null;
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);
const configured = (env: Env) => !!env.SECRET && env.SECRET.length >= 32;
const bearerOf = (req: Request) => (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

// Team ID login: the ID must belong to a real FPL team, then a session is issued.
export async function login(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return json({ error: "Server misconfigured." }, 500);

  const body = (await request.json().catch(() => ({}))) as { entryId?: unknown };
  const entryId = String(body.entryId ?? "").trim();

  if (!/^\d{1,9}$/.test(entryId)) return json({ error: "Enter a numeric FPL team ID." }, 400);

  const entry = await getEntry(entryId);
  if (!entry) return json({ error: "No FPL team found with that ID." }, 404);

  const token = await sign({ typ: "session", id: entryId, exp: nowSec() + SESSION_SECONDS }, env.SECRET);
  return json({ token, entryId, name: entry.name });
}

export async function me(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return json({ error: "Server misconfigured." }, 500);

  const s = await verify(bearerOf(request), env.SECRET);
  if (!s || s.typ !== "session" || !s.id) return json({ error: "Not signed in." }, 401);

  const entry = await getEntry(s.id);
  if (!entry) return json({ error: "FPL team unavailable." }, 502);

  return json({ entryId: s.id, entry });
}

interface RawEntryLeagues {
  leagues?: {
    classic?: { id: number; name: string; league_type: string; entry_rank: number | null }[];
  };
}

export async function myLeagues(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return json({ error: "Server misconfigured." }, 500);

  const s = await verify(bearerOf(request), env.SECRET);
  if (!s || s.typ !== "session" || !s.id) return json({ error: "Not signed in." }, 401);

  const res = await fetch(`https://fantasy.premierleague.com/api/entry/${s.id}/`, {
    headers: { "User-Agent": "fpl-site/1.0", Accept: "application/json" },
  });
  if (!res.ok) return json({ error: "FPL team unavailable." }, 502);

  const data = (await res.json()) as RawEntryLeagues;
  const leagues = (data.leagues?.classic ?? [])
    .filter((l) => l.league_type !== "s") // system leagues such as "Overall"
    .map((l) => ({ id: l.id, name: l.name, rank: l.entry_rank }));

  return json({ leagues });
}
