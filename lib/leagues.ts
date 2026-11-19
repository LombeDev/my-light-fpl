import { json } from "./fpl";

const UA = { "User-Agent": "fpl-site/1.0", Accept: "application/json" };

interface RawStanding {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  total: number;
  event_total: number;
}

interface RawLeague {
  league: { name: string };
  standings: { has_next: boolean; results: RawStanding[] };
}

/** One page of classic league standings, slimmed to the fields the page shows. */
export async function league(id: string, page: number): Promise<Response> {
  const res = await fetch(
    `https://fantasy.premierleague.com/api/leagues-classic/${id}/standings/?page_standings=${page}`,
    { headers: UA, cf: { cacheTtl: 60, cacheEverything: true } },
  );

  if (res.status === 404) return json({ error: "League not found, or it is private." }, 404);
  if (!res.ok) return json({ error: "Standings are not available right now." }, 502);

  const d = (await res.json()) as RawLeague;
  return new Response(
    JSON.stringify({
      league: d.league.name,
      page,
      hasNext: d.standings.has_next,
      results: d.standings.results.map((r) => ({
        entry: r.entry,
        team: r.entry_name,
        manager: r.player_name,
        rank: r.rank,
        total: r.total,
        gw: r.event_total,
      })),
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } },
  );
}
