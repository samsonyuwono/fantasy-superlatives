/**
 * Builds the plain-text email body: the AI roast up top, then a clean stat block of the
 * awards. Plain text so it pastes straight into WhatsApp.
 */
import type { WeekAwards } from './awards.js';

const n = (x: number) => x.toFixed(1);

export function formatSubject(week: number, leagueName: string): string {
  return `🏈 ${leagueName} — Week ${week} Superlatives`;
}

export function formatEmailBody(awards: WeekAwards, roast: string): string {
  const a = awards;
  const lines: string[] = [];

  lines.push(roast.trim());
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`🏆 WEEK ${a.week} AWARDS`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`💪 The Juggernaut — ${a.juggernaut.team} (${n(a.juggernaut.score)})`);
  lines.push(`💀 The Corpse — ${a.corpse.team} (${n(a.corpse.score)})`);
  lines.push(`⭐ Baller of the Week — ${a.ballerOfTheWeek.player}, ${a.ballerOfTheWeek.team} (${n(a.ballerOfTheWeek.points)})`);
  lines.push(`😴 The Sleepwalker — ${a.sleepwalker.team} left ${n(a.sleepwalker.pointsLeft)} on the bench`);
  lines.push(
    `🤡 The Bonehead — ${a.bonehead.team}: started ${a.bonehead.started} (${n(a.bonehead.startedPoints)}) over ${a.bonehead.benched} (${n(a.bonehead.benchedPoints)}) at ${a.bonehead.slot}`,
  );
  lines.push(`🍀 Backed Into It — ${a.backedIntoIt.team} won with ${n(a.backedIntoIt.score)}`);
  lines.push(`😤 Robbed — ${a.robbed.team} lost with ${n(a.robbed.score)}`);

  return lines.join('\n');
}
