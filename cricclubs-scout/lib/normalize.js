// Convert raw CricClubs scorecard JSON into compact match records (real values only).
const he = s => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function normMatch(listItem, raw, teamId, teamName, series) {
  const h = raw.header.data, s = raw.scorecard.data;
  const opp = h.teamOne.id === teamId ? h.teamTwo.name : h.teamOne.name;
  const res = h.result || ''; const forfeit = !!s.isAbandoned || /forfeit/i.test(res);
  const tw = (h.tossDetails || '').match(/^(.+) won the toss and elected to (bat|bowl)/);
  const inns = [s.innings1, s.innings2].filter(Boolean);
  const rec = { id: h.matchId, date: (h.matchDateTime || '').slice(0, 10), series: series.name, seriesId: series.id, opponent: opp,
    ground: (listItem.ground || {}).name || null, result: res, forfeit, outcome: s.winner === teamId ? 'W' : (s.winner ? 'L' : 'NR'),
    tossWonByUs: tw ? tw[1].trim() === teamName : null, tossDecision: tw ? tw[2] : null, battedFirst: forfeit ? null : h.battingFirst === teamId,
    innings: forfeit ? [] : inns.map(i => ({ team: i.teamName, runs: i.total, wkts: i.wickets, overs: String(i.overs) })),
    batting: [], bowling: [], dismissals: [] };
  if (!forfeit) for (const i of inns) {
    if (i.teamId === teamId) {
      for (const b of i.batting || []) {
        if (!b.ballsFaced && b.isOut !== '1' && !b.runsScored) continue; // did not bat
        const row = { name: he(b.playerName).trim(), r: b.runsScored, b: b.ballsFaced, f: b.fours, s: b.sixers, out: b.isOut === '1' };
        if (b.howOut) row.how = b.howOut;
        rec.batting.push(row);
      }
    } else {
      for (const w of i.bowling || []) rec.bowling.push({ name: `${w.firstName || ''} ${w.lastName || ''}`.trim(), balls: w.balls, r: w.runs, w: w.wickets });
      for (const b of i.batting || []) if (b.howOut) rec.dismissals.push({ how: b.howOut, text: he(b.outStringNoLink).trim() });
    }
  }
  if (!forfeit) attachHowOut(rec, raw);
  return rec;
}
// Fielding: parse opponent dismissal text, resolve abbreviated names ("Devender S") against the team's roster.
function fielding(matches) {
  const names = new Set(); for (const m of matches) { m.batting.forEach(b => names.add(b.name)); m.bowling.forEach(b => names.add(b.name)); }
  const resolve = a => { a = a.replace(/[†\u2020]/g, '').trim(); if (names.has(a)) return a; const p = a.split(/\s+/);
    const c = [...names].filter(n => { const t = n.split(/\s+/); return t[0] === p[0] && (p.length < 2 || t.slice(1).some(x => x.startsWith(p[p.length - 1]))); });
    return c.length === 1 ? c[0] : null; };
  let unresolved = 0;
  for (const m of matches) {
    const f = {};
    for (const d of m.dismissals || []) {
      let ev = [];
      if (d.how === 'ct' || d.how === 'ctw') { const x = d.text.match(/^c\s*&\s*b\s+(.+)$/) || d.text.match(/^c (.+?) b /); if (x) ev.push([x[1], d.how === 'ct' ? 'c' : 'k']); }
      else if (d.how === 'ro' || d.how === 'mk') { const x = d.text.match(/\((.*?)\)/); if (x) ev = x[1].split('/').filter(s => s.trim()).map(s => [s, 'r']); }
      else if (d.how === 'st') { const x = d.text.match(/^st (.+?) b /); if (x) ev.push([x[1], 's']); }
      for (const [a, k] of ev) { const n = resolve(a); if (!n) { unresolved++; continue; } const key = n + '|' + k; f[key] = (f[key] || 0) + 1; }
    }
    m.fielding = Object.entries(f).map(([k, v]) => { const [n, t] = k.split('|'); return [n, t, v]; });
  }
  return unresolved;
}
function oversNum(s) { const [a, b] = String(s || '0').split('.'); return Number(a) + (Number(b || 0) / 6); }
function bowlName(w) { return `${w.firstName || ''} ${w.lastName || ''}`.trim(); }
function parseFow(list) {
  const out = [];
  for (const f of list || []) {
    const m = String(f.total || '').match(/(\d+)-(\d+)\s*\((\d+)(?:\.(\d+))?\s*ov\)/i);
    if (m) out.push({ w: Number(m[2]), over: Number(m[3]) + (m[4] ? Number(m[4]) / 6 : 0) });
  }
  return out;
}
function attachHowOut(match, raw) {
  const data = raw && raw.scorecard && raw.scorecard.data;
  if (!data || !match) return;
  const inns = [data.innings1, data.innings2].filter(Boolean);
  const batNames = new Set((match.batting || []).map(b => b.name));
  const bowlNames = new Set((match.bowling || []).map(b => b.name));
  let batInn = null, bowlInn = null, best = 0;
  for (const i of inns) {
    const hit = (i.batting || []).filter(b => batNames.has(he(b.playerName).trim())).length;
    if (hit > best) { best = hit; batInn = i; }
    if ((i.bowling || []).some(w => bowlNames.has(bowlName(w)))) bowlInn = i;
  }
  if (batInn) {
    const pos = {}, how = {};
    (batInn.batting || []).forEach((b, idx) => {
      const n = he(b.playerName).trim();
      pos[n] = idx + 1;
      if (b.howOut) how[n] = b.howOut;
    });
    for (const b of match.batting || []) {
      if (pos[b.name]) b.pos = pos[b.name];
      if (how[b.name]) b.how = how[b.name];
    }
    const fow = parseFow(batInn.fallOfWickets);
    if (fow.length) match.fow = fow;
  }
  if (bowlInn) {
    const extra = {};
    for (const w of bowlInn.bowling || []) extra[bowlName(w)] = { dots: w.dotBalls || 0, wd: w.wides || 0, nb: w.noBalls || 0 };
    for (const w of match.bowling || []) {
      const e = extra[w.name];
      if (!e) continue;
      w.dots = e.dots; w.wd = e.wd; w.nb = e.nb;
    }
    const ex = bowlInn.extras || {};
    match.extrasBowled = { b: ex.b || 0, lb: ex.lb || 0, nb: ex.nb || 0, wd: ex.wd || 0 };
    if (bowlInn.overs != null && bowlInn.overs !== '') match.oversBowled = Math.round(oversNum(bowlInn.overs) * 10) / 10;
  }
}
module.exports = { normMatch, fielding, attachHowOut };
