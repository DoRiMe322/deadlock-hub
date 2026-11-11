// Saves a daily copy of the live data to data/snapshot.json.
// The site reads the API directly and only falls back to this file when the API is unreachable.
// Run: node scripts/snapshot.mjs   (GitHub Actions runs it before every deploy and once a day)
import { writeFile, mkdir } from 'node:fs/promises';

const API = 'https://api.deadlock-api.com';
const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const since = now - 7 * DAY;
const REGIONS = ['Europe', 'NAmerica', 'SAmerica', 'Asia', 'Oceania'];

async function get(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(API + path, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      console.warn(path, r.status);
    } catch (e) { console.warn(path, e.message); }
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  throw new Error('Failed: ' + path);
}

const pickImages = (im = {}) => ({
  icon_image_small_webp: im.icon_image_small_webp, icon_hero_card_webp: im.icon_hero_card_webp,
  background_image_webp: im.background_image_webp, name_image: im.name_image,
});

const heroesRaw = await get('/v1/assets/heroes?only_active=true');
const heroes = heroesRaw.map((h) => ({ id: h.id, name: h.name, hero_type: h.hero_type, description: h.description, images: pickImages(h.images) }));

const itemsRaw = await get('/v1/assets/items/by-type/upgrade');
const items = itemsRaw.map((i) => ({ id: i.id, name: i.name, item_slot_type: i.item_slot_type, item_tier: i.item_tier, cost: i.cost, shopable: i.shopable, shop_image_webp: i.shop_image_webp, image_webp: i.image_webp }));

const heroStats = await get(`/v1/analytics/hero-stats?min_unix_timestamp=${since}`);

const itemStats = {};
const builds = {};
for (const h of heroes) {
  try { itemStats[h.id] = (await get(`/v1/analytics/item-stats?hero_id=${h.id}&min_unix_timestamp=${since}`)).filter((s) => s.matches > 200).map((s) => ({ item_id: s.item_id, wins: s.wins, matches: s.matches, avg_buy_time_s: Math.round(s.avg_buy_time_s) })); } catch (e) { console.warn(e.message); }
  try {
    builds[h.id] = (await get(`/v1/builds?hero_id=${h.id}&sort_by=favorites&only_latest=true&limit=3&build_language=English&min_unix_timestamp=${now - 60 * DAY}`)).map((b) => ({
      num_favorites: b.num_favorites,
      hero_build: {
        hero_id: b.hero_build.hero_id, hero_build_id: b.hero_build.hero_build_id, name: b.hero_build.name, last_updated_timestamp: b.hero_build.last_updated_timestamp,
        details: { mod_categories: (b.hero_build.details?.mod_categories || []).map((c) => ({ name: c.name, mods: (c.mods || []).map((m) => ({ ability_id: m.ability_id })) })) },
      },
    }));
  } catch (e) { console.warn(e.message); }
}

const seasons = await get('/v1/assets/ranked-seasons');
const ids = seasons.flatMap((s) => s.intervals || []).map((i) => i.leaderboard_id).filter(Boolean);
const lbIds = ['current', ...ids.slice(-2, -1)];
const leaderboard = {};
for (const id of lbIds) for (const r of REGIONS) {
  const q = id === 'current' ? '' : `?leaderboard_id=${id}`;
  try { leaderboard[`${r}:${id}`] = (await get(`/v1/leaderboard/${r}${q}`)).entries.slice(0, 200).map(({ account_name, rank, top_hero_ids }) => ({ account_name, rank, top_hero_ids })); } catch (e) { console.warn(e.message); }
}

const news = (await get('/v2/patches')).map((n) => ({ ...n, content: String(n.content || '').slice(0, 6000) }));
const mapRaw = await get('/v1/assets/map');
const keep = ['crates', 'tough_crates', 'golden_statues', 'bells', 'healing_snacks', 'bridge_buffs', 'teleporters', 'shops', 'soul_urn_spawns', 'soul_urn_pads', 'unstable_rifts'];
const xy = (e) => ({ left_relative: e.left_relative, top_relative: e.top_relative, kind: e.kind, team: e.team });
const map = {
  images: mapRaw.images, objective_positions: mapRaw.objective_positions,
  neutral_camps: mapRaw.neutral_camps.map((c) => ({ name: c.name, ...xy(c) })),
  entities: Object.fromEntries(keep.map((k) => [k, (mapRaw.entities[k] || []).map(xy)])),
};
const version = await get('/v1/assets/steam-info');

const out = { generated: new Date().toISOString(), since, heroes, items, heroStats, itemStats, builds, seasons: seasons.map((x) => ({ name: x.name, intervals: x.intervals })), leaderboard, news, map, version };
await mkdir('data', { recursive: true });
await writeFile('data/snapshot.json', JSON.stringify(out));
console.log('Saved data/snapshot.json', Math.round(JSON.stringify(out).length / 1024) + ' KB');
