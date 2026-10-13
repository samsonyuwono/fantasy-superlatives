# Fantasy Superlatives

Personal project. Every Tuesday it emails a recap of the past NFL week for each of my ESPN fantasy leagues: seven computed awards plus a short Claude-written roast. I paste it into the league WhatsApp groups.

## Map
- `src/recap.ts`: the entrypoint. Runs each league in `leagues.json` independently; one league failing never blocks another, and each failure emails `OWNER_ALERT_EMAIL`.
- Pipeline: `espn.ts` (the only module that talks to ESPN) → `awards.ts` (pure logic) → `leaderboard.ts` (season tally; there's no storage, so each run fetches Weeks 1..N again, and a failure here sends the recap without it) → `roast.ts` (Claude writes the roast from a fixed fact sheet; the agent pipeline is described at the top of the file) → `format.ts` / `emailer.ts` (Resend).
- `config.ts`: joins the committed `leagues.json` (non-secret) with the `LEAGUE_SECRETS_JSON` env var (ESPN cookies, keyed by league `id`).
- `week.ts`: the week number comes from each league's `seasonWeek1Tuesday`; sends are limited to Weeks 1–14.
- `guard.ts`: dedupe logic for the fallback schedule (see below).
- `cookie-check.ts`: Monday check (`cookie-check.yml`) that ESPN still accepts each league's cookies. It sends one combined alert to `OWNER_ALERT_EMAIL`.
- `SETUP.md`: how to onboard a friend's league. `FEATURE_IDEAS.md`: backlog.

## Verify
- `npm test`, then `npm run typecheck`.
- `npx tsx src/recap.ts --week N --dry-run`: real ESPN data and a real Claude call, but prints instead of emailing. It still needs every env var, including `RESEND_API_KEY` and `OWNER_ALERT_EMAIL`. Leave off `--dry-run` only when I ask, because it emails real people.

## Things the code won't tell you
- **Production runs on GitHub Actions, not locally.** The on-time 9am ET Tuesday send comes from a **cron-job.org** job that calls the workflow dispatch API with `source=external-9am`. GitHub's own cron started runs 4–6 hours late, so its schedule in `weekly-recap.yml` is only a fallback, and `guard.ts` skips it if the 9am run already happened. Don't "fix" timing by editing the cron. Check cron-job.org and its GitHub token (fine-grained, Actions read/write, it expires) first.
- **Secrets live in two places that don't sync.** Local `.env` is for dev only. CI uses GitHub repo secrets, which can't be read back; update them with `gh secret set`. If local works but CI fails (or the reverse), suspect secret drift or expired ESPN cookies (`espn_s2`/`SWID`) first.
- **`LEAGUE_SECRETS_JSON` keys must match each league's `id` in `leagues.json`**, not its `displayName`. The cookies belong to an ESPN account, not a league, so leagues I'm in share the same cookies. A friend's league uses their cookies.
- **Every league can have a different lineup** (kicker or not, number of FLEX slots, and so on). Lineup slots come from each league's ESPN settings at runtime (`lineupSlotsFromCounts` in `espn.ts`). ESPN labels FLEX as `RB/WR/TE`. Never hardcode a lineup shape or assume one league's format. Test lineup-sensitive awards (Sleepwalker, Bonehead) against several shapes.
- **`ROAST_PIPELINE` (off | shadow | on) is a repo *variable*, not a secret**, so `gh variable set ROAST_PIPELINE --body on` flips it with no deploy. Unset means `shadow`: the single-call roast is sent and the pipeline's roast and trace only go to the Actions log. `off` is the instant rollback.
- `keepalive.yml` pushes a monthly commit so GitHub doesn't disable the scheduled workflow. Those `chore: keepalive` commits are expected.

## Working rules
- Never commit or push without my explicit OK for that specific change. `main` is live, since the Tuesday run uses it.
- Use Conventional Commits with a meaningful scope or none, e.g. `ci(schedule): ...`.
- Use the `gh` CLI for GitHub.
