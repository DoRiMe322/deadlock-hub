'use strict';
/* Deadlock Hub: reads live data from the open deadlock-api.com and falls back to
   data/snapshot.json (saved daily by GitHub Actions) when the API cannot be reached. */

const API = 'https://api.deadlock-api.com';
const DAY = 86400;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
function img(src, alt = '', cls) { const i = el('img', cls); i.loading = 'lazy'; i.decoding = 'async'; i.alt = alt; if (src) i.src = src; return i; }
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const k = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n));
const clock = (min) => { const s = Math.round(min * 60); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const dateFmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const now = () => Math.floor(Date.now() / 1000);

/* ---------- data access ---------- */
let snapPromise = null;
const snapshot = () => (snapPromise ||= fetch('data/snapshot.json').then((r) => r.ok ? r.json() : null).catch(() => null));
const cache = new Map();
let usedSnapshot = false;

async function api(path, fromSnap) {
  if (cache.has(path)) return cache.get(path);
  const p = (async () => {
    try {
      const r = await fetch(API + path, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { data: await r.json(), live: true };
    } catch (e) {
      const s = await snapshot();
      const data = s && fromSnap ? fromSnap(s) : null;
      if (data) { usedSnapshot = true; setLive(s); }
      cache.delete(path);
      return { data, live: false };
    }
  })();
  cache.set(path, p);
  return p;
}

function setLive(s) {
  const live = $('#live');
  if (usedSnapshot && s) {
    live.dataset.state = 'snapshot';
    live.lastElementChild.textContent = 'Saved ' + dateFmt(s.generated);
    live.title = 'The live API did not answer, so this page shows the copy saved on ' + dateFmt(s.generated);
    $('#footData').textContent = 'Some data on this page comes from the copy saved on ' + dateFmt(s.generated) + ', because the live API did not answer.';
  } else {
    live.dataset.state = 'live';
    live.lastElementChild.textContent = 'Live data';
    live.title = 'Data read from deadlock-api.com just now';
  }
}

/* ---------- reference data ---------- */
const H = { list: [], byId: {}, items: {}, news: [], version: null, seasons: [] };

function heroFrom(h) {
  const im = h.images || {};
  return {
    id: h.id, name: h.name, type: h.hero_type || '',
    role: h.description?.role || '', play: h.description?.playstyle || '',
    icon: im.icon_image_small_webp || im.icon_image_small, card: im.icon_hero_card_webp || im.icon_hero_card,
    bg: im.background_image_webp || im.background_image,
  };
}
function itemFrom(i) { return { id: i.id, name: i.name, slot: i.item_slot_type, tier: i.item_tier, cost: i.cost, shop: i.shopable !== false, img: i.shop_image_webp || i.image_webp || i.shop_image || i.image }; }

async function loadBase() {
  const [heroes, items] = await Promise.all([
    api('/v1/assets/heroes?only_active=true', (s) => s.heroes),
    api('/v1/assets/items/by-type/upgrade', (s) => s.items),
  ]);
  H.list = (heroes.data || []).filter((h) => !h.disabled && !h.in_development).map(heroFrom).sort((a, b) => a.name.localeCompare(b.name));
  H.list.forEach((h) => { H.byId[h.id] = h; });
  (items.data || []).forEach((i) => { H.items[i.id] = itemFrom(i); });
}

/* ---------- hero statistics ---------- */
function periodStart(period) {
  if (period === 'patch') {
    const big = H.news.find((n) => /gameplay update/i.test(n.title)) || H.news.find((n) => /update/i.test(n.title));
    return big ? Math.floor(new Date(big.pub_date).getTime() / 1000) : now() - 7 * DAY;
  }
  return now() - (+period || 7) * DAY;
}
const statFilters = () => ({ period: $('#fPeriod').value, rank: $('#fRank').value });
function statQuery(f, extra = '') {
  let q = `min_unix_timestamp=${Math.floor(periodStart(f.period) / 3600) * 3600}`;
  if (f.rank) q += `&min_average_badge=${f.rank}`;
  return q + extra;
}
const isDefault = (f) => f.period === '7' && !f.rank;

async function heroStats(f) {
  const r = await api('/v1/analytics/hero-stats?' + statQuery(f), isDefault(f) ? (s) => s.heroStats : (s) => s.heroStats);
  const rows = r.data || [];
  const total = rows.reduce((a, x) => a + x.matches, 0) / 12;
  const out = {};
  rows.forEach((x) => {
    out[x.hero_id] = {
      matches: x.matches, wr: x.wins / x.matches, pick: total ? x.matches / total : 0,
      kda: (x.total_kills + x.total_assists) / Math.max(1, x.total_deaths),
      k: x.total_kills / x.matches, d: x.total_deaths / x.matches, a: x.total_assists / x.matches,
      nw: x.total_net_worth / x.matches, dmg: x.total_player_damage / x.matches, lh: x.total_last_hits / x.matches,
    };
  });
  return { byHero: out, total, live: r.live, approx: !r.live && !isDefault(f) };
}

/* ---------- routing ---------- */
const views = $$('[data-view]');
function route() {
  const [name, arg] = (location.hash.replace('#', '') || 'home').split('/');
  const v = views.find((x) => x.dataset.view === name) ? name : 'home';
  views.forEach((x) => { x.hidden = x.dataset.view !== v; });
  $$('[data-nav]').forEach((a) => { if (a.dataset.nav === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (v === 'heroes') Heroes.open(arg ? +arg : null);
  if (v === 'players') Players.open();
  if (v === 'news') News.open();
  if (v === 'timings') Timings.open();
  if (v !== 'home' || !arg) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}
window.addEventListener('hashchange', route);

/* ---------- team colour ---------- */
function team(id) {
  document.documentElement.dataset.team = id;
  $('#amber').setAttribute('aria-pressed', String(id === 'amber'));
  $('#sapphire').setAttribute('aria-pressed', String(id === 'sapphire'));
  try { localStorage.setItem('dh-team', id); } catch (e) { /* private mode */ }
}
$('#amber').addEventListener('click', () => team('amber'));
$('#sapphire').addEventListener('click', () => team('sapphire'));
try { const t = localStorage.getItem('dh-team'); if (t) team(t); } catch (e) { /* private mode */ }

/* ---------- home ---------- */
const Home = {
  async render() {
    const st = await heroStats({ period: '7', rank: '' });
    const rows = H.list.filter((h) => st.byHero[h.id]).map((h) => ({ h, s: st.byHero[h.id] }));
    const strong = rows.filter((x) => x.s.pick >= 0.1).sort((a, b) => b.s.wr - a.s.wr);
    const star = strong[0];
    if (star) {
      const art = $('#stageArt');
      art.onload = () => art.classList.add('on');
      art.src = star.h.bg;
      const f = $('#feature');
      f.href = '#heroes/' + star.h.id;
      f.replaceChildren(img(star.h.icon, ''), el('small', '', 'Hero of the week'));
      const b = el('b'); b.append(star.h.name + ' · ', Object.assign(el('em'), { textContent: pct(star.s.wr) }), ' win rate in ' + k(star.s.matches) + ' matches');
      f.append(b);
    }
    const stats = $('#stats');
    stats.replaceChildren();
    const latest = H.news[0];
    [[k(st.total), 'matches in the last 7 days'], [String(H.list.length), 'heroes in the game'],
      [H.version ? new Date(H.version.version_datetime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—', 'latest game build'],
      [latest ? new Date(latest.pub_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—', latest ? latest.title.trim() : 'latest post']]
      .forEach(([b, s]) => { const d = el('div', 'stat'); d.append(el('b', '', b), el('span', '', s)); stats.append(d); });

    const list = (target, arr, val, cls) => {
      const ol = $(target); ol.replaceChildren();
      arr.slice(0, 5).forEach((x, i) => {
        const li = el('li'), a = el('a'); a.href = '#heroes/' + x.h.id;
        a.append(el('span', 'n', String(i + 1)), img(x.h.icon, ''), el('span', '', x.h.name), el('span', 'v ' + cls, val(x.s)));
        li.append(a); ol.append(li);
      });
    };
    list('#topWin', strong, (s) => pct(s.wr), '');
    list('#topPick', [...rows].sort((a, b) => b.s.pick - a.s.pick), (s) => 'in ' + pct(s.pick, 0) + ' of games', 'p');
    const hn = $('#homeNews'); hn.replaceChildren(...H.news.filter((n) => n.source === 'steam').slice(0, 3).map((n) => News.card(n, false)));
  },
};

/* ---------- heroes ---------- */
const Heroes = {
  sel: null, sort: 'wr', stats: null, ready: false,
  async open(id) {
    if (!this.ready) this.init();
    if (id && H.byId[id]) this.sel = id;
    await this.refresh();
  },
  init() {
    this.ready = true;
    ['#fPeriod', '#fRank'].forEach((s) => $(s).addEventListener('change', () => this.refresh()));
    ['#fRole', '#fSearch'].forEach((s) => $(s).addEventListener('input', () => this.rail()));
    $$('.rail__sort button').forEach((b) => b.addEventListener('click', () => {
      this.sort = b.dataset.sort;
      $$('.rail__sort button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      this.rail();
    }));
  },
  async refresh() {
    const f = statFilters();
    $('#rail').replaceChildren(el('div', 'skeleton'));
    this.stats = await heroStats(f);
    const start = new Date(periodStart(f.period) * 1000);
    $('#heroNote').textContent = (this.stats.approx
      ? 'The live API did not answer, so these are the saved numbers for the last 7 days at all ranks. '
      : '') + k(this.stats.total) + ' public matches since ' + dateFmt(start) + (f.rank ? ', ' + $('#fRank').selectedOptions[0].text.toLowerCase() : ', all ranks') + '. Data from deadlock-api.com.';
    if (!this.sel) {
      const best = H.list.filter((h) => this.stats.byHero[h.id]?.pick >= 0.1).sort((a, b) => this.stats.byHero[b.id].wr - this.stats.byHero[a.id].wr)[0];
      this.sel = (best || H.list[0])?.id;
    }
    this.rail();
    this.detail();
  },
  rail() {
    const q = $('#fSearch').value.trim().toLowerCase(), role = $('#fRole').value, st = this.stats.byHero;
    const list = H.list.filter((h) => (!q || h.name.toLowerCase().includes(q)) && (!role || h.type === role));
    list.sort((a, b) => this.sort === 'name' ? a.name.localeCompare(b.name) : this.sort === 'pick' ? (st[b.id]?.pick || 0) - (st[a.id]?.pick || 0) : (st[b.id]?.wr || 0) - (st[a.id]?.wr || 0));
    const box = $('#rail'); box.replaceChildren();
    if (!list.length) box.append(el('p', 'empty', 'No hero matches this search.'));
    list.forEach((h) => {
      const s = st[h.id];
      const b = el('button', 'hr'); b.type = 'button';
      if (h.id === this.sel) b.setAttribute('aria-current', 'true');
      const wr = el('span', 'wr ' + (s && s.wr >= 0.5 ? 'up' : 'down'), s ? pct(s.wr) : '—');
      const sub = el('span', 'sub'), bar = el('span', 'bar'), fill = el('i');
      fill.style.width = s ? Math.min(100, s.pick * 200) + '%' : '0';
      bar.append(fill); sub.append(el('span', '', s ? 'picked ' + pct(s.pick, 0) : 'no data'), bar);
      b.append(img(h.icon, ''), el('span', 'nm', h.name), wr, sub);
      b.addEventListener('click', () => { this.sel = h.id; history.replaceState(null, '', '#heroes/' + h.id); this.rail(); this.detail(); if (innerWidth < 1000) $('#hero').scrollIntoView({ behavior: 'smooth' }); });
      box.append(b);
    });
  },
  async detail() {
    const h = H.byId[this.sel]; if (!h) return;
    const s = this.stats.byHero[h.id];
    const root = $('#hero'); root.replaceChildren();
    const ban = el('div', 'banner'), bg = img(h.bg, '', 'bg'); bg.loading = 'eager';
    const inn = el('div', 'banner__in');
    inn.append(el('span', 'role', h.type || 'Hero'), el('h3', '', h.name));
    if (h.role) inn.append(el('p', '', h.role + (h.play ? '. ' + h.play : '')));
    ban.append(bg, inn); root.append(ban);

    const kp = el('div', 'kpis');
    const kpi = (b, t, cls) => { const d = el('div', 'kpi'); const v = el('b', cls || '', b); d.append(v, el('span', '', t)); kp.append(d); };
    if (s) {
      kpi(pct(s.wr), 'win rate', s.wr >= 0.5 ? 'up' : 'down');
      kpi(pct(s.pick, 0), 'of games have ' + h.name);
      kpi(s.kda.toFixed(2), `KDA (${s.k.toFixed(1)} / ${s.d.toFixed(1)} / ${s.a.toFixed(1)})`);
      kpi(k(s.nw), 'souls per game');
      kpi(k(s.matches), 'games played');
    } else kpi('—', 'no games in this period');
    root.append(kp);

    const path = el('section', 'block'), ph = el('div', 'block__head');
    ph.append(el('h4', '', 'Item path from real games'), el('span', 'note', 'Items in at least 12% of ' + h.name + ' games, by when they are bought. Win rate is for games where the item was bought.'));
    const cols = el('div', 'phasecols'); cols.append(el('div', 'skeleton'), el('div', 'skeleton'), el('div', 'skeleton'));
    path.append(ph, cols); root.append(path);

    const bl = el('section', 'block'), bh = el('div', 'block__head');
    const bnote = el('span', 'note', 'Most favourited English builds. Find them in game under Builds by their ID.');
    bh.append(el('h4', '', 'Top community builds'), bnote);
    const bwrap = el('div', 'builds'); bwrap.append(el('div', 'skeleton'));
    bl.append(bh, bwrap); root.append(bl);

    const id = h.id, f = statFilters();
    const [is, bd] = await Promise.all([
      api(`/v1/analytics/item-stats?hero_id=${id}&` + statQuery(f), (sn) => sn.itemStats?.[id]),
      this.fetchBuilds(id),
    ]);
    if (this.sel !== id) return;
    this.itemPath(cols, is.data || [], s);
    this.builds(bwrap, bd.data || [], h);
    if (this.buildsSince) bnote.textContent = 'Most favourited English builds updated since ' + dateFmt(this.buildsSince * 1000) + '. Find them in game under Builds by their ID.';
  },
  async fetchBuilds(id) {
    const q = (days) => `/v1/builds?hero_id=${id}&sort_by=favorites&only_latest=true&limit=6&build_language=English&min_unix_timestamp=${Math.floor((now() - days * DAY) / DAY) * DAY}`;
    for (const days of [30, 60]) {
      const r = await api(q(days), (sn) => sn.builds?.[id]);
      if (!r.live) { this.buildsSince = null; return r; }
      const good = (r.data || []).filter((b) => (b.num_favorites || 0) >= 5);
      if (good.length >= 3 || days === 60) { this.buildsSince = now() - days * DAY; return { ...r, data: (good.length ? good : r.data || []).slice(0, 3) }; }
    }
  },
  itemPath(cols, rows, s) {
    cols.replaceChildren();
    const heroGames = s?.matches || Math.max(1, ...rows.map((r) => r.matches));
    const list = rows.map((r) => ({ r, it: H.items[r.item_id] })).filter((x) => x.it && x.it.slot && x.it.shop !== false && x.r.matches / heroGames >= 0.12);
    const phases = [['Lane', 'before 10:00', (t) => t < 600], ['Mid game', '10 to 20 min', (t) => t >= 600 && t < 1200], ['Late game', 'after 20 min', (t) => t >= 1200]];
    phases.forEach(([name, sub, fn]) => {
      const col = el('div', 'phasecol'); col.append(el('h5', '', name + ' · ' + sub));
      const items = list.filter((x) => fn(x.r.avg_buy_time_s)).sort((a, b) => b.r.matches - a.r.matches).slice(0, 7).sort((a, b) => a.r.avg_buy_time_s - b.r.avg_buy_time_s);
      if (!items.length) col.append(el('p', 'note', 'No common items here.'));
      items.forEach(({ r, it }) => {
        const row = el('div', 'item'), ic = el('span', 'ic slot-' + it.slot); ic.append(img(it.img, ''));
        const mid = el('div'); mid.append(el('b', '', it.name), el('small', '', `~${clock(r.avg_buy_time_s / 60)} · in ${pct(r.matches / heroGames, 0)} of games`));
        const wr = r.wins / r.matches, diff = s ? wr - s.wr : 0;
        const right = el('div', 'r ' + (wr >= 0.5 ? 'up' : 'down'), pct(wr)); right.append(el('small', 'note', (diff >= 0 ? '+' : '') + (diff * 100).toFixed(1)));
        row.append(ic, mid, right); col.append(row);
      });
      cols.append(col);
    });
    if (!list.length) cols.replaceChildren(el('p', 'empty', 'Not enough games with these filters to show an item path. Try a longer period or all ranks.'));
  },
  builds(wrap, rows, h) {
    wrap.replaceChildren();
    if (!rows.length) { wrap.append(el('p', 'empty', 'No recent English builds for ' + h.name + '.')); return; }
    const catName = (n) => {
      const m = /#Citadel_HeroBuilds_(\w+)/.exec(n || '');
      if (!m) return (n || '').trim() || 'Items';
      const key = m[1].replace(/Game$/, '');
      return { Early: 'Early game', Lane: 'Lane', Mid: 'Mid game', Late: 'Late game' }[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2');
    };
    rows.forEach((b) => {
      const hb = b.hero_build, card = el('article', 'build'), top = el('div', 'build__top');
      top.append(el('h5', '', hb.name.trim()), el('span', 'build__meta', `★ ${k(b.num_favorites || 0)} · updated ${dateFmt(hb.last_updated_timestamp * 1000)} · ID ${hb.hero_build_id}`));
      card.append(top);
      const names = [];
      (hb.details?.mod_categories || []).forEach((c) => {
        const mods = (c.mods || []).map((m) => H.items[m.ability_id]).filter(Boolean);
        if (!mods.length) return;
        const row = el('div', 'cat'), icons = el('div', 'icons');
        mods.forEach((it) => { const ic = el('span', 'ic slot-' + it.slot); ic.title = it.name; ic.append(img(it.img, it.name)); icons.append(ic); names.push(it.name); });
        row.append(el('b', '', catName(c.name)), icons); card.append(row);
      });
      const cp = el('button', 'copy', 'Copy item list'); cp.type = 'button';
      cp.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(`${h.name}: ${hb.name.trim()} (build ID ${hb.hero_build_id})\n${[...new Set(names)].join(', ')}`); cp.textContent = 'Copied'; } catch (e) { cp.textContent = 'Copy failed'; }
        setTimeout(() => { cp.textContent = 'Copy item list'; }, 1600);
      });
      card.append(cp); wrap.append(card);
    });
  },
};

/* ---------- leaderboard ---------- */
const REGIONS = [['Europe', 'Europe'], ['NAmerica', 'North America'], ['SAmerica', 'South America'], ['Asia', 'Asia'], ['Oceania', 'Oceania']];
const Players = {
  region: 'Europe', shown: 100, rows: [], ready: false,
  async open() {
    if (!this.ready) await this.init();
    this.load();
  },
  async init() {
    this.ready = true;
    const chips = $('#regions');
    REGIONS.forEach(([id, name]) => {
      const b = el('button', 'chip', name); b.type = 'button'; b.setAttribute('aria-pressed', String(id === this.region));
      b.addEventListener('click', () => { this.region = id; $$('#regions .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); this.load(); });
      chips.append(b);
    });
    const hs = $('#fLbHero'); H.list.forEach((h) => { const o = el('option', '', h.name); o.value = h.id; hs.append(o); });
    const seasons = await api('/v1/assets/ranked-seasons', (s) => s.seasons);
    H.seasons = seasons.data || [];
    const ss = $('#fSeason');
    const ints = H.seasons.flatMap((s) => (s.intervals || []).map((i) => ({ name: s.name, ...i }))).filter((i) => i.leaderboard_id);
    const t = now();
    ints.sort((a, b) => b.start_timestamp - a.start_timestamp).forEach((i, n) => {
      const cur = i.start_timestamp <= t && t < i.end_timestamp;
      const o = el('option', '', i.name + (cur ? ' (current)' : ' (final)')); o.value = cur ? '' : i.leaderboard_id; o.dataset.start = i.start_timestamp; o.dataset.min = '';
      if (i.start_timestamp <= t) ss.append(o);
    });
    if (!ss.options.length) { const o = el('option', '', 'Current season'); o.value = ''; ss.append(o); }
    [ss, hs].forEach((s) => s.addEventListener('change', () => this.load()));
    $('#fPlayer').addEventListener('input', () => { this.shown = 100; this.draw(); });
    $('#lbMore').addEventListener('click', () => { this.shown += 100; this.draw(); });
  },
  async load() {
    const season = $('#fSeason').value, hero = $('#fLbHero').value;
    $('#lbBody').replaceChildren(); $('#podium').replaceChildren(el('div', 'skeleton'), el('div', 'skeleton'), el('div', 'skeleton'));
    const path = `/v1/leaderboard/${this.region}${hero ? '/' + hero : ''}${season ? '?leaderboard_id=' + season : ''}`;
    const r = await api(path, hero ? null : (s) => s.leaderboard?.[`${this.region}:${season || 'current'}`]);
    this.rows = Array.isArray(r.data) ? r.data : r.data?.entries || [];
    this.shown = 100;
    const opt = $('#fSeason').selectedOptions[0];
    const region = REGIONS.find((x) => x[0] === this.region)[1];
    let note = `${this.rows.length} ranked players in ${region}${hero ? ' for ' + H.byId[hero]?.name : ''}, from Valve's official leaderboard.`;
    if (!season && this.rows.length < 100 && opt) note += ` ${opt.textContent.replace(' (current)', '')} began on ${dateFmt(+opt.dataset.start * 1000)} and players appear after enough ranked wins, so the table is still filling up. Switch to the previous season for the final standings.`;
    $('#lbNote').textContent = note;
    this.draw();
  },
  heroesCell(ids) {
    const d = el('div', 'heroes');
    (ids || []).slice(0, 3).forEach((id) => { const h = H.byId[id]; if (!h) return; const a = el('a'); a.href = '#heroes/' + id; a.append(img(h.icon, ''), h.name); d.append(a); });
    if (!d.childNodes.length) d.append(el('span', 'note', '—'));
    return d;
  },
  draw() {
    const q = $('#fPlayer').value.trim().toLowerCase();
    const rows = this.rows.filter((r) => !q || String(r.account_name || '').toLowerCase().includes(q));
    const pod = $('#podium'); pod.replaceChildren();
    if (!q) rows.slice(0, 3).forEach((r) => {
      const h = H.byId[(r.top_hero_ids || [])[0]], c = el('div', 'pod');
      if (h) c.append(img(h.bg, '', 'bg'));
      c.append(el('span', 'place', '#' + r.rank), el('b', '', r.account_name || 'Unknown'), el('small', '', h ? 'Mostly ' + (r.top_hero_ids || []).map((id) => H.byId[id]?.name).filter(Boolean).join(', ') : 'No main hero listed'));
      pod.append(c);
    });
    const tb = $('#lbBody'); tb.replaceChildren();
    if (!rows.length) { const tr = el('tr'), td = el('td', 'note', 'No players here yet.'); td.colSpan = 3; tr.append(td); tb.append(tr); }
    rows.slice(0, this.shown).forEach((r) => {
      const tr = el('tr'), t2 = el('td'); t2.append(el('b', '', r.account_name || 'Unknown'));
      const t3 = el('td'); t3.append(this.heroesCell(r.top_hero_ids));
      tr.append(el('td', 'n', String(r.rank)), t2, t3); tb.append(tr);
    });
    $('#lbMore').hidden = rows.length <= this.shown;
  },
};

/* ---------- news ---------- */
const News = {
  src: 'all', ready: false,
  parse(n) {
    if (n._text !== undefined) return n;
    const doc = new DOMParser().parseFromString(n.content || '', 'text/html');
    $$('br', doc).forEach((b) => b.replaceWith('\n'));
    $$('p,li,div,h1,h2,h3', doc).forEach((b) => b.append('\n'));
    const im = $('img', doc);
    n._img = im ? im.getAttribute('src') : null;
    n._text = (doc.body.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return n;
  },
  card(n, full = true) {
    this.parse(n);
    const a = el('article', 'ncard'), pic = el('div', 'ncard__img');
    const fallback = H.list.length ? H.list[Math.abs([...n.title].reduce((x, c) => x * 31 + c.charCodeAt(0), 7)) % H.list.length].bg : '';
    const src = n._img || fallback;
    if (src) pic.style.backgroundImage = `url("${encodeURI(src).replace(/"/g, '%22')}")`;
    pic.append(el('span', '', n.source === 'steam' ? 'Steam news' : 'Patch notes'));
    const inn = el('div', 'ncard__in');
    inn.append(el('span', 'date', dateFmt(n.pub_date)), el('h3', '', n.title.trim()), el('p', '', n._text.slice(0, 320)));
    if (full && n._text.length > 320) {
      const d = el('details'); d.append(el('summary', '', 'Read here'), el('div', 'full', n._text.slice(0, 5000)));
      inn.append(d);
    }
    const link = el('a', 'open', n.source === 'steam' ? 'Open on Steam' : 'Open the forum post'); link.href = n.link; link.target = '_blank'; link.rel = 'noreferrer';
    inn.append(link);
    a.append(pic, inn);
    return a;
  },
  open() {
    if (!this.ready) {
      this.ready = true;
      const chips = $('#newsSrc');
      [['all', 'Everything'], ['steam', 'Steam news'], ['forum', 'Patch notes']].forEach(([id, name]) => {
        const b = el('button', 'chip', name); b.type = 'button'; b.setAttribute('aria-pressed', String(id === this.src));
        b.addEventListener('click', () => { this.src = id; $$('#newsSrc .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); this.draw(); });
        chips.append(b);
      });
      $('#fNews').addEventListener('input', () => this.draw());
    }
    this.draw();
  },
  draw() {
    const q = $('#fNews').value.trim().toLowerCase();
    const list = H.news.filter((n) => (this.src === 'all' || n.source === this.src) && (!q || (n.title + ' ' + this.parse(n)._text).toLowerCase().includes(q)));
    const g = $('#news'); g.replaceChildren(...list.map((n) => this.card(n)));
    if (!list.length) g.append(el('p', 'empty', 'Nothing matches this search.'));
  },
};

/* ---------- farm & timings ---------- */
// Values: deadlock.wiki (checked 12 Nov 2026) cross-checked with official patch notes up to 11-04-2026.
const scale = (base, m) => base * (1 + 0.0108 * m);
const LAYERS = [
  { id: 'weak', name: 'Small camps', c: '#9be37a', s: 11, at: 2, set: (m) => m.neutral_camps.filter((x) => x.kind === 'weak'), tip: 'Small camp: 3 Haunts. First spawn 2:00, back 1:25 after the camp is cleared.' },
  { id: 'medium', name: 'Medium camps', c: '#f2c94c', s: 12, at: 5, set: (m) => m.neutral_camps.filter((x) => x.kind === 'medium'), tip: 'Medium camp. First spawn 5:00, back 4:50 after the camp is cleared. Some hold Sinner’s Sacrifice machines.' },
  { id: 'strong', name: 'Large camps', c: '#f2884b', s: 14, at: 8, set: (m) => m.neutral_camps.filter((x) => x.kind === 'strong'), tip: 'Large camp: three Haunts, at least one Large. First spawn 8:00, back 5:35 after the camp is cleared.' },
  { id: 'vault', name: 'Sinner’s Sacrifice', c: '#e05bd0', s: 12, shape: 'dia', at: 8, set: (m) => m.neutral_camps.filter((x) => x.kind === 'vault'), tip: 'Sinner’s Sacrifice: melee only. First spawn 8:00, back 5:00 after it is broken. Hit the jackpot with a heavy melee for 4 permanent buffs.' },
  { id: 'statues', name: 'Buff containers', c: '#ffe08a', s: 7, shape: 'sq', at: 3, set: (m) => m.entities.golden_statues, tip: 'Buff container: 50% chance of a permanent buff. Most spawn at 3:00 and return 3:00 after breaking; in the tunnels 5:00 / 5:00; above the Mid-Boss pit from 10:00.' },
  { id: 'crates', name: 'Crates', c: '#c49a6c', s: 5, shape: 'sq', at: 3, off: true, set: (m) => m.entities.crates, tip: 'Crate: 60% chance of souls. Most spawn at 3:00 and return 3:00 after breaking.' },
  { id: 'tough', name: 'Tough crates', c: '#3fc1c9', s: 7, shape: 'sq', at: 3, off: true, set: (m) => m.entities.tough_crates, tip: 'Tough crate: needs a heavy melee, always drops souls (twice a crate).' },
  { id: 'snacks', name: 'Healing snacks', c: '#71d07e', s: 8, at: 2.5, set: (m) => m.entities.healing_snacks, tip: 'Healing snack: heals 14% max HP. First at 2:30, back 3:00 after pickup.' },
  { id: 'bridge', name: 'Bridge buffs', c: '#5b9cf0', s: 13, shape: 'dia', at: 5, set: (m) => m.entities.bridge_buffs, tip: 'Bridge buff: spawns at 5:00 and every 5:00 after.' },
  { id: 'urn', name: 'Urn spawns', c: '#ff6b6b', s: 13, shape: 'dia', at: 10, set: (m) => m.entities.soul_urn_spawns, tip: 'Soul Urn: first at 10:00 (always Yellow lane), then every 5:00 in alternating lanes.' },
  { id: 'pads', name: 'Urn drop-offs', c: '#ffffff', s: 11, at: 10, set: (m) => m.entities.soul_urn_pads, tip: 'Urn drop-off: on the opposite side of the map from where the Urn spawned.' },
  { id: 'rift', name: 'Unstable Rift', c: '#b48cff', s: 15, shape: 'dia', at: 10, set: (m) => m.entities.unstable_rifts, tip: 'Unstable Rift: opens on a side-lane bridge around 11:00 (10:00 to 12:00), then every 7:00 ±1.' },
  { id: 'shops', name: 'Shops', c: '#e3a83c', s: 9, shape: 'sq', at: 0, off: true, set: (m) => m.entities.shops, tip: 'Shop.' },
  { id: 'tele', name: 'Teleporters', c: '#9fd8ff', s: 9, at: 0, off: true, set: (m) => m.entities.teleporters, tip: 'Teleporter between the two sides of the map.' },
];

const MILESTONES = [
  [0, 'Trooper waves start', 'Every 30 s until 20:00', '#e3a83c'],
  [2, 'Small camps', 'Back 1:25 after a full clear', '#9be37a'],
  [2.5, 'Healing snacks', 'Back 3:00 after pickup', '#71d07e'],
  [3, 'Crates and buff containers', 'Back 3:00 after breaking', '#ffe08a'],
  [5, 'Medium camps', 'Back 4:50 after a full clear', '#f2c94c'],
  [5, 'Melee trooper joins each wave', '2 ranged, 1 melee, 1 medic', '#e3a83c'],
  [5, 'Tunnel, Bell Tower and Sunken Plaza crates', 'Tunnels back every 5:00', '#c49a6c'],
  [5, 'Bridge buffs', 'Every 5:00', '#5b9cf0'],
  [8, 'Large camps', 'Back 5:35 after a full clear', '#f2884b'],
  [8, 'Sinner’s Sacrifice machines', 'Back 5:00 after breaking', '#e05bd0'],
  [10, 'Soul Urn (Yellow lane)', 'Every 5:00, lanes alternate', '#ff6b6b'],
  [10, 'Buffs reach level 2', 'Stronger permanent buffs', '#ffe08a'],
  [10, 'Containers above the Mid-Boss pit', 'Back 3:00 after breaking', '#ffe08a'],
  [11, 'Unstable Rift (±1 min)', '20 s warning before it opens', '#b48cff'],
  [12, 'Guardians lose their extra resistance', 'Lane guardians are easier to take', '#a99c84'],
  [13, 'Rift bounty starts growing', '+222 souls per minute', '#b48cff'],
  [18, 'Walkers lose their extra resistance', 'Push the Walkers', '#a99c84'],
  [20, 'Trooper waves every 25 s', 'Larger pushes', '#e3a83c'],
  [30, 'Buffs reach level 3', 'Strongest permanent buffs', '#ffe08a'],
  [35, 'Trooper waves every 20 s', 'Late game', '#e3a83c'],
];
for (let t = 15; t <= 45; t += 5) MILESTONES.push([t, 'Soul Urn', t % 10 === 0 ? 'Yellow lane side' : 'Next lane over', '#ff6b6b']);
for (let t = 18; t <= 45; t += 7) MILESTONES.push([t, 'Unstable Rift (±1 min)', 'Roughly every 7 minutes', '#b48cff']);
MILESTONES.sort((a, b) => a[0] - b[0]);

const PHASES = [
  [0, 2, '0:00 to 2:00', 'Lane and last hits', [
    'Last-hit every trooper. Each one is worth 100 souls plus 2 per minute; half drops as a ground orb, half as a floating orb you shoot to confirm.',
    'Kill troopers with a melee hit whenever you can: the whole bounty goes straight to you and the enemy cannot deny it.',
    'Shoot the floating orbs of enemy troopers your opponent kills to deny them.',
    'The Mid-Boss is already up, but it is a team fight for later, not for the first minutes.']],
  [2, 5, '2:00 to 5:00', 'First camps between waves', [
    'Small camps (3 Haunts each) open at 2:00 and come back 1:25 after you clear them: take the one nearest your lane after each wave crashes.',
    'Healing snacks appear at 2:30 and heal 14% of max HP. Use them instead of walking back to base.',
    'From 3:00 crates and buff containers spawn. Break them on your way: crates give souls, containers have a 50% chance of a permanent buff.',
    'Always push the wave before you leave the lane, so you lose nothing while you farm.']],
  [5, 8, '5:00 to 8:00', 'Medium camps and the tunnels', [
    'Medium camps open at 5:00 and come back 4:50 after a full clear. Some include Sinner’s Sacrifice machines that wake up at 8:00.',
    'A melee trooper joins every wave from 5:00, so waves take a little longer to clear.',
    'Crates and containers in the tunnels, on top of the Bell Tower and in Sunken Plaza spawn at 5:00. Tunnel ones return every 5:00.',
    'Bridge buffs appear at 5:00 and then every 5:00. Grab them when you rotate.']],
  [8, 10, '8:00 to 10:00', 'Large camps and Sinner’s Sacrifice', [
    'Large camps open at 8:00 and pay the most per camp: each Large Haunt is worth about 199 souls plus 1% per minute. They come back 5:35 after a clear.',
    'Sinner’s Sacrifice machines open at 8:00 and only take melee damage; each hit costs you 80 HP. When three or fewer bulbs are left, hit while all are lit for the jackpot: one buff on a light melee, four on a heavy melee.',
    'Plan a loop: lane, small camp, medium camp, large camp, back to lane before the next wave.',
    'Save your stamina and HP for the Urn and Rift fights that start at 10:00.']],
  [10, 20, '10:00 to 20:00', 'Urn, Rift and the Mid-Boss', [
    'The Soul Urn lands at 10:00 in Yellow lane and every 5:00 after, alternating lanes. It takes 12.5 s to land. Deliver it to the drop-off on the other side within 45 s or its value starts to decay.',
    'The courier cannot zipline, teleport or parry, and drops the Urn to any enemy melee or stun. Escort it with your team.',
    'The Unstable Rift opens on a side-lane bridge between 10:00 and 12:00 (20 s warning), then about every 7:00. Win the 12 s capture for a team bounty and stronger Rift troopers in that lane.',
    'Take the Mid-Boss after a won fight. It gives 1,500 souls plus 25 per minute and drops 3 Rejuvenator crystals: heavy melee each one. It returns 7:00 after the first kill, then 6:00, then 5:00.',
    'Permanent buffs from containers are level 2 from 10:00. Guardians lose their extra resistance by 12:00.']],
  [20, 45, '20:00 and later', 'Group, push and end', [
    'Waves come every 25 s from 20:00 and every 20 s from 35:00. Shove side lanes with the help of Rift troopers.',
    'Walkers lost their extra resistance at 18:00: take them right after a Mid-Boss or a won Rift.',
    'Containers give level 3 buffs from 30:00. They are still worth a detour when you pass by.',
    'Keep timing the Urn and Rift. A late Urn is worth 250 souls plus 70 per minute, so a 30-minute Urn is about 2,350 souls.',
    'Use a Rejuvenator before you dive the base: it revives you at full HP after 3 s, one per player, valid for 3 minutes.']],
];

const TIMERS = [
  ['Troopers', '0:00', 'Waves every 30 s, 25 s after 20:00, 20 s after 35:00', '100 + 2 / min each', '3 ranged and a medic; a melee trooper replaces one ranged from 5:00. A melee kill gives the full bounty.'],
  ['Small camps', '2:00', '1:25 after a full clear', '45 per Haunt, +1.08% / min', 'Always 3 Haunts.'],
  ['Healing snacks', '2:30', '3:00 after pickup', 'Heals 14% max HP', 'Raised from 10% on 30 Oct 2026.'],
  ['Crates', '3:00', '3:00 after breaking', '23 + 1.8 / min, 60% chance', 'Tunnels 5:00 / 5:00; Bell Tower top and Sunken Plaza 5:00 / 3:00; above the Mid-Boss pit 10:00 / 3:00.'],
  ['Tough crates', '3:00', '3:00 after breaking', '46 + 3.6 / min, always', 'Teal crates, need a heavy melee. Added 29 Sep 2026.'],
  ['Buff containers', '3:00', '3:00 after breaking', '50% chance of a permanent buff', 'Level 1 until 10:00, level 2 until 30:00, then level 3. Same location rules as crates.'],
  ['Medium camps', '5:00', '4:50 after a full clear', '75 per Medium Haunt, +1.08% / min', 'Some include Sinner’s Sacrifice machines.'],
  ['Bridge buffs', '5:00', 'Every 5:00', 'Temporary buff', 'A new one replaces an uncollected one.'],
  ['Large camps', '8:00', '5:35 after a full clear', '199 per Large Haunt, +1.08% / min', 'Three Haunts: three Large, or Large with Medium ones.'],
  ['Sinner’s Sacrifice', '8:00', '5:00 after breaking', '310 + 3.35 / min', 'Melee only, 80 damage back per hit. Jackpot: 1 buff on light melee, 4 on heavy.'],
  ['Mid-Boss', 'Up at start', '7:00, then 6:00, then 5:00', '1,500 + 25 / min', '3 Rejuvenator crystals, 500 + 9 / min each to the breaker. Health 15,600 + 234 / min.'],
  ['Soul Urn', '10:00', 'Every 5:00', '250 + 70 / min', 'Value fixed when it spawns. 4 random buffs to the courier. Decays after 45 s carried.'],
  ['Unstable Rift', '11:00 ±1', '7:00 ±1 after it ends', '1,482 + 222 / min after 13:00', 'Split across the team. Winner gets Rift troopers in that lane. 60 s contested = draw.'],
];

const Timings = {
  ready: false, minute: 0, layers: {}, timer: null,
  async open() {
    if (this.ready) return;
    this.ready = true;
    const r = await api('/v1/assets/map', (s) => s.map);
    this.map = r.data;
    LAYERS.forEach((l) => { this.layers[l.id] = !l.off; });
    this.buildLayers(); this.buildMap(); this.buildStatic();
    $('#minute').addEventListener('input', (e) => this.set(+e.target.value));
    $('#playClock').addEventListener('click', () => this.play());
    this.set(0);
  },
  play() {
    const b = $('#playClock');
    if (this.timer) { clearInterval(this.timer); this.timer = null; b.textContent = 'Play the match'; return; }
    if (this.minute >= 45) this.set(0);
    b.textContent = 'Pause';
    this.timer = setInterval(() => { if (this.minute >= 45) { this.play(); return; } this.set(this.minute + 0.5); }, 500);
  },
  buildLayers() {
    const box = $('#layers'); box.replaceChildren();
    LAYERS.forEach((l) => {
      const n = this.map ? (l.set(this.map) || []).length : 0;
      const lab = el('label', 'layer'), cb = el('input'); cb.type = 'checkbox'; cb.checked = this.layers[l.id];
      cb.addEventListener('change', () => { this.layers[l.id] = cb.checked; this.paint(); });
      const sw = el('i'); sw.style.setProperty('--c', l.c);
      lab.append(cb, sw, el('span', '', l.name), el('small', '', String(n)));
      box.append(lab);
    });
  },
  buildMap() {
    const wrap = $('#map');
    if (!this.map) { wrap.replaceChildren(el('p', 'empty', 'The map could not be loaded.')); return; }
    const mapSrc = this.map.images?.minimap || this.map.images?.plain;
    $('#mapImg').src = mapSrc;
    const tip = $('#tip');
    LAYERS.forEach((l) => (l.set(this.map) || []).forEach((p) => {
      const d = el('button', 'dot' + (l.shape ? ' ' + l.shape : ''));
      d.type = 'button'; d.dataset.layer = l.id;
      d.style.left = (p.left_relative * 100) + '%'; d.style.top = (p.top_relative * 100) + '%';
      d.style.setProperty('--c', l.c); d.style.setProperty('--s', l.s + 'px');
      d.setAttribute('aria-label', l.tip);
      const show = () => {
        const r = d.getBoundingClientRect();
        tip.replaceChildren(el('b', '', l.name), document.createTextNode(l.tip.replace(/^[^:]+: /, '')));
        tip.hidden = false;
        const x = Math.min(innerWidth - 270, r.right + 8), y = Math.max(8, r.top - 10);
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      };
      d.addEventListener('pointerenter', show); d.addEventListener('focus', show); d.addEventListener('click', show);
      d.addEventListener('pointerleave', () => { tip.hidden = true; }); d.addEventListener('blur', () => { tip.hidden = true; });
      wrap.append(d);
    }));
    window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  },
  paint() {
    $$('#map .dot').forEach((d) => {
      const l = LAYERS.find((x) => x.id === d.dataset.layer);
      d.hidden = !this.layers[l.id];
      d.classList.toggle('off', this.minute < l.at);
    });
  },
  buildStatic() {
    const tb = $('#timers'); tb.replaceChildren();
    TIMERS.forEach((row) => { const tr = el('tr'); row.forEach((c) => tr.append(el('td', '', c))); tb.append(tr); });
    const ph = $('#phases'); ph.replaceChildren();
    PHASES.forEach(([a, b, t, h, steps], i) => {
      const c = el('article', 'phase'); c.dataset.i = i;
      const ol = el('ol'); steps.forEach((s) => ol.append(el('li', '', s)));
      c.append(el('span', 't', t), el('h4', '', h), ol); ph.append(c);
    });
  },
  set(m) {
    this.minute = m;
    $('#minute').value = m; $('#mm').textContent = clock(m); $('#soulsAt').textContent = clock(m);
    const up = $('#upNow'); up.replaceChildren();
    const seen = new Set();
    MILESTONES.filter((x) => x[0] <= m).reverse().forEach((x) => {
      const key = x[1].replace(/ \(.*\)/, '');
      if (seen.has(key) || seen.size >= 7) return; seen.add(key);
      const li = el('li'); const i = el('i'); i.style.setProperty('--c', x[3]);
      li.append(i, el('span', '', x[1]), el('small', '', 'since ' + clock(x[0]))); up.append(li);
    });
    const nx = $('#upNext'); nx.replaceChildren();
    MILESTONES.filter((x) => x[0] > m).slice(0, 6).forEach((x) => {
      const li = el('li'); const i = el('i'); i.style.setProperty('--c', x[3]);
      li.append(i, el('span', '', x[1]), el('small', '', 'in ' + clock(x[0] - m))); nx.append(li);
    });
    if (!nx.childNodes.length) nx.append(el('li', 'note', 'Every objective is up. Keep timing the Urn and the Rift.'));
    const urnAt = m >= 10 ? 10 + Math.floor((m - 10) / 5) * 5 : null;
    const S = [
      ['Trooper', 100 + 2 * m, 'each, full value on a melee kill', '#e3a83c'],
      ['Trooper wave', 4 * (100 + 2 * m), '4 troopers', '#e3a83c'],
      ['Small camp', 3 * scale(45, m), '3 Haunts' + (m < 2 ? ', opens at 2:00' : ''), '#9be37a'],
      ['Medium Haunt', scale(75, m), m < 5 ? 'opens at 5:00' : 'per Haunt', '#f2c94c'],
      ['Large camp', 3 * scale(199, m), 'up to, with 3 Large Haunts' + (m < 8 ? ', opens at 8:00' : ''), '#f2884b'],
      ['Sinner’s Sacrifice', 310 + 3.35 * m, m < 8 ? 'opens at 8:00' : 'per machine', '#e05bd0'],
      ['Crate', 23 + 1.8 * m, '60% chance; tough crate ' + Math.round(46 + 3.6 * m), '#c49a6c'],
      ['Soul Urn', urnAt !== null ? 250 + 70 * urnAt : 250 + 70 * 10, urnAt !== null ? 'the Urn that landed at ' + clock(urnAt) : 'first Urn at 10:00', '#ff6b6b'],
      ['Mid-Boss', 1500 + 25 * m, 'team bounty, plus 3 crystals of ' + Math.round(500 + 9 * m), '#a99c84'],
      ['Unstable Rift', 1482 + 222 * Math.max(0, m - 13), m < 10 ? 'first one around 11:00' : 'split across the team', '#b48cff'],
    ];
    const sb = $('#souls'); sb.replaceChildren();
    S.forEach(([n, v, s, c]) => { const d = el('div', 'soul'); d.style.setProperty('--c', c); d.append(el('b', '', Math.round(v).toLocaleString('en-US')), el('span', '', n), el('small', '', s)); sb.append(d); });
    $$('#phases .phase').forEach((c, i) => c.classList.toggle('on', m >= PHASES[i][0] && (m < PHASES[i][1] || i === PHASES.length - 1)));
    this.paint();
  },
};

/* ---------- start ---------- */
(async function start() {
  $('#live').dataset.state = 'loading';
  await loadBase();
  const [news, ver] = await Promise.all([api('/v2/patches', (s) => s.news), api('/v1/assets/steam-info', (s) => s.version)]);
  H.news = (news.data || []).slice().sort((a, b) => new Date(b.pub_date) - new Date(a.pub_date));
  H.version = ver.data;
  if (!usedSnapshot) setLive();
  route();
  Home.render();
})();
