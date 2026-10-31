// Scan one team of a legacy (.do) CricClubs club into data/store, then publish.
// Usage: CHROME_PATH=... node scripts/legacy-team.js <ClubCode> "<Team name>" [...more teams]
const puppeteer = require('puppeteer-core');
const store = require('../lib/store');
const [code, ...teams] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pg;
async function open(url) {
  for (let i = 0; i < 3; i++) {
    await sleep(1500);
    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.error(e.message));
    for (let k = 0; k < 20 && /just a moment/i.test(await pg.title()); k++) await sleep(1000);
    if (!/just a moment/i.test(await pg.title())) { await sleep(1000); return; }
  }
  throw new Error('cloudflare ' + url);
}
const base = `https://cricclubs.com/${code}`;
const HOW = t => { t = t.trim(); if (!t || /^not out|^retired not|^dnb/i.test(t)) return null;
  if (/^run out/i.test(t)) return 'ro'; if (/^st /i.test(t)) return 'st'; if (/^lbw/i.test(t)) return 'lbw';
  if (/^c\s*&\s*b/i.test(t)) return 'ct'; if (/^c\s*[†\u2020]/.test(t)) return 'ctw'; if (/^c /i.test(t)) return 'ct';
  if (/^b /i.test(t)) return 'b'; if (/hit wicket/i.test(t)) return 'hw'; if (/retired/i.test(t)) return 'rt'; return 'other'; };
const balls = o => { const [a, b] = String(o).split('.'); return Number(a) * 6 + Number(b || 0); };

async function scorecard(mid, clubId) {
  await open(`${base}/viewScorecard.do?matchId=${mid}&clubId=${clubId}`);
  return pg.evaluate(() => {
    const txt = e => (e ? e.textContent : '').replace(/\s+/g, ' ').trim();
    const body = document.body.innerText.replace(/[ \t]+/g, ' ');
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean); const out = { header: body, result: lines.find(l => /won by|Forfeit|No Result|tied|Abandon/i.test(l) && l.length < 120) || '', innings: [] };
    const toss = (document.documentElement.innerHTML.match(/<strong>([^<]*won the toss[^<]*)<\/strong>/) || [])[1] || null;
    out.toss = toss;
    for (const tb of document.querySelectorAll('table')) {
      const head = txt(tb.querySelector('thead'));
      const rows = [...tb.querySelectorAll('tbody tr')].map(tr => [...tr.children]);
      if (/innings R B 4s 6s SR/.test(head) || /^.*innings\s+R\s+B/.test(head)) {
        const team = head.replace(/\s+innings.*$/, '').trim();
        const bat = []; let extras = null, total = null;
        for (const c of rows) {
          const t0 = txt(c[0]);
          if (/^Extras/.test(t0)) { extras = txt(tb.querySelector('tbody')).match(/Extras.*?\(b (\d+) lb (\d+) w (\d+) nb (\d+)/); continue; }
          if (/^Total/.test(t0)) { const m = c.map(txt).join(' ').match(/\((\d+) wickets?,\s*([\d.]+) overs?\s*\)/) || []; total = { w: m[1], o: m[2], r: c.map(txt).filter(x => /^\d+$/.test(x)).pop() }; continue; }
          const b = c[0].querySelector('b'); if (!b || c.length < 6) continue;
          const nums = c.slice(-5).map(txt);
          const how = txt(c[1]);
          bat.push({ name: txt(b).replace(/[*†\u2020]/g, '').trim(), howText: how, r: +nums[0], b: +nums[1], f: +nums[2], s: +nums[3] });
        }
        out.innings.push({ team, bat, extras, total, bowl: [] });
      } else if (/O\s+M\s+Dot\s+R\s+W\s+Econ/.test(head) && out.innings.length) {
        const inn = out.innings[out.innings.length - 1];
        for (const c of rows) {
          const b = c.map(x => x.querySelector('b')).find(x => x && x.closest('a')); if (!b) continue;
          const name = txt(b).replace(/[*†\u2020]/g, '').trim();
          const i = c.findIndex(x => x.contains(b));
          const v = c.slice(i + 1).map(txt);
          const ex = v.slice(6).join(' ');
          inn.bowl.push({ name, o: v[0], dots: +v[2], r: +v[3], w: +v[4], wd: +((ex.match(/(\d+)\s*w\b/) || [])[1] || 0), nb: +((ex.match(/(\d+)\s*nb\b/) || [])[1] || 0) });
        }
      }
    }
    return out;
  });
}

