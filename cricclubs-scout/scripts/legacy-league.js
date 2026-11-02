// Index a legacy (server-rendered .do) CricClubs club: seasons, groups, teams, logos, standings.
// Usage: CHROME_PATH=... node scripts/legacy-league.js <ClubCode> "<Display name>"
const puppeteer = require('puppeteer-core');
const store = require('../lib/store');
const [code, dispName] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
let b, pg;
async function get(url) {
  for (let i = 0; i < 3; i++) {
    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.error(e.message));
    for (let k = 0; k < 20; k++) { const t = await pg.title(); if (!/just a moment/i.test(t)) break; await sleep(1000); }
    const h = await pg.content(); if (!/Just a moment/.test(await pg.title())) { await sleep(1500); return h; }
  }
  throw new Error('cloudflare ' + url);
}
const dropdowns = h => [...h.matchAll(/<ul class="dropdown-menu[^"]*"[^>]*>([\s\S]*?)<\/ul>/g)].map(m => [...m[1].matchAll(/href="[^"]*viewPointsTable\.do\?league=(\d+)[^"]*">([^<]*)</g)].map(x => ({ id: x[1], name: dec(x[2]) }))).filter(a => a.length);
function table(h, group) {
  const rows = [];
  for (const m of h.matchAll(/<tr>\s*<th>(\d+)<\/th>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[2].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(c => c[1]);
    const logo = (cells[0].match(/<img src="([^"]+)"/) || [])[1] || null;
    const tid = (cells[0].match(/teamId=(\d+)/) || [])[1];
    const n = i => Number(dec(cells[i] || '')) || 0;
    rows.push({ position: +m[1], name: dec(cells[0]), teamId: tid, logo, played: n(1), won: n(2), lost: n(3), nr: n(4), tie: n(5), points: n(6), nrr: Number(dec(cells[8] || '')) || 0 });
  }
  return rows.map(r => ({ ...r, of: rows.length, group }));
}
async function season(firstId) {
  const h = await get(`https://cricclubs.com/${code}/viewPointsTable.do?league=${firstId}&clubId=`);
  const dd = dropdowns(h); const groups = dd.length > 1 ? dd[dd.length - 1] : [{ id: firstId, name: '' }];
  const name = dec((h.match(/<title>([^<]*)/) || [])[1] || '');
  const all = []; const teams = {};
  for (const g of groups) {
    const gh = g.id === firstId ? h : await get(`https://cricclubs.com/${code}/viewPointsTable.do?league=${g.id}&clubId=`);
    for (const r of table(gh, g.name ? (/^(group|division|div)/i.test(g.name) ? g.name : 'Group ' + g.name) : null)) { all.push(r); teams[r.name] = r.teamId; }
    console.error(' group', g.name, g.id, Object.keys(teams).length);
  }
  return { groups, all, teams };
}
(async () => {
  b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
  pg = await b.newPage();
  await pg.setUserAgent((await b.userAgent()).replace('HeadlessChrome', 'Chrome'));
  await pg.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  await pg.setRequestInterception(true);
  pg.on('request', r => (/cricclubs\.com|challenges\.cloudflare/.test(r.url()) && !['image', 'media', 'font', 'stylesheet'].includes(r.resourceType())) ? r.continue() : r.abort());
  const h = await get(`https://cricclubs.com/${code}/viewPointsTable.do`);
  const series = dropdowns(h)[0].filter((s, i, a) => a.findIndex(t => t.id === s.id) === i);
  const skip = /corporate|playoff|charity|practice|tournament|knock/i;
  const main = series.filter(s => !skip.test(s.name));
  const picks = { current: main[0], last: main[1] };
  console.error('series', JSON.stringify(picks));
  const league = { code, name: dispName || code, checkedAt: new Date().toISOString(), legacy: true, seasons: {}, teams: [], logos: {} };
  const names = new Set();
  for (const [k, s] of Object.entries(picks)) {
    if (!s) continue;
    const r = await season(s.id);
    const year = Number((s.name.match(/20\d\d/) || [])[0]) || null;
    league.seasons[k] = { id: 'legacy-' + s.id, name: s.name, startDate: null, year, teams: r.teams, groups: r.groups.map(g => ({ id: g.id, name: g.name })) };
    for (const x of r.all) { if (x.logo && !league.logos[x.name]) league.logos[x.name] = x.logo; if (k === 'current') names.add(x.name); }
    const doc = { series: { id: 'legacy-' + s.id, name: s.name }, playoffs: { found: false, pending: false }, teams: {} };
    for (const x of r.all) doc.teams[x.name] = { position: x.position, of: x.of, group: x.group, played: x.played, won: x.won, lost: x.lost, nr: x.nr, points: x.points, nrr: x.nrr, logo: x.logo, playoff: null };
    store.writeStandings(code, s.name, doc);
  }
  league.teams = [...names].sort((a, b) => a.localeCompare(b));
  store.writeLeague(league);
  store.publish();
  console.log(JSON.stringify({ code, current: league.seasons.current && league.seasons.current.name, groups: league.seasons.current && league.seasons.current.groups.length, teams: league.teams.length, last: league.seasons.last && league.seasons.last.name }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
