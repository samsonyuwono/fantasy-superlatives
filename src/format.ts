import { AWARDS, slotLabel, type AwardKey, type WeekAwards } from './awards.js';
import { describeWeeks, SEASON_AWARD_KEYS, type SeasonLeaderboard } from './leaderboard.js';

const oneDecimal = (x: number) => x.toFixed(1);

/** The email subject, with the league name so several leagues' recaps are easy to tell apart. */
export function formatSubject(week: number, leagueName: string): string {
  return `🏈 ${leagueName} — Week ${week} Superlatives`;
}

const awardLine = (key: AwardKey, detail: string) => `${AWARDS[key].emoji} ${AWARDS[key].name} — ${detail}`;

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━';

/** The season leaderboard section: one line per award that has a leader, with ties listed together. */
export function formatLeaderboard(lb: SeasonLeaderboard): string[] {
  const lines = [DIVIDER, `📊 SEASON LEADERBOARD (${describeWeeks(lb.weeks)})`, DIVIDER];
  for (const key of SEASON_AWARD_KEYS) {
    const leader = lb.leaders[key];
    if (!leader) continue;
    lines.push(awardLine(key, `${leader.teams.join(', ')} ×${leader.count}`));
  }
  return lines;
}

/**
 * The full email: the roast, this week's awards, then the season leaderboard when there is one.
 * Plain text so it pastes straight into WhatsApp.
 */
export function formatEmailBody(awards: WeekAwards, roast: string, leaderboard?: SeasonLeaderboard): string {
  const a = awards;
  const lines: string[] = [];

  lines.push(roast.trim());
  lines.push('');
  lines.push(DIVIDER);
  lines.push(`🏆 WEEK ${a.week} AWARDS`);
  lines.push(DIVIDER);
  lines.push(awardLine('juggernaut', `${a.juggernaut.team} (${oneDecimal(a.juggernaut.score)})`));
  lines.push(awardLine('corpse', `${a.corpse.team} (${oneDecimal(a.corpse.score)})`));
  lines.push(awardLine('ballerOfTheWeek', `${a.ballerOfTheWeek.player}, ${a.ballerOfTheWeek.team} (${oneDecimal(a.ballerOfTheWeek.points)})`));
  lines.push(awardLine('sleepwalker', `${a.sleepwalker.team} left ${oneDecimal(a.sleepwalker.pointsLeft)} on the bench`));
  lines.push(
    awardLine(
      'bonehead',
      `${a.bonehead.team}: started ${a.bonehead.started} (${oneDecimal(a.bonehead.startedPoints)}) over ${a.bonehead.benched} (${oneDecimal(a.bonehead.benchedPoints)}) at ${slotLabel(a.bonehead.slot)}`,
    ),
  );
  lines.push(awardLine('backedIntoIt', `${a.backedIntoIt.team} won with ${oneDecimal(a.backedIntoIt.score)}`));
  lines.push(awardLine('robbed', `${a.robbed.team} lost with ${oneDecimal(a.robbed.score)}`));

  if (leaderboard) {
    lines.push('');
    lines.push(...formatLeaderboard(leaderboard));
  }

  return lines.join('\n');
}
