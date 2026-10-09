/**
 * Builds the plain-text email body: the AI roast up top, then a clean stat block of the
 * awards, then the season leaderboard when there is one. Plain text so it pastes straight
 * into WhatsApp, with WhatsApp's *bold* on headers, award titles and team names.
 */
import type { WeekAwards } from './awards.js';
import { describeWeeks, SEASON_AWARD_KEYS, SEASON_AWARD_NAMES, type SeasonAwardKey, type SeasonLeaderboard } from './leaderboard.js';

const n = (x: number) => x.toFixed(1);

/**
 * WhatsApp bold. Text that already contains an asterisk is left plain: WhatsApp has no way
 * to escape one, so wrapping it would bold the wrong part.
 */
export function bold(text: string): string {
  return text && !text.includes('*') ? `*${text}*` : text;
}

/** The email subject, with the league name so several leagues' recaps are easy to tell apart. */
export function formatSubject(week: number, leagueName: string): string {
  return `🏈 ${leagueName} — Week ${week} Superlatives`;
}

const AWARD_EMOJI: Record<SeasonAwardKey, string> = {
  juggernaut: '💪',
  corpse: '💀',
  sleepwalker: '😴',
  bonehead: '🤡',
  backedIntoIt: '🍀',
  robbed: '😤',
};

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━';

/** The season leaderboard section: one line per award that has a leader, with ties listed together. */
export function formatLeaderboard(lb: SeasonLeaderboard): string[] {
  const lines = [DIVIDER, bold(`📊 SEASON LEADERBOARD (${describeWeeks(lb.weeks)})`), DIVIDER];
  for (const key of SEASON_AWARD_KEYS) {
    const leader = lb.leaders[key];
    if (!leader) continue;
    lines.push(`${AWARD_EMOJI[key]} ${bold(SEASON_AWARD_NAMES[key])} — ${leader.teams.map(bold).join(', ')} ×${leader.count}`);
  }
  return lines;
}

/** The full email: the roast, this week's awards, then the season leaderboard when there is one. */
export function formatEmailBody(awards: WeekAwards, roast: string, leaderboard?: SeasonLeaderboard): string {
  const a = awards;
  const lines: string[] = [];

  lines.push(roast.trim());
  lines.push('');
  lines.push(DIVIDER);
  lines.push(bold(`🏆 WEEK ${a.week} AWARDS`));
  lines.push(DIVIDER);
  lines.push(`💪 ${bold('The Juggernaut')} — ${bold(a.juggernaut.team)} (${n(a.juggernaut.score)})`);
  lines.push(`💀 ${bold('The Corpse')} — ${bold(a.corpse.team)} (${n(a.corpse.score)})`);
  lines.push(
    `⭐ ${bold('Baller of the Week')} — ${a.ballerOfTheWeek.player}, ${bold(a.ballerOfTheWeek.team)} (${n(a.ballerOfTheWeek.points)})`,
  );
  lines.push(`😴 ${bold('The Sleepwalker')} — ${bold(a.sleepwalker.team)} left ${n(a.sleepwalker.pointsLeft)} on the bench`);
  lines.push(
    `🤡 ${bold('The Bonehead')} — ${bold(a.bonehead.team)}: started ${a.bonehead.started} (${n(a.bonehead.startedPoints)}) over ${a.bonehead.benched} (${n(a.bonehead.benchedPoints)}) at ${a.bonehead.slot}`,
  );
  lines.push(`🍀 ${bold('Backed Into It')} — ${bold(a.backedIntoIt.team)} won with ${n(a.backedIntoIt.score)}`);
  lines.push(`😤 ${bold('Robbed')} — ${bold(a.robbed.team)} lost with ${n(a.robbed.score)}`);

  if (leaderboard) {
    lines.push('');
    lines.push(...formatLeaderboard(leaderboard));
  }

  return lines.join('\n');
}
