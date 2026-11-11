# Deadlock Hub

A fan hub for Valve's hero shooter Deadlock, built on live data from the open [deadlock-api.com](https://deadlock-api.com). Plain HTML, CSS and JavaScript, no build step.

## What is on the page
- **Home:** the hero of the week (best win rate among heroes in at least 10% of games) on its official art, match counts, the strongest and most picked heroes, the latest posts from Valve.
- **Heroes & builds:** win rate, pick rate, KDA and souls for every hero, filtered by period (7, 14, 30 days or since the last gameplay update), rank and role. Each hero shows the item path from real games (lane, mid, late, with the buy time and win rate of each item) and the three most favourited community builds with their in-game IDs.
- **Leaderboard:** Valve's ranked leaderboard by region, season and hero.
- **News & patches:** official Steam posts and the forum changelog, searchable.
- **Farm & timings:** a game clock, what is up now and what spawns next, a map with every camp, crate, container, Urn spawn and Rift, soul values at the chosen minute, a route for each phase of the match and a table of every timer.

## Where the data comes from
- `app.js` reads deadlock-api.com straight from the browser.
- `scripts/snapshot.mjs` saves a copy to `data/snapshot.json`. GitHub Actions runs it before each deploy and every morning, and the page uses it only when the API does not answer.
- Spawn timers follow deadlock.wiki and the official patch notes (checked 12 November 2026, up to the 11-04-2026 update). They are in `app.js` under `LAYERS`, `MILESTONES`, `PHASES` and `TIMERS`.

## Run it
```bash
npx serve .
```

```bash
node scripts/snapshot.mjs
```

Not affiliated with Valve. Deadlock, its heroes, art and names are trademarks of Valve Corporation.
