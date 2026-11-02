// Build a personal coaching file for one player from the scanned team data.
// Usage: node scripts/player-coach.js "Chay S"
// Writes site/coach/<slug>.json. Reads every data/store/leagues/*/teams/*.json.
const fs = require('fs');
const path = require('path');

const name = process.argv[2];
if (!name) { console.error('Usage: node scripts/player-coach.js "<Player name>"'); process.exit(1); }
const root = path.join(__dirname, '..');
const leaguesDir = path.join(root, 'data/store/leagues');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

const innings = [], bowling = [], fielding = [], teams = new Set(), seen = new Set();
// Fielding credit appears in the opponents' dismissal text: "c Chay S b ...", "run out (Chay S)", "st Chay S b ...".
const fieldRe = new RegExp(`^(c|st)\\s*[†\\u2020]?\\s*${esc(name)}\\s+b\\b|run out \\(([^)]*\\b)?${esc(name)}\\b`, 'i');

for (const lg of fs.readdirSync(leaguesDir)) {
  const tdir = path.join(leaguesDir, lg, 'teams');
  if (!fs.existsSync(tdir)) continue;
  const league = JSON.parse(fs.readFileSync(path.join(leaguesDir, lg, 'league.json'), 'utf8'));
  for (const f of fs.readdirSync(tdir)) {
    const t = JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8'));
    for (const m of Object.values(t.matches)) {
      const bat = (m.batting || []).find(b => same(b.name, name));
      const bowl = (m.bowling || []).find(b => same(b.name, name));
      if (!bat && !bowl) continue;
      const key = `${lg}/${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      teams.add(`${t.team} · ${league.name || league.code}`);
      const ctx = {
        id: m.id, date: m.date, series: m.series, league: league.name || league.code,
        team: t.team, opponent: m.opponent, ground: m.ground, outcome: m.outcome, result: m.result,
        battedFirst: m.battedFirst,
      };
      if (bat) {
        const inn = (m.innings || []).find(i => same(i.team, t.team)) || {};
        innings.push({ ...ctx, r: bat.r, b: bat.b, f: bat.f, s: bat.s, out: bat.out, how: bat.out ? (bat.how || 'other') : null, pos: bat.pos,
          teamRuns: inn.runs ?? null, teamOvers: inn.overs ?? null });
      }
      if (bowl) bowling.push({ ...ctx, balls: bowl.balls, r: bowl.r, w: bowl.w, dots: bowl.dots, wd: bowl.wd, nb: bowl.nb });
      for (const d of m.dismissals || []) {
        if (fieldRe.test(d.text)) fielding.push({ date: m.date, opponent: m.opponent, how: d.how, text: d.text });
      }
    }
  }
}

const byDate = (a, b) => a.date.localeCompare(b.date);
innings.sort(byDate); bowling.sort(byDate); fielding.sort(byDate);
const out = {
  player: name,
  teams: [...teams],
  generatedAt: new Date().toISOString(),
  ballByBall: false,
  innings, bowling, fielding,
};
const dest = path.join(root, 'site/coach', `${slug(name)}.json`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
console.log(`${dest}: ${innings.length} innings, ${bowling.length} bowling, ${fielding.length} fielding`);
