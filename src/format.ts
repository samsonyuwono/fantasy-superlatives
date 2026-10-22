import { AWARDS, NOBODY_BLUNDERED_REASON, slotLabel, wholePercent, type AwardKey, type WeekAwards } from './awards.js';
import { describeWeeks, SEASON_AWARD_KEYS, type SeasonLeaderboard } from './leaderboard.js';

const oneDecimal = (points: number) => points.toFixed(1);

/** The email subject, with the league name so several leagues' recaps are easy to tell apart. */
export function formatSubject(week: number, leagueName: string): string {
  return `🏈 ${leagueName} — Week ${week} Superlatives`;
}

const awardLine = (key: AwardKey, detail: string) => `${AWARDS[key].emoji} ${AWARDS[key].name} — ${detail}`;

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━';

/** The season leaderboard section: one line per award that has a leader, with ties listed together. */
export function formatLeaderboard(leaderboard: SeasonLeaderboard): string[] {
  const lines = [DIVIDER, `📊 SEASON LEADERBOARD (${describeWeeks(leaderboard.weeks)})`, DIVIDER];
  for (const key of SEASON_AWARD_KEYS) {
    const leader = leaderboard.leaders[key];
    if (!leader) continue;
    lines.push(awardLine(key, `${leader.teams.join(', ')} ×${leader.count}`));
  }
  return lines;
}

function bonusAwardLines({ heartbreaker, mercyRule, oneManArmy }: WeekAwards): string[] {
  const lines: string[] = [];
  if (heartbreaker) lines.push(awardLine('heartbreaker', `${heartbreaker.team} lost to ${heartbreaker.opponent} by ${oneDecimal(heartbreaker.margin)}`));
  if (mercyRule) lines.push(awardLine('mercyRule', `${mercyRule.team} beat ${mercyRule.opponent} by ${oneDecimal(mercyRule.margin)}`));
  if (oneManArmy) {
    lines.push(
      awardLine('oneManArmy', `${oneManArmy.player} scored ${oneDecimal(oneManArmy.points)} of ${oneManArmy.team}'s ${oneDecimal(oneManArmy.teamScore)} (${wholePercent(oneManArmy.share)})`),
    );
  }
  return lines;
}

/**
 * The full email: the roast, this week's awards, then the season leaderboard when there is one.
 * Plain text so it pastes straight into WhatsApp.
 */
export function formatEmailBody(awards: WeekAwards, roast: string, leaderboard?: SeasonLeaderboard): string {
  const lines: string[] = [];

  lines.push(roast.trim());
  lines.push('');
  lines.push(DIVIDER);
  lines.push(`🏆 WEEK ${awards.week} AWARDS`);
  lines.push(DIVIDER);
  lines.push(awardLine('juggernaut', `${awards.juggernaut.team} (${oneDecimal(awards.juggernaut.score)})`));
  lines.push(awardLine('corpse', `${awards.corpse.team} (${oneDecimal(awards.corpse.score)})`));
  lines.push(awardLine('ballerOfTheWeek', `${awards.ballerOfTheWeek.player}, ${awards.ballerOfTheWeek.team} (${oneDecimal(awards.ballerOfTheWeek.points)})`));
  lines.push(awardLine('sleepwalker', `${awards.sleepwalker.team} left ${oneDecimal(awards.sleepwalker.pointsLeft)} on the bench`));
  lines.push(
    awardLine(
      'bonehead',
      awards.bonehead.teamId === undefined
        ? `nobody: ${NOBODY_BLUNDERED_REASON}`
        : `${awards.bonehead.team}: started ${awards.bonehead.started} (${oneDecimal(awards.bonehead.startedPoints)}) over ${awards.bonehead.benched} (${oneDecimal(awards.bonehead.benchedPoints)}) at ${slotLabel(awards.bonehead.slot)}`,
    ),
  );
  lines.push(awardLine('backedIntoIt', `${awards.backedIntoIt.team} won with ${oneDecimal(awards.backedIntoIt.score)}`));
  lines.push(awardLine('robbed', `${awards.robbed.team} lost with ${oneDecimal(awards.robbed.score)}`));
  lines.push(...bonusAwardLines(awards));

  if (leaderboard) {
    lines.push('');
    lines.push(...formatLeaderboard(leaderboard));
  }

  return lines.join('\n');
}