(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
  pg = await b.newPage();
  await pg.setUserAgent((await b.userAgent()).replace('HeadlessChrome', 'Chrome'));
  await pg.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  await pg.setRequestInterception(true);
  pg.on('request', r => (/cricclubs\.com|challenges\.cloudflare/.test(r.url()) && !['image', 'media', 'font', 'stylesheet'].includes(r.resourceType())) ? r.continue() : r.abort());
  const league = store.readLeague(code);
  const standings = store.listStandings(code);
  await open(`${base}/viewPointsTable.do`);
  const clubId = (await pg.content()).match(/clubId=(\d+)/)[1];
  const report = {};
  for (const team of teams) {
    const doc = { team, league: { code, name: league.name }, series: {}, matches: {} };
    for (const k of ['current', 'last']) {
      const s = league.seasons[k]; if (!s || !s.teams[team]) continue;
      const tid = s.teams[team];
      const st = standings.find(d => d.series.id === s.id);
      const gname = st && st.teams[team] && st.teams[team].group;
      const gid = ((s.groups || []).find(g => (g.name === gname) || ('Group ' + g.name) === gname) || {}).id;
      await open(`${base}/listMatches.do?teamId=${tid}&league=${gid}&clubId=${clubId}`);
      const mids = [...new Set((await pg.content()).match(/viewScorecard\.do\?matchId=\d+/g) || [])].map(x => x.split('=')[1]);
      await open(`${base}/fixtures.do?teamId=${tid}&league=${gid}&clubId=${clubId}&year=${s.year}`);
      const fx = await pg.evaluate(() => [...document.querySelectorAll('tr')].map(tr => [...tr.children].map(c => c.textContent.replace(/\s+/g, ' ').trim())).filter(r => r.length >= 8 && r.some(c => /^\d\d\/\d\d\/\d{4}$/.test(c))));
      const ids = [];
      for (const mid of mids) {
        const sc = await scorecard(mid, clubId);
        const hm = sc.header.match(/(\d\d)\/(\d\d)\/(\d{4})/);
        const date = hm ? `${hm[3]}-${hm[1]}-${hm[2]}` : null;
        const res = sc.result.trim();
        const winner = (res.match(/Winner: (.+)$/) || res.match(/^(.+?) won /) || [])[1];
        const inns = sc.innings;
        if (inns.length < 1) { console.error('  no innings', mid); continue; }
        const ours = inns.find(i => i.team === team), theirs = inns.find(i => i.team !== team);
        const opp = theirs ? theirs.team : (sc.header.match(new RegExp('(MTCA [^/]+?) \\d+/\\d+')) || [])[1];
        const fxr = hm && fx.find(r => r.includes(`${hm[1]}/${hm[2]}/${hm[3]}`) && r.includes(opp));
        const ground = fxr ? fxr[fxr.indexOf(`${hm[1]}/${hm[2]}/${hm[3]}`) + 4] || null : null;
        let tossWonByUs = null, tossDecision = null;
        if (sc.toss) { tossWonByUs = sc.toss.startsWith(team + ' won'); tossDecision = /bat/i.test(sc.toss) ? 'bat' : 'bowl'; }
        const outcome = winner ? (winner.trim() === team ? 'W' : 'L') : /tie/i.test(res) ? 'T' : 'NR';
        const m = {
          id: 'legacy-' + mid, date, series: s.name, seriesId: s.id, opponent: opp, ground, result: res, forfeit: /forfeit|abandon/i.test(res) || !(ours && ours.bat.length || theirs && theirs.bat.length), outcome,
          tossWonByUs, tossDecision, battedFirst: inns[0].team === team,
          innings: inns.map(i => ({ team: i.team, runs: Number(i.total && i.total.r) || 0, wkts: Number(i.total && i.total.w) || 0, overs: String(i.total && i.total.o || '0') })),
          batting: ours ? ours.bat.map((x, n) => { const o = { name: x.name, r: x.r, b: x.b, f: x.f, s: x.s, out: !!HOW(x.howText), pos: n + 1 }; if (o.out) o.how = HOW(x.howText); return o; }) : [],
          bowling: theirs ? theirs.bowl.map(x => ({ name: x.name, balls: balls(x.o), r: x.r, w: x.w, dots: x.dots, wd: x.wd, nb: x.nb })) : [],
          dismissals: theirs ? theirs.bat.filter(x => HOW(x.howText)).map(x => ({ how: HOW(x.howText), text: x.howText })) : [],
        };
        doc.matches[m.id] = m; ids.push(m.id);
        console.error(' ', k, mid, date, opp, '|', res, '| ground', ground, '| bat', m.batting.length, 'bowl', m.bowling.length);
      }
      doc.series[s.id] = { name: s.name, scrapedAt: new Date().toISOString(), matchIds: ids };
    }
    store.writeTeam(code, team, doc);
    report[team] = Object.keys(doc.matches).length;
  }
  store.publish();
  console.log(JSON.stringify(report));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
