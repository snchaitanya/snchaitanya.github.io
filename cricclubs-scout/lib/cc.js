// CricClubs access via headless Chrome: loads public pages and captures the JSON the site itself fetches.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { parseLeagueInput } = require('./league-input');
const GAP_MS = Number(process.env.SCRAPE_GAP_MS || 1500);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browserP = null, chain = Promise.resolve(), lastNav = 0;

function chromePath() {
  const cands = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/local/bin/google-chrome',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const hit = cands.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!hit) throw new Error('Chrome not found. Set CHROME_PATH to the browser executable.');
  return hit;
}
async function browser() {
  if (!browserP) {
    const executablePath = chromePath();
    console.error('chrome', executablePath);
    browserP = puppeteer.launch({
      executablePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation']
    });
  }
  const b = await browserP;
  if (!b.connected) { browserP = null; return browser(); }
  return b;
}
// Global serial queue: one page load at a time, >= GAP_MS apart (polite rate limit).
function visit(url, want, timeoutMs = 20000) {
  const job = chain.then(async () => {
    const wait = lastNav + GAP_MS - Date.now(); if (wait > 0) await sleep(wait);
    lastNav = Date.now();
    console.error('visit', url);
    const b = await browser(); const pg = await b.newPage(); const cap = {};
    try {
      await pg.setUserAgent((await b.userAgent()).replace('HeadlessChrome', 'Chrome'));
      await pg.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
      await pg.setRequestInterception(true);
      pg.on('request', r => { const u = r.url(); (/cricclubs\.com|challenges\.cloudflare/.test(u) && !['image', 'media', 'font', 'stylesheet'].includes(r.resourceType())) ? r.continue() : r.abort(); });
      pg.on('response', async r => { const u = r.url(); if (/core-prod-origin/.test(u)) { try { cap[u] = { status: r.status(), body: await r.json() }; } catch (e) {} } });
      const resp = await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => { console.error('nav', e.message); return null; });
      const t0 = Date.now();
      const ready = () => want.every(w => Object.keys(cap).some(k => w.test(k)));
      while (Date.now() - t0 < timeoutMs) { if (ready()) break; await sleep(300); }
      await sleep(800);
      if (!ready()) {
        const title = await pg.title().catch(() => '');
        console.error('page', resp ? resp.status() : 0, JSON.stringify(title), 'captured', Object.keys(cap).length);
        if (/just a moment|security verification|attention required/i.test(title)) {
          throw new Error('CricClubs Cloudflare check did not clear. Retry the scan later.');
        }
      }
      return { cap, status: resp ? resp.status() : 0 };
    } finally { await pg.close().catch(() => {}); }
  });
  chain = job.catch(() => {});
  return job;
}
const find = (cap, re) => { const k = Object.keys(cap).find(k => re.test(k)); return k ? cap[k] : null; };

