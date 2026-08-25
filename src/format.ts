/**
 * Builds the plain-text email body: the AI roast up top, then a clean stat block of the
 * awards, then a season standings footer. Plain text so it pastes straight into WhatsApp.
 */
import type { WeekAwards } from './awards.js';
import type { StandingRow } from './espn.js';

const n = (x: number) => x.toFixed(1);

export function formatSubject(week: number): string {
  return `🏈 Week ${week} Superlatives`;
}

export function formatEmailBody(awards: WeekAwards, roast: string, standings: StandingRow[]): string {
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

  if (standings.length > 0) {
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('📊 STANDINGS');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━');
    standings.forEach((s, i) => {
      const record = s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
      lines.push(`${i + 1}. ${s.name} (${record}, ${n(s.pointsFor)} PF)`);
    });
  }

  return lines.join('\n');
}
