# 🏈 Fantasy Superlatives

An automated weekly recap agent for an ESPN fantasy football league. Every **Tuesday morning**
during the regular season (**Weeks 1–14**), it reads the just-completed week from ESPN, computes
a set of custom awards, has **Claude** write a short punchy roast, and **emails it to you** so you
can paste it into your league's WhatsApp group chat.

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

## How it works

```
ESPN box scores ──► awards.ts (pure logic) ──► Claude roast ──► Resend email ──► your inbox ──► WhatsApp
```

- `src/awards.ts` — pure, unit-tested award logic (no network).
- `src/espn.ts` — fetches + normalizes one week from ESPN.
- `src/roast.ts` — Claude writes the prose from a fixed fact sheet (it can't invent numbers).
- `src/format.ts` / `src/emailer.ts` — build the plain-text body and send it via Resend.
- `src/week.ts` — derives the current NFL week and enforces the Weeks 1–14 gate.
- `.github/workflows/weekly-recap.yml` — the Tuesday cron.

## Setup

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Gather your credentials (into `.env`)

- **ESPN cookies (`ESPN_S2`, `ESPN_SWID`)** — private leagues require these. Log in at
  fantasy.espn.com, open DevTools → Application → Cookies → `espn.com`, and copy the values of
  `espn_s2` and `SWID` (keep the `{ }` braces on SWID).
- **`LEAGUE_ID`** — from your league URL: `...?leagueId=123456`.
- **`SEASON_YEAR`** — the year the season starts (e.g. `2026`).
- **`SEASON_WEEK1_TUESDAY`** — the Tuesday you want the Week 1 recap (the day after Week 1's
  Monday Night Football). Everything else is derived from this.
- **`RESEND_API_KEY`** — free from [resend.com](https://resend.com). On the free tier, keep
  `EMAIL_FROM=onboarding@resend.dev` and set `RECIPIENT_EMAIL` to the address you signed up with.
- **`ANTHROPIC_API_KEY`** — your personal key from
  [console.anthropic.com](https://console.anthropic.com). `ANTHROPIC_MODEL` defaults to
  `claude-sonnet-5-5`.

### 3. Test locally

```bash
npm test                              # run the unit tests
npx tsx src/recap.ts --week 1 --dry-run   # print the recap for a week (real ESPN data, no email)
npx tsx src/recap.ts --week 1             # actually send one email via Resend
```

> Tip: run a `--dry-run` against a recent completed week to confirm your cookies + award output
> look right before you wire up the schedule.

## Deploy (GitHub Actions cron)

The repo lives in your **personal** GitHub account.

```bash
# One-time: make sure gh is logged into the right account
gh auth login                         # choose github.com, log in as samsonyuwono
gh auth switch --user samsonyuwono

# Create the private repo and push
gh repo create samsonyuwono/fantasy-superlatives --private --source=. --push

# Add every config value as a repository secret
gh secret set ESPN_S2               --body "..."
gh secret set ESPN_SWID             --body "{...}"
gh secret set LEAGUE_ID             --body "123456"
gh secret set SEASON_YEAR           --body "2026"
gh secret set SEASON_WEEK1_TUESDAY  --body "2026-09-15"
gh secret set ANTHROPIC_API_KEY     --body "sk-ant-..."
gh secret set ANTHROPIC_MODEL       --body "claude-sonnet-5-5"
gh secret set RESEND_API_KEY        --body "re_..."
gh secret set EMAIL_FROM            --body "onboarding@resend.dev"
gh secret set RECIPIENT_EMAIL       --body "you@example.com"

# Validate the whole pipeline on demand (bypasses the week gate)
gh workflow run "Weekly Superlatives Recap" -f week=1
```

### The 9am ET trigger

GitHub's built-in scheduler routinely starts runs 4–6 hours late, so the on-time send comes from
[cron-job.org](https://cron-job.org), which calls this workflow's dispatch API every Tuesday at
**9:00 America/New_York** (DST handled). Dispatch runs start immediately. The workflow's own
`schedule` (11am ET) is only a fallback: its guard job skips it if a "Weekly recap (9am trigger)"
run already happened that day, so you never get two emails. The script gates itself to Weeks 1–14,
so both triggers can stay enabled year-round.

One-time setup:

1. **GitHub token** — github.com/settings/personal-access-tokens → fine-grained, repository
   `samsonyuwono/fantasy-superlatives` only, permission **Actions: Read and write**. Note the
   expiry and renew it before then (if it lapses, the fallback still sends, just late).
2. **cron-job.org job** — schedule Tuesdays 09:00, time zone `America/New_York`:
   - `POST https://api.github.com/repos/samsonyuwono/fantasy-superlatives/actions/workflows/weekly-recap.yml/dispatches`
   - Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
     `X-GitHub-Api-Version: 2022-11-28`
   - Body: `{"ref":"main","inputs":{"source":"external-9am"}}` (GitHub replies `204`)
   - Enable failure notifications.

To simulate the 9am trigger by hand: `gh workflow run weekly-recap.yml -f source=external-9am -f week=N`.
