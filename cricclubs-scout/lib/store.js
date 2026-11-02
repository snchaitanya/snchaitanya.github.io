// On-disk cache (data/store) and the JSON the static site reads (site/data).
const fs = require('fs');
const path = require('path');
const { fielding, attachHowOut } = require('./normalize');

const ROOT = path.join(__dirname, '..');
const STORE = process.env.DATA_DIR || path.join(ROOT, 'data', 'store');
const SITE = path.join(ROOT, 'site', 'data');

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const codeKey = c => String(c || '').toLowerCase();
const leagueDir = code => path.join(STORE, 'leagues', codeKey(code));
const leagueFile = code => path.join(leagueDir(code), 'league.json');
const teamFile = (code, team) => path.join(leagueDir(code), 'teams', slug(team) + '.json');
const scoreFile = (code, mid) => path.join(leagueDir(code), 'scorecards', mid + '.json');
const standingsFile = (code, seasonName) => path.join(leagueDir(code), 'standings', slug(seasonName) + '.json');

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function write(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}
function writePretty(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function readLeague(code) { return read(leagueFile(code)); }
function writeLeague(league) { write(leagueFile(league.code), league); }
function readTeam(code, team) { return read(teamFile(code, team)); }
function writeTeam(code, team, data) { write(teamFile(code, team), data); }
function readScore(code, mid) { return read(scoreFile(code, mid)); }
function writeScore(code, mid, data) { write(scoreFile(code, mid), data); }
function writeStandings(code, seasonName, doc) { writePretty(standingsFile(code, seasonName), doc); }
function listStandings(code) {
  const dir = path.join(leagueDir(code), 'standings');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => read(path.join(dir, f))).filter(Boolean);
}

function listLeagues() {
  const dir = path.join(STORE, 'leagues');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => read(path.join(dir, d.name, 'league.json')))
    .filter(Boolean);
}
function listScannedTeams(code) {
  const dir = path.join(leagueDir(code), 'teams');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => read(path.join(dir, f))).filter(t => t && t.team);
}

function teamReport(league, team) {
  const t = readTeam(league.code, team);
  const logos = league.logos || {};
  const out = { team, logo: logos[team] || null, logos, league: { code: league.code, name: league.name }, seasons: {}, matches: [] };
  for (const k of ['current', 'last']) {
    const s = league.seasons[k]; if (!s) continue;
    const st = t && t.series[s.id];
    out.seasons[k] = { id: s.id, name: s.name, inSeason: !!(s.teams && s.teams[team]), scrapedAt: st ? st.scrapedAt : null };
    if (st) for (const id of st.matchIds) {
      const m = t.matches[id]; if (!m) continue;
      attachHowOut(m, readScore(league.code, id));
      out.matches.push(m);
    }
  }
  out.matches.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  out.unresolvedFielders = fielding(out.matches);
  out.matches.forEach(m => delete m.dismissals);
  return out;
}

function publicLeague(league, scanned) {
  const seasons = {};
  for (const [k, s] of Object.entries(league.seasons || {})) {
    seasons[k] = { id: s.id, name: s.name, startDate: s.startDate, year: s.year, teamCount: Object.keys(s.teams || {}).length };
  }
  return { code: league.code, name: league.name, checkedAt: league.checkedAt, seasons, teams: league.teams || [], logos: league.logos || {}, scanned };
}

function publish() {
  const siteLeagues = path.join(SITE, 'leagues');
  fs.rmSync(siteLeagues, { recursive: true, force: true });
  const index = { generatedAt: new Date().toISOString(), leagues: [] };
  for (const league of listLeagues()) {
    const scanned = listScannedTeams(league.code).map(t => t.team).filter(n => (league.teams || []).includes(n)).sort((a, b) => a.localeCompare(b));
    const pub = publicLeague(league, scanned);
    writePretty(path.join(SITE, 'leagues', codeKey(league.code), 'league.json'), pub);
    for (const doc of listStandings(league.code)) {
      if (!doc.series || !doc.series.name) continue;
      writePretty(path.join(SITE, 'leagues', codeKey(league.code), 'standings', slug(doc.series.name) + '.json'), doc);
    }
    for (const name of scanned) {
      writePretty(path.join(SITE, 'leagues', codeKey(league.code), 'teams', slug(name) + '.json'), teamReport(league, name));
    }
    index.leagues.push(pub);
  }
  index.leagues.sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.code).localeCompare(String(b.code)));
  writePretty(path.join(SITE, 'index.json'), index);
  return index;
}

module.exports = {
  ROOT, STORE, SITE, slug, codeKey,
  readLeague, writeLeague, readTeam, writeTeam, readScore, writeScore, writeStandings, listStandings,
  listLeagues, listScannedTeams, teamReport, publish
};
