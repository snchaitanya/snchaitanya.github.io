// Scraper CLI. GitHub Actions calls `node cli.js run` with MODE, LEAGUE, and TEAM
// already sanitized. Local use: node cli.js league|scan|weekly|publish [args]
const fs = require('fs');
const path = require('path');
const cc = require('./lib/cc');
const { normMatch } = require('./lib/normalize');
const store = require('./lib/store');
const { buildStandingsDoc } = require('./lib/standings');
const { sanitizeLeague, sanitizeTeam, siteUrl, commentFor } = require('./lib/issue');

const TZ = 'America/Los_Angeles';
const RESULT = path.join(store.ROOT, 'scan-result.json');
const refreshedStandings = new Set();

function laDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function seriesIso(s) {
  const [mm, dd, yy] = (s.startDate || '').split('/');
  return yy ? `${yy}-${mm}-${dd}` : '';
}
function matchTeam(league, name) {
  const want = String(name || '').trim().toLowerCase();
  return (league.teams || []).find(t => t.toLowerCase() === want) || null;
}
function seasonBits(league) {
  return { current: league.seasons.current?.name || null, last: league.seasons.last?.name || null };
}
function asOfFromTeam(code, team) {
  const t = store.readTeam(code, team);
  const times = Object.values((t && t.series) || {}).map(s => s.scrapedAt).filter(Boolean).sort();
  if (!times.length) return '';
  return 'data as of ' + times[times.length - 1].slice(0, 10);
}

function finish(result, code) {
  result.comment = commentFor(result);
  result.close = code !== 1;
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.comment.replace(/<!--[\s\S]*?-->\n?/g, '') + '\n');
  }
  console.log(JSON.stringify({ ok: !!result.ok, kind: result.kind || null, error: result.error || null }));
  process.exitCode = code;
  return result;
}

async function ensureLeague(input, { refresh = false } = {}) {
  const code = sanitizeLeague(input);
  if (!code) return { error: 'Invalid league. Use a CricClubs league code or a cricclubs.com URL.' };
  const cached = store.readLeague(code);
  if (cached && !refresh) return { league: cached, cached: true };
  const info = await cc.leagueInfo(code);
  if (!info) return { error: `League "${code}" was not found on CricClubs.` };
  const y = Number(laDate().slice(0, 4));
  const today = laDate();
  const all = [...await cc.seriesForYear(info.code, info.id, y), ...await cc.seriesForYear(info.code, info.id, y - 1)];
  const started = all.filter(s => seriesIso(s) && seriesIso(s) <= today).sort((a, b) => seriesIso(b).localeCompare(seriesIso(a)));
  const seasons = {};
  for (const [k, s] of [['current', started[0]], ['last', started[1]]]) {
    if (s) seasons[k] = { ...s, teams: await cc.seriesTeams(info.code, info.id, s) };
  }
  if (!seasons.current) return { error: `League "${info.name}" has no seasons in ${y - 1}–${y}.` };
  const teams = [...new Set(Object.values(seasons).flatMap(s => Object.keys(s.teams)))].sort((a, b) => a.localeCompare(b));
  const league = { ...info, checkedAt: new Date().toISOString(), seasons, teams, logos: (cached && cached.logos) || {} };
  store.writeLeague(league);
  console.error(`league ${league.code} (${league.name}) current=${seasons.current.name} teams=${teams.length}`);
  await refreshStandings(league, ['current', 'last']);
  return { league, cached: false };
}

