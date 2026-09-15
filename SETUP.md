# Adding a league (for friends)

This bot can send a weekly recap for more than one ESPN league. Adding your league doesn't
require writing any code — just send the owner a few values and they'll wire it up.

## What you need to send the owner

1. **Your ESPN league ID** — the number in your league's URL: `.../leagueId=XXXXXX`.
2. **The season year** — the year your season starts (e.g. `2026`).
3. **The Tuesday your Week 1 recap should go out** — the day after Week 1's Monday Night
   Football, in `YYYY-MM-DD` format.
4. **The email address(es)** that should receive the recap (one per person who wants it).
5. **If your league is private**, your ESPN login cookies (see below). If it's public, skip this.

> ⚠️ **About the cookies:** `espn_s2` and `SWID` are cookies from *your own logged-in ESPN
> browser session* — they're not a special "league key," they're tied to your ESPN account.
> Only send them to someone you trust, and only over a private channel (not a group chat).
> The owner uses them only to read your league's box scores; they can't do anything else with
> your account.

### Getting your ESPN cookies (private leagues only)

1. Log into ESPN Fantasy Football in your browser and open your league.
2. Open DevTools (F12 or Cmd+Opt+I) → **Application** (Chrome) or **Storage** (Firefox) tab →
   **Cookies** → `espn.com`.
3. Copy the values of the `espn_s2` and `SWID` cookies (SWID includes the curly braces).

## What the owner does with it

The owner adds one entry to the committed `leagues.json` (see `leagues.json.example` for the
exact shape) with your league id, display name, season dates, and recipient email(s) — none of
that is secret. Then they merge your `espnS2`/`swid` into the single `LEAGUE_SECRETS_JSON`
GitHub Secret, keyed by the same league id. No workflow files, TypeScript, or other code ever
need to change to add a league — only those two edits.

The owner will do a dry run (`tsx src/recap.ts --dry-run --week N` against a past completed
season) to confirm your league's data comes through correctly before your first live Tuesday
send.
