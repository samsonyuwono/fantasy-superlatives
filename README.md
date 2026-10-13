# 🏈 Fantasy Superlatives

An automated weekly recap agent for ESPN fantasy football leagues. Every **Tuesday at 9am ET**
during the regular season (**Weeks 1–14**), it reads the just-completed week from ESPN for each
configured league, computes a set of custom awards, has **Claude** write a short punchy roast, and
**emails it** to that league's recipients so they can paste it into the league's group chat.

## The awards

| Award | Meaning |
|---|---|
| 💪 **The Juggernaut** | Highest team score of the week |
| 💀 **The Corpse** | Lowest team score of the week |
| ⭐ **Baller of the Week** | Highest-scoring individual starter, league-wide |
| 😴 **The Sleepwalker** | Most points left on the bench (optimal lineup − actual) |
| 🤡 **The Bonehead** | Worst single start/sit — the biggest one-player swap regret |
| 🍀 **Backed Into It** | Luckiest win (won the matchup, but would've beaten the fewest teams) |
| 😤 **Robbed** | Unluckiest loss (lost the matchup, but would've beaten the most teams) |

Below the weekly awards, a **season leaderboard** shows which team has won each award most often so far
(Baller of the Week is left out, since it's about one player). The roast can call back to it ("third Corpse this season").

## How it works

```
leagues.json ─► for each league: ESPN box scores ─► awards.ts ─► Claude roast ─► Resend email
```

- `src/recap.ts`: the entrypoint. Runs every league independently, so one failing league never blocks the others. Each failure emails `OWNER_ALERT_EMAIL`.
- `src/config.ts`: loads `leagues.json` and matches each league with its cookies in `LEAGUE_SECRETS_JSON`.
- `src/espn.ts`: fetches and normalizes one week from ESPN, including each league's own lineup slots.
- `src/awards.ts`: pure, unit-tested award logic (no network).
- `src/leaderboard.ts`: tallies the awards over Weeks 1..N, which are fetched again on each run since nothing is stored. If an earlier week won't load, the recap goes out without it and `OWNER_ALERT_EMAIL` gets a note.
- `src/roast.ts`: Claude writes the prose from a fixed fact sheet. `ROAST_PIPELINE` picks how:
  - `off`: one Claude call.
  - `shadow` (the default): sends that one call's roast, and also runs the pipeline below and logs what it would have sent.
  - `on`: the pipeline. An analyst picks storylines, a writer drafts, and each draft must pass a code check (`src/factcheck.ts`: every number is in the fact sheet and every award is named) and a Claude checker (`src/agents.ts`). A rejected draft goes back to the writer with the issues, up to 3 drafts. If all fail, the single-call roast is sent.
  In CI it's a repo variable: `gh variable set ROAST_PIPELINE --body on`, or `off` to roll back.
- `src/format.ts` / `src/emailer.ts`: build the plain-text body and send it via Resend.
- `src/week.ts`: works out the week from each league's `seasonWeek1Tuesday` and enforces the Weeks 1–14 gate.
- `src/guard.ts`: stops the fallback schedule from sending twice (see [the 9am trigger](#the-9am-et-trigger)).

## Setup

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Configure leagues (`leagues.json`, committed)

Each league is one entry. Nothing in it is secret; see `leagues.json.example` for the shape.

| Field | Meaning |
|---|---|
| `id` | Short key you choose (e.g. `main`). It links the league to its cookies in `LEAGUE_SECRETS_JSON`. |
| `displayName` | Name shown in the email subject. |
| `leagueId` | ESPN league ID, from the league URL: `...?leagueId=123456`. |
| `seasonYear` | The year the season starts, e.g. `2026`. |
| `seasonWeek1Tuesday` | The Tuesday the Week 1 recap goes out (the day after Week 1's Monday Night Football), as `YYYY-MM-DD`. |
| `recipientEmails` | Who gets this league's recap. |
| `requiresAuth` | Optional. Set it to `false` for a public league, which then needs no cookies. |

To add a friend's league, see [`SETUP.md`](SETUP.md). No code changes are needed.

### 3. Fill in secrets (`.env`, never committed)

| Variable | Where to get it |
|---|---|
| `LEAGUE_SECRETS_JSON` | ESPN cookies for every private league, keyed by league `id`: `{"main":{"espnS2":"...","swid":"{...}"}}`. Log in at fantasy.espn.com, open DevTools → Application → Cookies, and copy `espn_s2` and `SWID` (keep the `{ }` braces). The cookies belong to an ESPN account, so every league you're in uses the same pair. In `.env`, wrap the JSON in single quotes. |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com). |
| `ANTHROPIC_MODEL` | Optional. Defaults to `claude-sonnet-5-5`. |
| `RESEND_API_KEY` | [resend.com](https://resend.com) (free). |
| `EMAIL_FROM` | Optional. Defaults to `onboarding@resend.dev`. On Resend's free tier it can only send to the address you signed up with. |
| `OWNER_ALERT_EMAIL` | Where failure alerts go (you, not the league). |

### 4. Test locally

```bash
npm test                                   # unit tests
npm run typecheck
npx tsx src/recap.ts --week 4 --dry-run    # real ESPN + Claude, prints instead of emailing
npx tsx src/recap.ts --week 4              # actually emails every league's recipients
```

Every variable above must be set even for `--dry-run`. Run a dry run against a recent completed
week to confirm your cookies and award output before relying on the schedule.

## Deploy (GitHub Actions)

The weekly run happens on GitHub Actions (`.github/workflows/weekly-recap.yml`), using
**repository secrets**, not your local `.env`. The two don't sync, and GitHub secrets can't be read
back, so set them again whenever a value changes:

```bash
gh secret set LEAGUE_SECRETS_JSON    # paste the JSON (no outer quotes)
gh secret set ANTHROPIC_API_KEY
gh secret set ANTHROPIC_MODEL        # optional
gh secret set RESEND_API_KEY
gh secret set EMAIL_FROM             # optional
gh secret set OWNER_ALERT_EMAIL

# Run the whole pipeline on demand (a week number bypasses the Weeks 1–14 gate)
gh workflow run weekly-recap.yml -f week=4
```

ESPN cookies expire from time to time. If a run fails on ESPN auth, refresh
`LEAGUE_SECRETS_JSON` both locally and in GitHub. To catch this early, `cookie-check.yml` runs every
Monday during the season (`src/cookie-check.ts`). It asks ESPN for each league's settings and sends
one email to `OWNER_ALERT_EMAIL` listing any league that failed. Run it by hand with
`npx tsx src/cookie-check.ts --dry-run --force`, or `gh workflow run cookie-check.yml -f force=true`. `keepalive.yml` pushes a small monthly commit so
GitHub doesn't disable the scheduled workflow after 60 days of inactivity.

### The 9am ET trigger

GitHub's built-in scheduler routinely starts runs 4–6 hours late, so the on-time send comes from
[cron-job.org](https://cron-job.org), which calls this workflow's dispatch API every Tuesday at
**9:00 America/New_York** (DST handled). Dispatch runs start immediately. The workflow's own
`schedule` (11am ET) is only a fallback: its guard step (`src/guard.ts`) skips it if a
"Weekly recap (9am trigger)" run already happened that day, so nobody gets two emails. The script
limits itself to Weeks 1–14, so both triggers can stay enabled year-round.

One-time setup:

1. **GitHub token.** Go to github.com/settings/personal-access-tokens and create a fine-grained
   token with access to this repository only and the permission **Actions: Read and write**. Note
   the expiry and renew it before then. If it lapses, the fallback still sends, just late.
2. **cron-job.org job.** Custom schedule `0 9 * * 2`, time zone `America/New_York`:
   - `POST https://api.github.com/repos/<owner>/<repo>/actions/workflows/weekly-recap.yml/dispatches`
   - Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
     `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`
   - Body: `{"ref":"main","inputs":{"source":"external-9am"}}`
   - Enable failure notifications.

   A successful **Test run** returns `204` and starts a real run (which emails everyone).
   For a private repo, `404` means the token can't see the repo, and `422` means the body or
   `Content-Type` is wrong.

To simulate the 9am trigger by hand: `gh workflow run weekly-recap.yml -f source=external-9am -f week=N`.