async function leagueInfo(code) {
  const { cap } = await visit(`https://cricclubs.com/${code}/results`, [/\/info(\?|$)/], 15000);
  const info = find(cap, new RegExp(`league/${code}/info`, 'i'));
  const d = info && info.status === 200 && info.body && info.body.data;
  if (!d || !d.id) return null;
  return { code: d.shortCode || code, id: d.id, name: d.name };
}
async function seriesForYear(code, lid, y) {
  const { cap } = await visit(`https://cricclubs.com/${code}/results?leagueId=${lid}&year=${y}`, [new RegExp(`series\\?year=${y}`)]);
  const r = find(cap, new RegExp(`series\\?year=${y}`)); const d = r && r.body && r.body.data;
  const list = (d && (d.seriesList || (Array.isArray(d) ? d : []))) || [];
  return list.filter(s => !s.isHiddenSeries).map(s => ({ id: s.id, name: s.name, startDate: s.startDate, year: y }));
}
async function seriesTeams(code, lid, s) {
  const { cap } = await visit(`https://cricclubs.com/${code}/results?leagueId=${lid}&year=${s.year}&series=${s.id}&seriesName=${encodeURIComponent(s.name)}`, [/\/teams\?/]);
  const r = find(cap, /\/teams\?/); const out = {};
  (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.teamId && o.teamName) out[o.teamName.trim()] = o.teamId; Object.values(o).forEach(walk); } })(r && r.body && r.body.data);
  return out; // name -> teamId (ids differ per series)
}
async function teamMatchList(code, lid, s, teamId) {
  const re = /\/matches\?.*teamId=/;
  const { cap } = await visit(`https://cricclubs.com/${code}/results?leagueId=${lid}&year=${s.year}&series=${s.id}&team=${teamId}&seriesName=${encodeURIComponent(s.name)}`, [re]);
  const r = find(cap, re); const d = r && r.body && r.body.data;
  if (!d) throw new Error('match list not returned');
  return [...(d.completed || [])].filter(m => m.scoreSummary && m.scoreSummary.matchId);
}
async function scorecard(code, mid) {
  const { cap } = await visit(`https://cricclubs.com/${code}/results/${mid}`, [/scorecard\?leagueId/, /scorecard\/header/]);
  const sc = find(cap, /scorecard\?leagueId/), h = find(cap, /scorecard\/header/);
  if (!sc || !h) throw new Error('scorecard not returned for ' + mid);
  return { header: h.body, scorecard: sc.body };
}
async function close() {
  const pending = chain.catch(() => {});
  chain = pending;
  await pending;
  if (!browserP) return;
  const b = await browserP.catch(() => null);
  browserP = null;
  if (b) await b.close().catch(() => {});
}
// Points table and playoffs. The public pages request these; Chrome captures the JSON.
//   team/getPointsTable?clubId&seriesId          page: /<code>/points-table?...
//   league/<code>/info  data.seriesList          playoff series the year list hides
// Logos are https://media.cricclubs.com + logo_file_path (hotlinkable, CORS *).
const MEDIA = 'https://media.cricclubs.com';
const yearOf = s => Number(String(s.year || (s.startDate || '').split('/')[2] || new Date().getFullYear()));
async function fetchPointsTable(code, lid, series) {
  const re = /team\/getPointsTable\?/;
  const { cap } = await visit(`https://cricclubs.com/${code}/points-table?leagueId=${lid}&year=${yearOf(series)}&series=${series.id}&seriesName=${encodeURIComponent(series.name)}`, [re]);
  const r = find(cap, re); const groups = r && r.body && r.body.data;
  if (!Array.isArray(groups)) throw new Error('points table not returned for ' + series.name);
  return {
    series: { id: series.id, name: series.name },
    groups: groups.map(g => ({
      group: g.groupName, groupId: g.encryptedGroupId, winnerTeamId: g.leagueWinner || null, runnerUpTeamId: g.leagueRunner || null,
      rows: (g.teams || []).map((t, i) => { const x = t.team; return {
        position: i + 1, team: x.teamName, teamId: x.encryptedTeamId, played: x.matches, won: x.won, lost: x.lost,
        nr: x.noResult, tied: x.tied + x.tie, abandoned: x.abandoned, points: x.points, nrr: x.netRunRate,
        logo: x.logo_file_path ? MEDIA + x.logo_file_path : null }; }),
    })),
  };
}
async function seriesMatchesAll(code, lid, series) {
  const re = /\/matches\?.*teamId=&/;
  const { cap } = await visit(`https://cricclubs.com/${code}/results?leagueId=${lid}&year=${yearOf(series)}&series=${series.id}&seriesName=${encodeURIComponent(series.name)}`, [re]);
  const r = find(cap, re); const d = r && r.body && r.body.data; if (!d) throw new Error('matches not returned for ' + series.name);
  return { completed: d.completed || [], scheduled: [...(d.scheduled || []), ...(d.ongoing || [])], total: d.totalMatchesCount };
}
function roundOf(m, isPlayoffSeries, lastDate) {
  const notes = `${m.privateNotes || ''} ${m.publicNotes || ''}`.toLowerCase();
  const mt = (m.matchType || '').toLowerCase();
  if (/practice|friendly/.test(mt)) return null;
  if (mt && mt !== 'league') return mt.replace(/\b\w/g, c => c.toUpperCase());
  if (/semi/.test(notes)) return 'Semi final'; if (/quarter/.test(notes)) return 'Quarter final'; if (/final/.test(notes)) return 'Final';
  if (isPlayoffSeries) return m.matchDateTime.slice(0, 10) === lastDate ? 'Final' : 'Playoff';
  return null;
}
async function fetchPlayoffs(code, lid, season, allSeries, pointsTable) {
  const linked = (allSeries || []).filter(s => s.id !== season.id && /playoff|knockout/i.test(s.name) && s.name.toLowerCase().startsWith(season.name.toLowerCase()));
  const pools = [{ s: season, po: false }, ...linked.map(s => ({ s, po: true }))];
  const games = []; const seriesMeta = {}; let pending = false;
  for (const { s, po } of pools) {
    const ms = await seriesMatchesAll(code, lid, s);
    if (ms.scheduled.length) pending = true;
    const last = ms.completed.map(m => m.matchDateTime.slice(0, 10)).sort().pop();
    for (const m of ms.completed) { const round = roundOf(m, po, last); if (!round) continue;
      const res = m.scoreSummary.result || ''; const wName = (res.match(/^(.+?) won/) || res.match(/Winner:\s*(.+)$/) || [])[1];
      const cup = (`${m.privateNotes || ''}`.match(/(\w+\s+Cup)/i) || [])[1] || null;
      games.push({ date: m.matchDateTime.slice(0, 10), round, cup, series: s.name, matchId: m.scoreSummary.matchId, teams: [m.teamOne.name, m.teamTwo.name], teamIds: [m.teamOne.id, m.teamTwo.id], winner: wName ? wName.trim() : null, result: res }); }
    seriesMeta[s.id] = { name: s.name, playoffSeries: po, completed: ms.completed.length, total: ms.total };
  }
  const finals = games.filter(g => /^final$/i.test(g.round));
  if (finals.length > 1 && finals.some(f => !f.cup)) {
    const main = new Set(((pointsTable && pointsTable.groups) || []).flatMap(g => [g.winnerTeamId, g.runnerUpTeamId]).filter(Boolean));
    for (const f of finals) if (!f.cup) f.cup = f.teamIds.some(id => main.has(id)) ? null : 'secondary final';
  }
  const teams = {};
  for (const g of games.sort((a, b) => a.date.localeCompare(b.date))) for (const t of g.teams) (teams[t] = teams[t] || []).push(g);
  const outcome = {};
  for (const [t, gs] of Object.entries(teams)) {
    const last = gs[gs.length - 1]; const won = last.winner === t; const cup = last.cup ? ` – ${last.cup}` : '';
    outcome[t] = { reached: last.round, games: gs.map(g => ({ date: g.date, round: g.round, cup: g.cup, opponent: g.teams.find(x => x !== t), won: g.winner === t, result: g.result, matchId: g.matchId })),
      result: /^final$/i.test(last.round) ? (won ? 'Winner' : 'Runner-up') + cup : (won ? `Advanced from ${last.round}${cup}` : `Lost in playoffs (${last.round})${cup}`) };
  }
  return { season: { id: season.id, name: season.name }, linkedPlayoffSeries: linked.map(s => ({ id: s.id, name: s.name, startDate: s.startDate })), playoffsFound: games.length > 0, fixturesPending: pending, series: seriesMeta, teams: outcome };
}
async function allSeriesList(code) {
  const { cap } = await visit(`https://cricclubs.com/${code}/results`, [/\/info(\?|$)/], 15000);
  const r = find(cap, new RegExp(`league/${code}/info`, 'i'));
  return ((r && r.body && r.body.data && r.body.data.seriesList) || []).map(s => ({ id: s.id, name: s.name, startDate: s.startDate }));
}
module.exports = { parseLeagueInput, leagueInfo, seriesForYear, seriesTeams, teamMatchList, scorecard, close, chromePath, fetchPointsTable, fetchPlayoffs, allSeriesList, MEDIA };
