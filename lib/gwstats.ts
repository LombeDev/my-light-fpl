/* gwstats.ts: per-player stats for one gameweek, from FPL's live feed. Cached at the edge. */
import { json } from "./fpl";

const FPL = "https://fantasy.premierleague.com/api";
const UA = { "User-Agent": "fpl-site/1.0", Accept: "application/json" };

interface RawLiveEl {
  id: number;
  stats: {
    minutes: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    goals_conceded: number;
    own_goals: number;
    penalties_saved: number;
    penalties_missed: number;
    yellow_cards: number;
    red_cards: number;
    total_points: number;
    bonus: number;
  };
}

export async function gwStats(gw: number): Promise<Response> {
  const res = await fetch(`${FPL}/event/${gw}/live/`, {
    headers: UA,
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) return json({ error: "Stats are not available yet." }, 502);

  const data = (await res.json()) as { elements?: RawLiveEl[] };
  if (!Array.isArray(data.elements)) return json({ error: "Stats are not available yet." }, 502);

  const elements = data.elements.map((el) => ({
    id: el.id,
    minutes: el.stats.minutes,
    gs: el.stats.goals_scored,
    a: el.stats.assists,
    cs: el.stats.clean_sheets,
    gc: el.stats.goals_conceded,
    og: el.stats.own_goals,
    ps: el.stats.penalties_saved,
    pm: el.stats.penalties_missed,
    yc: el.stats.yellow_cards,
    rc: el.stats.red_cards,
    pts: el.stats.total_points,
    bn: el.stats.bonus,
  }));

  return new Response(JSON.stringify({ gw, elements }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
}