async function refreshStandings(league, keys) {
  const seasons = [...new Set(keys)].map(k => league.seasons[k]).filter(s => s && s.id);
  const pending = seasons.filter(s => !refreshedStandings.has(league.code + '|' + s.id));
  if (!pending.length) return;
  let all = null;
  const logos = { ...(league.logos || {}) };
  let changed = false;
  for (const s of pending) {
    try {
      if (!all) all = await cc.allSeriesList(league.code);
      const pt = await cc.fetchPointsTable(league.code, league.id, s);
      const po = await cc.fetchPlayoffs(league.code, league.id, s, all, pt);
      const doc = buildStandingsDoc(pt, po);
      store.writeStandings(league.code, s.name, doc);
      Object.assign(logos, doc.logos || {});
      refreshedStandings.add(league.code + '|' + s.id);
      changed = true;
      console.error('standings', s.name);
    } catch (e) {
      console.error('standings failed', s.name, e.message);
    }
  }
  if (changed) {
    league.logos = logos;
    store.writeLeague(league);
  }
}

async function scanTeam(league, team, { currentOnly = false } = {}) {
  const canonical = matchTeam(league, team);
  if (!canonical) return { error: `Team "${team}" is not in the current or last season of ${league.name}.` };
  const t = store.readTeam(league.code, canonical) || { team: canonical, league: league.code, series: {}, matches: {} };
  t.team = canonical;
  t.league = league.code;
  const plan = [];
  for (const k of ['current', 'last']) {
    if (currentOnly && k === 'last') continue;
    const s = league.seasons[k];
    if (!s || !s.teams || !s.teams[canonical]) continue;
    const st = t.series[s.id];
    if (!st) plan.push({ key: k, s, mode: 'full' });
    else if (k === 'current') plan.push({ key: k, s, mode: 'incremental' });
  }
  let newMatches = 0;
  for (const p of plan) {
    const tid = p.s.teams[canonical];
    const list = await cc.teamMatchList(league.code, league.id, p.s, tid);
    const fresh = list.filter(m => !t.matches[m.scoreSummary.matchId]);
    console.error(`${p.s.name}: ${list.length} matches, ${fresh.length} new (${p.mode})`);
    for (const m of fresh) {
      const mid = m.scoreSummary.matchId;
      let raw = store.readScore(league.code, mid);
      if (!raw) {
        raw = await cc.scorecard(league.code, mid);
        store.writeScore(league.code, mid, raw);
      }
      t.matches[mid] = normMatch(m, raw, tid, canonical, p.s);
      newMatches++;
    }
    t.series[p.s.id] = { name: p.s.name, scrapedAt: new Date().toISOString(), matchIds: list.map(m => m.scoreSummary.matchId) };
    store.writeTeam(league.code, canonical, t);
  }
  await refreshStandings(league, plan.map(p => p.key));
  return { ok: true, team: canonical, newMatches, seasons: plan.map(p => p.s.name) };
}

function leagueResult(league, extra = {}) {
  const bits = seasonBits(league);
  return {
    ok: true,
    kind: 'league',
    code: league.code,
    name: league.name,
    teamCount: (league.teams || []).length,
    current: bits.current,
    last: bits.last,
    url: siteUrl(league.code),
    ...extra
  };
}

async function addLeague(input, { refresh = true } = {}) {
  const res = await ensureLeague(input, { refresh });
  if (res.error) return finish({ ok: false, error: res.error }, 2);
  store.publish();
  return finish(leagueResult(res.league), 0);
}

async function scanOne(input, teamInput, { refreshLeague = false, currentOnly = false } = {}) {
  const teamCheck = sanitizeTeam(teamInput);
  if (!teamCheck.ok) return finish({ ok: false, error: teamCheck.error }, 2);
  if (!teamCheck.value) return addLeague(input, { refresh: true });
  let res = await ensureLeague(input, { refresh: refreshLeague });
  if (res.error) return finish({ ok: false, error: res.error }, 2);
  let league = res.league;
  let team = matchTeam(league, teamCheck.value);
  if (!team) {
    res = await ensureLeague(league.code, { refresh: true });
    if (res.error) return finish({ ok: false, error: res.error }, 2);
    league = res.league;
    team = matchTeam(league, teamCheck.value);
  }
  if (!team) {
    const sample = (league.teams || []).slice(0, 40).join(', ');
    return finish({ ok: false, error: `Team "${teamCheck.value}" is not in the current or last season of ${league.name}. Teams: ${sample}` }, 2);
  }
  const scan = await scanTeam(league, team, { currentOnly });
  if (scan.error) return finish({ ok: false, error: scan.error }, 2);
  store.publish();
  const bits = seasonBits(league);
  return finish({
    ok: true,
    kind: 'team',
    code: league.code,
    name: league.name,
    team: scan.team,
    newMatches: scan.newMatches,
    current: bits.current,
    last: bits.last,
    url: siteUrl(league.code, scan.team),
    asOf: asOfFromTeam(league.code, scan.team)
  }, 0);
}

async function weekly() {
  const leagues = store.listLeagues();
  const summary = [];
  for (const cached of leagues) {
    let league = cached;
    try {
      const res = await ensureLeague(cached.code, { refresh: true });
      if (res.league) league = res.league;
      else console.error('league refresh skipped', cached.code, res.error);
    } catch (e) {
      console.error('league refresh failed', cached.code, e.message);
    }
    await refreshStandings(league, ['current']);
    const teams = store.listScannedTeams(league.code);
    for (const t of teams) {
      if (!matchTeam(league, t.team)) {
        console.error('skip', t.team, 'not in', league.code);
        continue;
      }
      const scan = await scanTeam(league, t.team, { currentOnly: true });
      summary.push({ league: league.code, team: t.team, newMatches: scan.newMatches || 0, error: scan.error || null });
      console.error('weekly', league.code, t.team, scan.error || (scan.newMatches + ' new'));
    }
  }
  store.publish();
  return finish({ ok: true, kind: 'weekly', summary, url: siteUrl(), name: 'weekly', code: '', current: null, last: null, teamCount: summary.length }, 0);
}

function argLeague() { return process.env.LEAGUE || process.argv[3] || ''; }
function argTeam() {
  if (process.env.LEAGUE !== undefined && process.env.TEAM !== undefined) return process.env.TEAM;
  return process.argv[4] || '';
}

async function run() {
  const cmd = process.argv[2];
  if (cmd === 'publish') {
    const index = store.publish();
    console.log(JSON.stringify({ leagues: index.leagues.length }));
    return;
  }
  if (cmd === 'seed-standings') {
    const dir = path.join(store.ROOT, 'samples');
    const league = store.readLeague('DublinandDanvilleCricketLeague');
    if (!league) throw new Error('DDCL league cache is missing');
    const logos = { ...(league.logos || {}) };
    const files = fs.readdirSync(dir).filter(f => /^normalized_.*\.json$/.test(f));
    for (const f of files) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const doc = buildStandingsDoc(raw.pointsTable, raw.playoffs);
      store.writeStandings(league.code, doc.series.name, doc);
      Object.assign(logos, doc.logos || {});
      console.error('seeded', doc.series.name, Object.keys(doc.teams).length);
    }
    league.logos = logos;
    store.writeLeague(league);
    store.publish();
    return;
  }
  if (cmd === 'league') return addLeague(argLeague(), { refresh: process.env.REFRESH === '1' || process.argv.includes('--refresh') });
  if (cmd === 'scan') return scanOne(argLeague(), argTeam(), { refreshLeague: false });
  if (cmd === 'weekly') return weekly();
  if (cmd === 'run') {
    const mode = process.env.MODE;
    if (mode === 'weekly') return weekly();
    if (mode === 'league') return addLeague(process.env.LEAGUE || '', { refresh: true });
    if (mode === 'scan') return scanOne(process.env.LEAGUE || '', process.env.TEAM || '', { refreshLeague: false });
    return finish({ ok: false, error: 'Unknown MODE. Expected weekly, league, or scan.' }, 1);
  }
  console.error('Usage: node cli.js publish|league|scan|weekly|run');
  process.exitCode = 1;
}

run().catch(e => {
  console.error(e);
  finish({ ok: false, error: String(e.message || e) }, 1);
}).finally(() => cc.close());
