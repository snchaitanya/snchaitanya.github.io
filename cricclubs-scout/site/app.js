const $ = s => document.querySelector(s);
let LEAGUE = null, DATA = null, CATALOG = [];
let pollTimer = null, pollGen = 0;
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–', ov = b => Math.floor(b / 6) + '.' + b % 6, f1 = x => isFinite(x) ? x.toFixed(1) : '–';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ini = n => String(n).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const HUES = ['#2fd27a', '#ffc83d', '#4cc3ff', '#ff8a95', '#b78cff', '#7ee0c3', '#ffa05c'];
const hue = n => HUES[[...n].reduce((s, c) => s + c.charCodeAt(0), 0) % HUES.length];
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function remember(k, v) { try { localStorage[k] = v; } catch (e) {} }
function recall(k) { try { return localStorage[k] || ''; } catch (e) { return ''; } }
function msg(t) { const m = $('#msg'); m.hidden = !t; m.textContent = t || ''; }
function parseLeague(s) {
  s = String(s || '').trim();
  const m = s.match(/cricclubs\.com\/([A-Za-z0-9_-]+)/i);
  const code = m ? m[1] : s.replace(/^\/+|\/.*$/g, '');
  return /^[A-Za-z0-9_-]{2,80}$/.test(code) ? code : null;
}
function stopPoll() { pollGen++; if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function asOf(data) {
  const times = Object.values(data.seasons || {}).map(s => s.scrapedAt).filter(Boolean).sort();
  if (!times.length) return '';
  const pretty = new Date(times[times.length - 1]).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const names = Object.values(data.seasons || {}).filter(s => s && s.scrapedAt).map(s => s.name).join(' · ');
  return 'data as of ' + pretty + (names ? ' · ' + names : '');
}
function welcomeHTML() {
  return `<section class="welcome" id="welcome"><div class="wball"></div><h1>Know your<br><span>opponent.</span></h1><p>Pick a cached league or add one, then scout a team: form, match-ups, key players, toss habits and grounds.</p><div class="eg">Try <button class="chip" type="button" data-lg="DublinandDanvilleCricketLeague">DublinandDanvilleCricketLeague</button></div></section>`;
}
function requestPanel(title, html) {
  return `<section class="welcome"><div class="wball"></div><h1>${esc(title)}</h1><p class="lead">${html}</p><img class="soon" src="coming-soon.gif" alt="Coming soon"><p class="hint" id="pollhint"></p></section>`;
}
function leagueByCode(code) { return CATALOG.find(l => l.code.toLowerCase() === String(code || '').toLowerCase()) || null; }
async function loadCatalog() {
  const r = await fetch('data/index.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not load cached leagues (' + r.status + ')');
  const j = await r.json();
  CATALOG = j.leagues || [];
  const sel = $('#leagueSel');
  const cur = sel.value;
  sel.innerHTML = '<option value="" hidden></option>' + CATALOG.map(l => `<option value="${esc(l.code)}">${esc(l.name)} · ${esc(l.code)}</option>`).join('');
  if (cur && CATALOG.some(l => l.code === cur)) sel.value = cur;
}
function teamLogo(name) {
  return (LEAGUE && LEAGUE.logos && LEAGUE.logos[name]) || (DATA && DATA.logos && DATA.logos[name]) || '';
}
function face(name, url, cls) {
  const c = cls || 'logo-img';
  if (url) return `<img class="${c}" alt="" src="${esc(url)}">`;
  return `<span class="av sm${cls ? ' ' + cls : ''}" style="background:${hue(name)}">${esc(ini(name))}</span>`;
}
let teamGroups = {}, teamIndex = [], teamActive = -1;
function indexTeams(names) {
  teamIndex = (names || []).map(name => {
    const words = String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return { name, low: String(name).toLowerCase(), initials: words.map(w => w[0]).join(''), words };
  });
}
function teamMatches(q, t) {
  const s = String(q || '').toLowerCase().trim();
  if (!s) return false;
  if (t.low.includes(s)) return true;
  const compact = s.replace(/[^a-z0-9]/g, '');
  if (compact && t.initials.startsWith(compact)) return true;
  const parts = s.split(/\s+/).filter(Boolean);
  return parts.length > 1 && parts.every(p => t.words.some(w => w.startsWith(p)));
}
function teamHits(q) {
  const s = String(q || '').toLowerCase().trim();
  const compact = s.replace(/[^a-z0-9]/g, '');
  return teamIndex.filter(t => teamMatches(s, t)).sort((a, b) => {
    const rank = t => t.low.startsWith(s) ? 0 : (compact && t.initials.startsWith(compact) ? 1 : 2);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
}
function closeTeamList() {
  const list = $('#teamList');
  if (list) list.hidden = true;
  const input = $('#teamSearch');
  if (input) { input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  teamActive = -1;
}
function restoreTeamText() {
  const input = $('#teamSearch'); if (!input) return;
  input.value = $('#team').value || '';
  const clear = $('#teamClear');
  if (clear) clear.hidden = !input.value;
}
function paintTeamActive() {
  const list = $('#teamList'); if (!list) return;
  const opts = [...list.querySelectorAll('[role="option"]')];
  opts.forEach((el, i) => {
    const on = i === teamActive;
    el.classList.toggle('on', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const input = $('#teamSearch');
  if (input) {
    if (teamActive >= 0 && opts[teamActive]) input.setAttribute('aria-activedescendant', opts[teamActive].id);
    else input.removeAttribute('aria-activedescendant');
  }
  if (opts[teamActive]) opts[teamActive].scrollIntoView({ block: 'nearest' });
}
function openTeamList() {
  const input = $('#teamSearch'), list = $('#teamList');
  if (!input || !list || input.disabled) return;
  const q = input.value.trim();
  const clear = $('#teamClear');
  if (clear) clear.hidden = !input.value;
  if (!q) { closeTeamList(); return; }
  const hits = teamHits(q);
  teamActive = hits.length ? 0 : -1;
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  list.innerHTML = hits.length ? hits.map((t, i) => {
    const g = teamGroups[t.name] || '';
    return `<div class="team-opt${i === 0 ? ' on' : ''}" role="option" id="team-opt-${i}" data-team="${esc(t.name)}" aria-selected="${i === 0 ? 'true' : 'false'}">${face(t.name, teamLogo(t.name), 'logo-img')}<span class="tn"><b>${esc(t.name)}</b></span>${g ? `<span class="grp">${esc(g)}</span>` : ''}</div>`;
  }).join('') : '<div class="team-none" role="status">No teams match</div>';
  if (teamActive >= 0) input.setAttribute('aria-activedescendant', 'team-opt-0');
}
function chooseTeam(name) {
  if (!name || !$('#team')) return;
  $('#team').value = name;
  const input = $('#teamSearch');
  if (input) input.value = name;
  const clear = $('#teamClear');
  if (clear) clear.hidden = false;
  closeTeamList();
  loadTeam();
}
function clearTeamSearch() {
  if ($('#team')) $('#team').value = '';
  const input = $('#teamSearch');
  if (input) input.value = '';
  const clear = $('#teamClear');
  if (clear) clear.hidden = true;
  closeTeamList();
  if (LEAGUE) { try { localStorage.removeItem('team_' + LEAGUE.code); } catch (e) {} }
  stopPoll();
  DATA = null;
  hideDock();
  $('#scraped').textContent = '';
  $('#main').innerHTML = welcomeHTML();
  if (input && !input.disabled) input.focus();
}
async function loadTeamGroups(league) {
  const name = league.seasons && league.seasons.current && league.seasons.current.name;
  const code = league.code;
  if (!name) return;
  try {
    const r = await fetch(`data/leagues/${code.toLowerCase()}/standings/${slug(name)}.json`, { cache: 'no-store' });
    if (!r.ok || !LEAGUE || LEAGUE.code !== code) return;
    const doc = await r.json();
    const g = {};
    for (const [team, row] of Object.entries(doc.teams || {})) if (row && row.group) g[team] = row.group;
    teamGroups = g;
    const list = $('#teamList');
    if (list && !list.hidden) openTeamList();
  } catch (e) {}
}
function resetTeamSearch() {
  indexTeams([]);
  teamGroups = {};
  if ($('#team')) { $('#team').innerHTML = '<option value="">Select a team</option>'; $('#team').disabled = true; }
  const input = $('#teamSearch');
  if (input) { input.value = ''; input.disabled = true; }
  const clear = $('#teamClear');
  if (clear) clear.hidden = true;
  closeTeamList();
}
function fillTeams(league, keep) {
  LEAGUE = league;
  teamGroups = {};
  $('#league').textContent = `${league.name} · ${league.seasons.current?.name || ''}`;
  const teams = league.teams || [];
  indexTeams(teams);
  $('#team').innerHTML = '<option value=""></option>' + teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('#team').disabled = false;
  const input = $('#teamSearch');
  if (input) input.disabled = false;
  if (keep && teams.includes(keep)) { $('#team').value = keep; if (input) input.value = keep; }
  else { $('#team').value = ''; if (input) input.value = ''; }
  const clear = $('#teamClear');
  if (clear) clear.hidden = !(input && input.value);
  closeTeamList();
  loadTeamGroups(league);
}
function watch(url, onHit) {
  stopPoll();
  const gen = pollGen;
  let n = 0;
  const max = 40;
  const hint = () => {
    const h = $('#pollhint'); if (!h) return;
    h.textContent = n >= max
      ? 'Coming Soon!'
      : `Checking every 30s… (${n}/${max})`;
  };
  const tick = async () => {
    if (gen !== pollGen) return;
    n++;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        if (gen !== pollGen) return;
        stopPoll();
        onHit(data);
        return;
      }
    } catch (e) {}
    if (n >= max && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    hint();
  };
  hint();
  pollTimer = setInterval(tick, 30000);
}
async function loadStandings(code, seasons) {
  const out = {};
  await Promise.all(['current', 'last'].map(async k => {
    const s = seasons && seasons[k];
    if (!s || !s.name) return;
    try {
      const r = await fetch(`data/leagues/${code.toLowerCase()}/standings/${slug(s.name)}.json`, { cache: 'no-store' });
      if (r.ok) out[k] = await r.json();
    } catch (e) {}
  }));
  return out;
}
let reportGen = 0;
const DDCL_SR = 64.42884569234461, DDCL_ECON = 4.36366880799429, DDCL_EXTRAS = 11.287581699346406;
let beatScale = { code: '', sr: 1, econ: 1, extras: 1 };
async function prepareBeatScale() {
  if (!LEAGUE) { beatScale = { code: '', sr: 1, econ: 1, extras: 1 }; return; }
  if (beatScale.code === LEAGUE.code) return;
  if (LEAGUE.code === 'DublinandDanvilleCricketLeague') {
    beatScale = { code: LEAGUE.code, sr: 1, econ: 1, extras: 1 };
    return;
  }
  const names = (LEAGUE.scanned && LEAGUE.scanned.length) ? LEAGUE.scanned : [];
  let br = 0, bb = 0, wr = 0, wb = 0, ex = 0, inns = 0;
  await Promise.all(names.map(async name => {
    try {
      const r = await fetch(`data/leagues/${LEAGUE.code.toLowerCase()}/teams/${slug(name)}.json`, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      for (const m of d.matches || []) {
        if (m.forfeit) continue;
        inns++;
        for (const b of m.batting || []) { br += b.r || 0; bb += b.b || 0; }
        for (const w of m.bowling || []) { wr += w.r || 0; wb += w.balls || 0; }
        if (m.extrasBowled) ex += (m.extrasBowled.wd || 0) + (m.extrasBowled.nb || 0);
        else for (const w of m.bowling || []) ex += (w.wd || 0) + (w.nb || 0);
      }
    } catch (e) {}
  }));
  beatScale = {
    code: LEAGUE.code,
    sr: bb ? (100 * br / bb) / DDCL_SR : 1,
    econ: wb ? (6 * wr / wb) / DDCL_ECON : 1,
    extras: inns ? (ex / inns) / DDCL_EXTRAS : 1
  };
}
async function showReport(data, gen = ++reportGen) {
  const standings = LEAGUE ? await loadStandings(LEAGUE.code, data.seasons) : {};
  if (gen !== reportGen || ($('#team').value && $('#team').value !== data.team)) return;
  DATA = data;
  DATA.standings = standings;
  if (!DATA.logo && teamLogo(DATA.team)) DATA.logo = teamLogo(DATA.team);
  $('#scraped').textContent = asOf(DATA);
  restoreTeamText();
  await prepareBeatScale();
  if (gen !== reportGen) return;
  render();
}
async function loadTeam() {
  const team = $('#team').value;
  if (!team || !LEAGUE) return;
  const gen = ++reportGen;
  stopPoll();
  remember('team_' + LEAGUE.code, team);
  msg('');
  DATA = null;
  hideDock();
  $('#scraped').textContent = '';
  const code = LEAGUE.code;
  const url = `data/leagues/${code.toLowerCase()}/teams/${slug(team)}.json`;
  let res;
  try { res = await fetch(url, { cache: 'no-store' }); }
  catch (e) { msg('Network error: ' + e.message); return; }
  if (res.ok) { const data = await res.json(); if (gen === reportGen) showReport(data, gen); return; }
  if (gen !== reportGen) return;
  const standings = LEAGUE ? await loadStandings(code, LEAGUE.seasons) : {};
  if (gen !== reportGen || $('#team').value !== team) return;
  DATA = { team, logo: teamLogo(team), seasons: LEAGUE && LEAGUE.seasons, matches: [], standings, unscanned: true };
  restoreTeamText();
  render();
}
function selectCached(code, team) {
  const league = leagueByCode(code);
  if (!league) return false;
  $('#leagueSel').value = league.code;
  $('#lg').value = '';
  remember('lg', league.code);
  const keep = team || recall('team_' + league.code);
  fillTeams(league, keep);
  if (keep && (league.teams || []).includes(keep)) loadTeam();
  else { stopPoll(); DATA = null; hideDock(); $('#scraped').textContent = ''; $('#main').innerHTML = welcomeHTML(); }
  return true;
}
async function addLeague(input) {
  msg('');
  const code = parseLeague(input);
  if (!code) { msg('Enter a league code like DublinandDanvilleCricketLeague or a cricclubs.com URL.'); return; }
  if (selectCached(code)) return;
  const leagueUrl = `data/leagues/${code.toLowerCase()}/league.json`;
  try {
    const r = await fetch(leagueUrl, { cache: 'no-store' });
    if (r.ok) {
      const league = await r.json();
      if (!leagueByCode(league.code)) CATALOG.push(league);
      if (![...$('#leagueSel').options].some(o => o.value === league.code)) {
        $('#leagueSel').insertAdjacentHTML('beforeend', `<option value="${esc(league.code)}">${esc(league.name)} · ${esc(league.code)}</option>`);
      }
      selectCached(league.code);
      return;
    }
  } catch (e) { msg('Network error: ' + e.message); return; }
  stopPoll();
  LEAGUE = null;
  DATA = null;
  $('#leagueSel').value = '';
  resetTeamSearch();
  $('#league').textContent = 'Not cached';
  $('#scraped').textContent = '';
  hideDock();
  $('#main').innerHTML = requestPanel('League not cached', 'Coming Soon!');
  watch(leagueUrl, async () => {
    try { await loadCatalog(); } catch (e) {}
    if (selectCached(code)) return;
    const again = await fetch(leagueUrl, { cache: 'no-store' });
    if (!again.ok) return;
    const league = await again.json();
    if (!leagueByCode(league.code)) CATALOG.push(league);
    selectCached(league.code);
  });
}
function ordinal(n) {
  const v = n % 100;
  const suf = (v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return n + suf;
}
function nrrText(n) {
  const x = Number(n);
  if (!isFinite(x)) return '–';
  return (x > 0 ? '+' : '') + x.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
function standingsHTML() {
  if (!DATA || !DATA.standings) return '';
  const p = $('#period').value;
  const keys = p === 'last' ? ['last'] : p === 'all' ? ['current', 'last'] : ['current'];
  return keys.map(k => {
    const doc = DATA.standings[k];
    const row = doc && doc.teams && doc.teams[DATA.team];
    if (!row) return '';
    const pos = `${ordinal(row.position)} of ${row.of}${row.group ? ' · ' + row.group : ''}`;
    const po = row.playoff ? `<p class="st-po${row.playoff.muted ? ' muted' : ''}">${esc(row.playoff.text)}</p>` : '';
    return card('🏆', 'Standings', `<div class="st-pos">${esc(pos)}</div><div class="st-line"><span><b>${row.played}</b> Played</span><span><b class="g">${row.won}</b> W</span><span><b class="r">${row.lost}</b> L</span><span><b>${row.nr}</b> NR</span><span><b class="y">${row.points}</b> Total points</span><span><b>${esc(nrrText(row.nrr))}</b> NRR</span></div>${po}`, doc.series && doc.series.name);
  }).join('');
}
function badgeHTML(name, url) {
  const letters = esc(ini(name));
  if (!url) return `<div class="badge">${letters}</div>`;
  return `<div class="badge has-logo">${face(name, url, 'logo-img')}<span class="fallback">${letters}</span></div>`;
}
function pick() {
  const p = $('#period').value, M = DATA.matches || [], S = DATA.seasons || {};
  if (p === 'last5') return [M.slice(0, 5), 'Last 5 matches'];
  if (p === 'current') return [M.filter(m => m.seriesId === S.current?.id), S.current?.name || 'Current season'];
  if (p === 'last') return [M.filter(m => m.seriesId === S.last?.id), (S.last?.name || 'Last season') + (S.last && !S.last.inSeason ? ' (did not play)' : '')];
  return [M, 'Both seasons'];
}
const wl = ms => ({ n: ms.length, w: ms.filter(m => m.outcome === 'W').length, l: ms.filter(m => m.outcome === 'L').length });
let psTab = 'bat';
const psSort = { bat: { k: 'r', d: -1 }, bowl: { k: 'w', d: -1 }, field: { k: 'tot', d: -1 }, total: { k: 'impact', d: -1 } };
const PAGE_TABS = [['overview', 'Overview'], ['gameplan', 'How to Beat Them'], ['results', 'Results'], ['players', 'Players'], ['stats', 'Player stats'], ['grounds', 'Grounds']];
let pageTab = 'overview';
function tabFromHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  if (!raw) return '';
  const id = (new URLSearchParams(raw).get('tab') || '').toLowerCase();
  return PAGE_TABS.some(t => t[0] === id) ? id : '';
}
function syncStick() {
  const bar = $('#bar');
  if (bar) document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px');
}
function hideDock() {
  const home = $('#teamRow');
  const wrap = $('#periodHome');
  if (wrap && home && wrap.parentElement !== home) home.appendChild(wrap);
  const dock = $('#dock');
  if (dock) { dock.hidden = true; dock.innerHTML = ''; }
}
function paintDock(label, n) {
  const dock = $('#dock');
  const wrap = $('#periodHome');
  if (!dock || !wrap) return;
  wrap.remove();
  const tabs = PAGE_TABS.map(([id, lab]) => `<button type="button" role="tab" id="tab-${id}" data-page-tab="${id}" aria-selected="${pageTab === id}" aria-controls="panel" class="${pageTab === id ? 'on' : ''}">${lab}</button>`).join('');
  dock.hidden = false;
  dock.innerHTML = `<div class="dock-in"><div class="dock-team"><div class="dock-face">${badgeHTML(DATA.team, DATA.logo || teamLogo(DATA.team))}</div><div class="dock-id"><div class="dock-name" title="${esc(DATA.team)}">${esc(DATA.team)}</div><div class="dock-sub">${esc(label)} · ${n} match${n === 1 ? '' : 'es'}</div></div><div class="dock-period"></div></div><div class="page-tabs" role="tablist" aria-label="Team sections">${tabs}</div></div>`;
  dock.querySelector('.dock-period').appendChild(wrap);
  const next = '#tab=' + pageTab;
  if (location.hash !== next) history.replaceState(null, '', location.pathname + location.search + next);
  syncStick();
  const on = dock.querySelector('.page-tabs .on');
  if (on) on.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}
function playerStatsHTML(ms, label) {
  const played = (ms || []).filter(m => !m.forfeit);
  const byName = {};
  const touch = (name, id) => {
    const x = byName[name] ??= { name, matches: new Set(), inn: 0, r: 0, b: 0, outs: 0, fours: 0, sixes: 0, thirties: 0, fifties: 0, hs: -1, hsNo: false, no: 0, balls: 0, br: 0, w: 0, dots: 0, wd: 0, nb: 0, bw: -1, bbr: 0, spells: 0, c: 0, k: 0, ro: 0, st: 0 };
    if (id) x.matches.add(id);
    return x;
  };
  for (const m of played) {
    for (const b of m.batting || []) {
      const x = touch(b.name, m.id);
      const runs = b.r || 0;
      x.inn++; x.r += runs; x.b += b.b || 0; x.outs += b.out ? 1 : 0; x.fours += b.f || 0; x.sixes += b.s || 0;
      if (!b.out) x.no++;
      if (runs >= 50) x.fifties++;
      else if (runs >= 30) x.thirties++;
      if (runs > x.hs || (runs === x.hs && !b.out)) { x.hs = runs; x.hsNo = !b.out; }
    }
    for (const w of m.bowling || []) {
      const x = touch(w.name, m.id);
      const wkts = w.w || 0, conc = w.r || 0;
      x.spells++; x.balls += w.balls || 0; x.br += conc; x.w += wkts; x.dots += w.dots || 0; x.wd += w.wd || 0; x.nb += w.nb || 0;
      if (wkts > x.bw || (wkts === x.bw && conc < x.bbr)) { x.bw = wkts; x.bbr = conc; }
    }
    for (const [n, k, c] of m.fielding || []) {
      const x = touch(n, m.id);
      if (k === 'c') x.c += c;
      else if (k === 'k') x.k += c;
      else if (k === 'r') x.ro += c;
      else if (k === 's') x.st += c;
    }
  }
  const rows = Object.values(byName).map(x => {
    const bowls = x.balls >= 12 || x.w >= 1, bats = x.b >= 12 || x.r >= 15;
    const roleRank = (x.k ? 4 : 0) + (bowls && bats ? 3 : bowls ? 2 : (bats || x.inn) ? 1 : 0);
    const bits = [];
    if (x.k) bits.push('<span class="role wk">WK</span>');
    if (bowls && bats) bits.push('<span class="role ar">All-rounder</span>');
    else if (bowls) bits.push('<span class="role bowl">Bowler</span>');
    else if (bats || x.inn) bits.push('<span class="role bat">Batter</span>');
    return {
      ...x, mat: x.matches.size, miles: x.fifties * 100 + x.thirties, tot: x.c + x.k + x.ro + x.st, ctRo: x.c + x.k + x.ro,
      sr: x.b ? 100 * x.r / x.b : NaN, avg: x.outs ? x.r / x.outs : NaN, econ: x.balls ? 6 * x.br / x.balls : NaN,
      bavg: x.w ? x.br / x.w : NaN, bsr: x.w ? x.balls / x.w : NaN, dotp: x.balls ? 100 * x.dots / x.balls : NaN,
      bound: x.r ? 100 * (4 * x.fours + 6 * x.sixes) / x.r : NaN, bestKey: x.bw < 0 ? NaN : x.bw * 1000 - x.bbr,
      impact: (x.b ? x.r * x.r / x.b : 0) + 25 * x.w, roleRank, role: `<span class="roles">${bits.join('')}</span>`
    };
  });
  const show = {
    bat: rows.filter(x => x.inn > 0),
    bowl: rows.filter(x => x.spells > 0),
    field: rows.filter(x => x.tot > 0),
    total: rows
  }[psTab] || rows;
  const spec = {
    bat: [['name', 'Player', 1], ['inn', 'Inns', -1], ['r', 'Runs', -1], ['b', 'Balls', -1], ['sr', 'SR', -1], ['avg', 'Avg', -1], ['hs', 'HS', -1], ['no', 'NO', -1], ['fours', '4s', -1], ['sixes', '6s', -1], ['miles', '30s/50s', -1], ['bound', 'Boundary%', -1]],
    bowl: [['name', 'Player', 1], ['balls', 'Ov', -1], ['br', 'Runs', -1], ['w', 'Wkts', -1], ['econ', 'Econ', 1], ['bavg', 'Avg', 1], ['bsr', 'SR', 1], ['bestKey', 'Best', -1], ['dotp', 'Dot%', -1], ['wd', 'Wd', -1], ['nb', 'Nb', -1]],
    field: [['name', 'Player', 1], ['c', 'Ct', -1], ['k', 'WK ct', -1], ['ro', 'Run outs', -1], ['st', 'Stumpings', -1], ['tot', 'Total', -1]],
    total: [['name', 'Player', 1], ['mat', 'Mat', -1], ['r', 'Runs', -1], ['w', 'Wkts', -1], ['ctRo', 'Ct+RO', -1], ['impact', 'Impact', -1], ['roleRank', 'Role', -1]]
  }[psTab];
  const sort = psSort[psTab];
  const num = v => typeof v === 'number' && isFinite(v);
  const blank = v => v == null || v === '' || (typeof v === 'number' && !isFinite(v));
  show.sort((a, b) => {
    const av = a[sort.k], bv = b[sort.k];
    const aBlank = blank(av), bBlank = blank(bv);
    if (aBlank || bBlank) {
      if (aBlank && bBlank) return a.name.localeCompare(b.name);
      return aBlank ? 1 : -1;
    }
    if (typeof av === 'string' || typeof bv === 'string') {
      const c = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      if (c) return sort.d * c;
    } else if (av !== bv) return sort.d * (av - bv);
    if (sort.k === 'w' && num(a.econ) && num(b.econ) && a.econ !== b.econ) return a.econ - b.econ;
    return a.name.localeCompare(b.name);
  });
  const cell = (x, k) => {
    if (k === 'name') return esc(x.name);
    if (k === 'balls') return ov(x.balls);
    if (k === 'hs') return x.hs < 0 ? '–' : `${x.hs}${x.hsNo ? '*' : ''}`;
    if (k === 'miles') return `${x.thirties}/${x.fifties}`;
    if (k === 'bestKey') return x.bw < 0 ? '–' : `${x.bw}/${x.bbr}`;
    if (k === 'roleRank') return x.role;
    if (k === 'bound' || k === 'dotp') return num(x[k]) ? Math.round(x[k]) + '%' : '–';
    if (['sr', 'avg', 'econ', 'bavg', 'bsr', 'impact'].includes(k)) return f1(x[k]);
    return x[k];
  };
  const head = spec.map(([k, lab, first]) => {
    const on = sort.k === k;
    const arrow = on ? `<span class="ps-arrow" aria-hidden="true">${sort.d < 0 ? '▼' : '▲'}</span>` : '';
    return `<th${on ? ` aria-sort="${sort.d < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" class="ps-sort${on ? ' on' : ''}" data-ps-sort="${k}" data-ps-first="${first}" aria-label="Sort by ${lab}">${lab}${arrow}</button></th>`;
  }).join('');
  const body = show.map(x => `<tr>${spec.map(([k]) => `<td>${cell(x, k)}</td>`).join('')}</tr>`).join('');
  const tabs = [['bat', 'Batting'], ['bowl', 'Bowling'], ['field', 'Fielding'], ['total', 'Total']].map(([id, lab]) => `<button type="button" class="${psTab === id ? 'on' : ''}" data-ps-tab="${id}" aria-pressed="${psTab === id}">${lab}</button>`).join('');
  const table = show.length ? `<div class="ps-scroll"><table><tr>${head}</tr>${body}</table></div>` : '<p class="note">Nobody in this period.</p>';
  const foot = psTab === 'total'
    ? 'Impact is runs² ÷ balls, plus 25 per wicket. Role: WK from keeper catches; all-rounder when they both bat and bowl.'
    : 'Every player who appears in this period. Tap a column to sort. Swipe for the rest — the name stays put.';
  return card('📊', 'Player stats', `<div class="ps-tabs" role="tablist">${tabs}</div>${table}<div class="note">${foot}</div>`, label);
}
const card = (icon, t, h, tag) => `<section class="card"><div class="ch"><span class="ic" aria-hidden="true">${icon}</span><h2>${t}</h2>${tag ? `<span class="tag">${tag}</span>` : ''}</div>${h}</section>`;
const tbl = (cols, rows) => `<table><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
function donut(parts, center) {
  const tot = parts.reduce((s, p) => s + p.v, 0) || 1; let a = 0; const R = 40, C = 2 * Math.PI * R;
  const arcs = parts.map(p => { const len = C * p.v / tot, s = `<circle r="${R}" cx="50" cy="50" fill="none" stroke="${p.c}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-a}" transform="rotate(-90 50 50)"/>`; a += len; return s; }).join('');
  return `<svg class="donut" viewBox="0 0 100 100" role="img" aria-label="${parts.map(p => p.l + ' ' + p.v).join(', ')}"><circle r="${R}" cx="50" cy="50" fill="none" stroke="#ffffff10" stroke-width="14"/>${arcs}<text x="50" y="49" text-anchor="middle" fill="#eef5f0" font-size="20" font-family="Bebas Neue,Impact,sans-serif">${center[0]}</text><text x="50" y="63" text-anchor="middle" fill="#9fb5a8" font-size="8">${center[1]}</text></svg><div class="leg">${parts.map(p => `<span><i style="background:${p.c}"></i>${p.l} ${p.v}</span>`).join('')}</div>`;
}
function render() {
  if (!DATA) { hideDock(); return; }
  const [ms, label] = pick(); const half = $('#period').value === 'last5';
  $('#scraped').textContent = asOf(DATA);
  paintDock(label, ms.length);
  const stand = standingsHTML();
  if (DATA.unscanned) {
    $('#main').innerHTML = `<div id="panel" role="tabpanel">${stand}${card('📋', 'Match detail', '<p>Not scanned yet. Standings for this team are above. Match and player detail will show up after a scan.</p>')}</div>`;
    return;
  }
  const played = ms.filter(m => !m.forfeit), o = wl(ms); const us = m => (m.innings || []).find(i => i.team === DATA.team), them = m => (m.innings || []).find(i => i.team !== DATA.team);
  const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : NaN;
  const bat = {}, bowl = {}, fld = {};
  for (const m of played) {
    for (const b of m.batting || []) { const x = bat[b.name] ??= { name: b.name, inn: 0, r: 0, b: 0, outs: 0, hs: -1, no: false }; x.inn++; x.r += b.r; x.b += b.b; x.outs += b.out ? 1 : 0; if (b.r > x.hs || (b.r === x.hs && !b.out)) { x.hs = b.r; x.no = !b.out; } }
    for (const w of m.bowling || []) { const x = bowl[w.name] ??= { name: w.name, balls: 0, r: 0, w: 0, bw: -1, br: 0 }; x.balls += w.balls; x.r += w.r; x.w += w.w; if (w.w > x.bw || (w.w === x.bw && w.r < x.br)) { x.bw = w.w; x.br = w.r; } }
    for (const [n, k, c] of m.fielding || []) { const x = fld[n] ??= { name: n, c: 0, k: 0, r: 0, s: 0 }; x[k] += c; }
  }
  const B = Object.values(bat), W = Object.values(bowl), sr = x => x.b ? 100 * x.r / x.b : NaN, ec = x => x.balls ? 6 * x.r / x.balls : NaN, imp = x => x.b ? x.r * x.r / x.b : 0;
  const minInn = half ? 2 : 3, minB = half ? 15 : 30, minOv = half ? 2 : 6; const qB = B.filter(x => x.inn >= minInn && x.b >= minB), qW = W.filter(x => x.balls >= minOv * 6);
  const topBat = [...qB].sort((a, b) => imp(b) - imp(a)).slice(0, 6), topBowl = [...qW].sort((a, b) => b.w - a.w || ec(a) - ec(b)).slice(0, 6), eco = [...qW].sort((a, b) => ec(a) - ec(b)).slice(0, 5);
  const poorBat = qB.filter(x => sr(x) <= 45).sort((a, b) => sr(a) - sr(b)).slice(0, 4), poorBowl = [...qW].sort((a, b) => ec(b) - ec(a)).slice(0, 4);
  const teamRuns = played.reduce((s, m) => { const i = us(m); return s + (i ? Number(i.runs) || 0 : 0); }, 0);
  const lowBat = B.filter(x => x.inn >= minInn).sort((a, b) => a.r - b.r || b.inn - a.inn || a.name.localeCompare(b.name)).slice(0, 4);
  const runLead = [...B].sort((a, b) => b.r - a.r)[0], wkLead = [...W].sort((a, b) => b.w - a.w)[0];
  const role = n => { const isB = qB.some(x => x.name === n), isW = qW.some(x => x.name === n); return (fld[n]?.k ? '<span class="role wk">WK</span>' : '') + (isB && isW ? '<span class="role ar">All-rounder</span>' : isW ? '<span class="role bowl">Bowler</span>' : isB ? '<span class="role bat">Batter</span>' : ''); };
  const pl = (i, n, sub, val, k, barPct, col) => `<div class="pl"><span class="rank">${i}</span><span class="av" style="background:${hue(n)}">${esc(ini(n))}</span><div class="pn"><b>${esc(n)}</b><div class="roles">${role(n)}</div><span>${sub}</span><div class="mbar"><i style="width:${Math.max(4, barPct)}%;background:${col};animation-delay:${i * 60}ms"></i></div></div><div class="big"><div class="v">${val}</div><div class="k">${k}</div></div></div>`;
  const ourI = played.map(us).filter(Boolean), oppI = played.map(them).filter(Boolean);
  const bf = played.filter(m => m.battedFirst === true), ch = played.filter(m => m.battedFirst === false), a = wl(bf), c = wl(ch);
  const tw = played.filter(m => m.tossWonByUs), tb = tw.filter(m => m.tossDecision === 'bat'), tbo = tw.filter(m => m.tossDecision === 'bowl'), tl = played.filter(m => m.tossWonByUs === false);
  const formBits = ms.slice(0, 12).map((m, i) => `<span class="fc ${m.outcome}" style="animation-delay:${i * 40}ms" title="${esc(m.date + ' vs ' + m.opponent)}">${m.outcome}</span>`).join('');
  const formCard = card('📈', 'Recent form', `${formBits ? `<div class="form" aria-label="Recent form">${formBits}</div>` : '<p class="note">No completed matches in this period.</p>'}<p class="hsum">${o.w}–${o.l} record.${runLead ? ` <b>${esc(runLead.name)}</b> leads the runs (${runLead.r})` : ''}${wkLead ? `, <b>${esc(wkLead.name)}</b> the wickets (${wkLead.w}).` : ''}</p>`, label);
  const tiles = `<div class="tiles"><div class="tile"><div class="v"><span class="g">${o.w}</span>–<span class="r">${o.l}</span></div><div class="k">Record</div></div><div class="tile"><div class="v y">${pct(o.w, o.n)}</div><div class="k">Win rate</div></div><div class="tile"><div class="v">${f1(avg(ourI.map(i => i.runs))).replace('.0', '')}</div><div class="k">Avg score</div><div class="s">conc. ${f1(avg(oppI.map(i => i.runs))).replace('.0', '')}</div></div>
 <div class="tile"><div class="v">${pct(a.w, a.n)}</div><div class="k">Bat first win</div><div class="s">${a.w}/${a.n}</div></div><div class="tile"><div class="v">${pct(c.w, c.n)}</div><div class="k">Chasing win</div><div class="s">${c.w}/${c.n}</div></div><div class="tile"><div class="v">${pct(tw.length, played.length)}</div><div class="k">Tosses won</div><div class="s">${tw.length}/${played.length}</div></div></div>`;
  const resultCard = m => {
    const when = [m.date, m.ground].filter(Boolean).join(' · ');
    const href = `https://cricclubs.com/${encodeURIComponent(LEAGUE.code)}/results/${encodeURIComponent(m.id)}`;
    const head = `<div class="res-h"><span class="fc ${esc(m.outcome)}">${esc(m.outcome)}</span><div class="res-opp"><b>vs ${esc(m.opponent)}</b>${face(m.opponent, teamLogo(m.opponent), 'res-logo')}</div><div class="res-when">${esc(when)}</div></div>`;
    let board;
    if (m.forfeit || !(m.innings || []).length) board = '<div class="res-empty">Forfeit – no play</div>';
    else {
      const inns = m.innings.slice();
      if (m.battedFirst != null) inns.sort((a, b) => ((a.team === DATA.team) === (m.battedFirst === true) ? 0 : 1) - ((b.team === DATA.team) === (m.battedFirst === true) ? 0 : 1));
      const winner = m.outcome === 'W' ? DATA.team : m.outcome === 'L' ? m.opponent : '';
      board = `<div class="res-board">${inns.map(i => {
        const mark = !winner ? '' : i.team === winner ? 'is-win' : 'is-lose';
        const ov = i.overs == null || i.overs === '' ? '' : `${esc(String(i.overs))} ov`;
        return `<div class="res-side ${mark}">${face(i.team, teamLogo(i.team), 'res-logo')}<span class="res-name">${esc(i.team)}</span><span class="res-score">${esc(String(i.runs))}/${esc(String(i.wkts))}</span><span class="res-ov">${ov}</span></div>`;
      }).join('')}</div>`;
    }
    return `<div class="res">${head}${board}<div class="res-f"><span class="res-sum" title="${esc(m.result || '')}">${esc(m.result || '')}</span><a href="${href}" target="_blank" rel="noopener">Scorecard</a></div></div>`;
  };
  const resultsCard = card('📋', 'Last results', ms.length ? ms.slice(0, 10).map(resultCard).join('') : '<p class="note">No completed matches in this period.</p>');
  const note = t => `<div class="note">${t}${half ? ' · reduced for last 5' : ''}</div>`; const mxI = Math.max(1, ...topBat.map(imp)), mxW = Math.max(1, ...topBowl.map(x => x.w)), mxE = Math.max(1, ...eco.map(ec));
  const watchCard = card('⭐', 'Players to watch', `<h3>Batters</h3>${topBat.map((x, i) => pl(i + 1, x.name, `${x.r} runs · ${x.inn} inns · best ${x.hs}${x.no ? '*' : ''} · avg ${f1(x.outs ? x.r / x.outs : NaN)}`, f1(sr(x)), 'Strike rate', 100 * imp(x) / mxI, 'var(--sky)')).join('') || '<p class="note">Nobody qualifies yet.</p>'}${note(`${minInn}+ inns & ${minB}+ balls · ranked by runs × SR ÷ 100`)}
 <h3>Wicket takers</h3>${topBowl.map((x, i) => pl(i + 1, x.name, `${ov(x.balls)} ov · econ ${f1(ec(x))} · best ${x.bw}/${x.br}`, x.w, 'Wickets', 100 * x.w / mxW, 'var(--red)')).join('') || '<p class="note">Nobody qualifies yet.</p>'}${note(`${minOv}+ overs · ranked by wickets, then economy`)}
 <h3>Most economical</h3>${eco.map((x, i) => pl(i + 1, x.name, `${ov(x.balls)} ov · ${x.w} wkts`, f1(ec(x)), 'Economy', 100 * (1 - ec(x) / (mxE * 1.15)), 'var(--green)')).join('')}${note(`${minOv}+ overs · lowest runs per over`)}`, label);
  const F = Object.values(fld).sort((a, b) => (b.c + b.k + b.r + b.s) - (a.c + a.k + a.r + a.s));
  const fieldCard = F.length ? card('🧤', 'Fielders', tbl(['Fielder', 'Ct', 'WK', 'RO', 'St', 'Tot'], F.slice(0, 10).map(x => [`<span class="av" style="background:${hue(x.name)};width:26px;height:26px;font-size:10px;display:inline-grid;vertical-align:middle;margin-right:6px">${esc(ini(x.name))}</span>${esc(x.name)}`, x.c, x.k, x.r, x.s, `<b class="y">${x.c + x.k + x.r + x.s}</b>`])) + `<div class="note">From opponent dismissal text; shared run-outs credit each fielder.${DATA.unresolvedFielders ? ` ${DATA.unresolvedFielders} name(s) unmatched.` : ''}</div>`) : '';
  const slowRows = poorBat.length
    ? tbl(['Batter', 'SR', 'Runs', 'Balls'], poorBat.map(x => [esc(x.name), `<b class="r">${f1(sr(x))}</b>`, x.r, x.b])) + note(`SR 45 or under · ${minInn}+ inns & ${minB}+ balls`)
    : `<p class="note">Nobody under SR 45 (min ${minInn} inns & ${minB} balls)</p>`;
  const weakCard = card('📉', 'Weak spots', `<h3>Slowest scorers</h3>${slowRows}<h3>Most expensive</h3>${tbl(['Bowler', 'Econ', 'Ov', 'Wkts'], poorBowl.map(x => [esc(x.name), `<b class="r">${f1(ec(x))}</b>`, ov(x.balls), x.w]))}${note(`${minOv}+ overs`)}<h3>Lowest batting contribution</h3>${tbl(['Batter', 'Runs', 'Inns', 'Avg', 'Share'], lowBat.map(x => [esc(x.name), x.r, x.inn, f1(x.outs ? x.r / x.outs : NaN), `<b class="r">${pct(x.r, teamRuns)}</b>`]))}${note(`${minInn}+ inns · no balls minimum · % of team runs`)}`);
  const vs = (lab, w, n) => `<div class="vsr"><div class="lab"><span>${lab}</span><span><b>${w}</b>/${n} won · ${pct(w, n)}</span></div><div class="track"><i style="width:${n ? 100 * w / n : 0}%;background:var(--green)"></i><i style="width:${n ? 100 * (n - w) / n : 0}%;background:var(--red);opacity:.85"></i></div></div>`;
  const matchCard = card('📊', 'Match-ups & toss', `<div class="vs">${vs('🏏 Batting first', a.w, a.n)}${vs('🎯 Chasing', c.w, c.n)}${vs('🪙 Won toss', wl(tw).w, tw.length)}${vs('Lost toss', wl(tl).w, tl.length)}</div>
 <div class="charts" style="margin-top:12px"><div class="chart"><div class="t">Toss decision</div>${donut([{ l: 'Bat', v: tb.length, c: '#4cc3ff' }, { l: 'Bowl', v: tbo.length, c: '#ff4d5e' }], [tw.length, 'tosses won'])}</div>
 <div class="chart"><div class="t">Results</div>${donut([{ l: 'Won', v: o.w, c: '#2fd27a' }, { l: 'Lost', v: o.l, c: '#ff4d5e' }], [pct(o.w, o.n), 'win rate'])}</div></div>
 ${tbl(['After toss', 'P', 'W', 'Win%'], [['Won → bat', tb.length, wl(tb).w, pct(wl(tb).w, tb.length)], ['Won → bowl', tbo.length, wl(tbo).w, pct(wl(tbo).w, tbo.length)], ['Lost toss', tl.length, wl(tl).w, pct(wl(tl).w, tl.length)]])}`);
  const notes = []; if (tw.length) notes.push(`Toss winners choose to <b>${tbo.length >= tb.length ? 'bowl' : 'bat'}</b> (${Math.max(tbo.length, tb.length)}/${tw.length}).`);
  if (a.n && c.n) notes.push(`Win rate batting first ${pct(a.w, a.n)} vs chasing ${pct(c.w, c.n)} — ${a.w / a.n > c.w / c.n ? 'stronger setting a total' : a.w / a.n < c.w / c.n ? 'stronger chasing; consider batting first' : 'no clear edge'}.`);
  const ft = bf.map(us).filter(Boolean).map(i => i.runs); if (ft.length) notes.push(`First-innings totals average <b>${Math.round(avg(ft))}</b> (range ${Math.min(...ft)}–${Math.max(...ft)}).`);
  if (ourI.length) notes.push(`Bowled out in <b>${ourI.filter(i => i.wkts >= 10).length}</b> of ${ourI.length} innings.`);
  const tot = B.reduce((s, x) => s + x.r, 0), t2 = [...B].sort((a, b) => b.r - a.r).slice(0, 2); if (tot && t2.length === 2) notes.push(`${esc(t2[0].name)} and ${esc(t2[1].name)} make <b>${pct(t2[0].r + t2[1].r, tot)}</b> of bat runs — get them early.`);
  const notesCard = card('🧠', 'Strategy notes', notes.length ? `<ul class="notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : '<p class="note">No notes for this period.</p>');
  const g = {}; for (const m of ms) if (m.ground) (g[m.ground] ??= []).push(m); const gs = Object.entries(g).map(([name, l]) => ({ name, ...wl(l) }));
  const gc = (l, bad) => l.length ? `<div class="grounds">${l.map(x => `<div class="gc ${bad ? 'bad' : ''}"><div class="gn"><b>${esc(x.name)}${x.n < 2 ? '<span class="thin">THIN</span>' : ''}</b><span>${x.w}W · ${x.l}L · ${x.n} played</span></div><div class="gp ${bad ? 'r' : 'g'}">${pct(x.w, x.n)}</div></div>`).join('')}</div>` : '<p class="note">None.</p>';
  const favCard = card('🏟️', 'Favourite grounds', gc(gs.filter(x => x.w).sort((p, q) => q.w / q.n - p.w / p.n || q.n - p.n).slice(0, 4)), 'best win %');
  const jinxCard = card('🙈', 'Jinxed grounds', gc(gs.filter(x => x.l).sort((p, q) => p.w / p.n - q.w / q.n || q.n - p.n).slice(0, 4), true), 'worst win %');
  const plan = howToBeat() || '<p class="note">Nothing to flag in this window.</p>';
  const panels = {
    overview: formCard + stand + tiles + matchCard + notesCard,
    results: resultsCard,
    players: watchCard + fieldCard + weakCard,
    stats: playerStatsHTML(ms, label),
    grounds: favCard + jinxCard,
    gameplan: plan
  };
  $('#main').innerHTML = `<div id="panel" role="tabpanel" aria-labelledby="tab-${pageTab}">${panels[pageTab] || panels.overview}</div>`;
  function howToBeat() {
    const recent = (DATA.matches || []).slice(0, 5);
    const agg = list => {
      const played = list.filter(m => !m.forfeit);
      const usInn = m => (m.innings || []).find(i => i.team === DATA.team);
      const bat = {}, bowl = {}, fld = {}, seen = new Set();
      let teamRuns = 0;
      for (const m of played) {
        const inn = usInn(m); if (inn) teamRuns += Number(inn.runs) || 0;
        for (const b of m.batting || []) {
          seen.add(b.name);
          const x = bat[b.name] ??= { name: b.name, inn: 0, r: 0, b: 0, outs: 0, f: 0, s: 0, how: {}, posSum: 0, posN: 0 };
          x.inn++; x.r += b.r || 0; x.b += b.b || 0; x.outs += b.out ? 1 : 0; x.f += b.f || 0; x.s += b.s || 0;
          if (b.how) x.how[b.how] = (x.how[b.how] || 0) + 1;
          if (b.pos) { x.posSum += b.pos; x.posN++; }
        }
        (m.bowling || []).forEach((w, i) => {
          seen.add(w.name);
          const x = bowl[w.name] ??= { name: w.name, balls: 0, r: 0, w: 0, dots: 0, wd: 0, nb: 0, f: 0, s: 0, bounds: 0, spells: 0, opens: 0 };
          x.balls += w.balls || 0; x.r += w.r || 0; x.w += w.w || 0; x.dots += w.dots || 0; x.wd += w.wd || 0; x.nb += w.nb || 0;
          if (w.f != null || w.s != null) { x.f += w.f || 0; x.s += w.s || 0; x.bounds++; }
          if (i < 2) x.opens++;
          x.spells++;
        });
        for (const [n, k, c] of m.fielding || []) { seen.add(n); const x = fld[n] ??= { c: 0, k: 0, r: 0, s: 0 }; x[k] += c; }
      }
      const B = Object.values(bat), W = Object.values(bowl);
      const srX = x => x.b ? 100 * x.r / x.b : NaN;
      const ecX = x => x.balls ? 6 * x.r / x.balls : NaN;
      const imp = x => x.b ? x.r * x.r / x.b : 0;
      const bf = played.filter(m => m.battedFirst === true), ch = played.filter(m => m.battedFirst === false);
      const twM = played.filter(m => m.tossWonByUs);
      return { played, usInn, B, W, fld, seen, teamRuns, srX, ecX, imp, bf, ch, a: wl(bf), c: wl(ch), twM, tb: twM.filter(m => m.tossDecision === 'bat'), tbo: twM.filter(m => m.tossDecision === 'bowl') };
    };
    const bPct = x => x.r ? 100 * (4 * x.f + 6 * x.s) / x.r : 0;
    const dotEst = x => {
      const other = Math.max(0, x.r - 4 * x.f - 6 * x.s);
      const dots = x.b - x.f - x.s - other;
      return x.b > 0 && dots >= 0 ? 100 * dots / x.b : null;
    };
    const posOf = x => x.posN ? x.posSum / x.posN : null;
    const posTxt = x => { const p = posOf(x); return p == null ? '' : `usually bats at ${Math.round(p)}`; };
    const howInfo = how => {
      const caught = (how.ct || 0) + (how.ctw || 0), timber = (how.b || 0) + (how.lbw || 0);
      const n = Object.values(how || {}).reduce((s, v) => s + v, 0);
      return { n, caught, timber, caughtMaj: n >= 2 && caught / n >= 0.5, timberMaj: n >= 2 && timber / n >= 0.5,
        text: n >= 2 ? `${caught} caught, ${timber} bowled/lbw of ${n} outs` : '' };
    };
    const R = agg(recent);
    const minOvBalls = 24;
    const seasonId = DATA.seasons && DATA.seasons.current && DATA.seasons.current.id;
    const scope = [];
    const scopeIds = new Set();
    for (const m of recent.concat((DATA.matches || []).filter(m => !seasonId || m.seriesId === seasonId))) {
      if (!m || scopeIds.has(m.id)) continue;
      scopeIds.add(m.id);
      scope.push(m);
    }
    const G = agg(scope);
    const cap = 4;
    const joinNames = items => items.length < 2 ? (items[0] || '') : items.length === 2 ? `${items[0]} and ${items[1]}` : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
    const extraTxt = x => {
      const bits = [];
      if (x.wd) bits.push(`${x.wd} wide${x.wd === 1 ? '' : 's'}`);
      if (x.nb) bits.push(`${x.nb} no-ball${x.nb === 1 ? '' : 's'}`);
      return bits.length ? `, ${bits.join(' and ')}` : '';
    };
    const srK = beatScale.sr || 1, ecK = beatScale.econ || 1, exK = beatScale.extras || 1;
    const sloggerSr = 130 * srK, rotHi = 125 * srK, rotLo = 90 * srK, rotFloor = 65 * srK, slowSr = 45 * srK;
    const attackAbs = 7.5 * ecK, seeAbs = 7.2 * ecK, seeGap = 0.3 * ecK, extrasFloor = 8 * exK;
    const mainB = G.B.filter(x => x.inn >= 3 && x.b >= 30);
    const sloggers = [], rotators = [], slowStarters = [];
    for (const x of mainB) {
      const rate = G.srX(x), bound = bPct(x), dots = dotEst(x), d = howInfo(x.how);
      const sixShare = x.r ? 6 * x.s / x.r : 0;
      const row = { x, rate, bound, dots, d, dotBalls: dots == null ? 0 : dots / 100 * x.b };
      if (rate >= sloggerSr || bound >= 50 || (x.s >= 3 && sixShare >= 0.3)) sloggers.push(row);
      else if (dots != null && dots <= 45 && bound <= 45 && ((rate >= rotLo && rate <= rotHi) || (rate >= rotFloor && rate < rotLo && bound <= 20))) rotators.push(row);
      else if (rate <= slowSr) slowStarters.push(row);
    }
    sloggers.sort((p, q) => (q.x.s - p.x.s) || (q.bound - p.bound) || (q.rate - p.rate));
    rotators.sort((p, q) => q.x.r - p.x.r || (p.dots ?? 99) - (q.dots ?? 99));
    slowStarters.sort((p, q) => p.rate - q.rate || q.x.b - p.x.b);
    const batStat = (row, extra) => {
      const where = posTxt(row.x);
      return `${esc(row.x.name)} (SR ${f1(row.rate)}, ${row.x.r} off ${row.x.b}${extra}${where ? ', ' + where : ''})`;
    };
    const dismissal = (rows, deep) => {
      const caught = rows.filter(r => r.d.caughtMaj).length, timber = rows.filter(r => r.d.timberMaj).length;
      if (caught >= Math.ceil(rows.length / 2) && caught >= timber) return deep ? ' They are often caught — keep catchers in the deep.' : ' They are often caught — keep a catcher in the ring.';
      if (timber >= Math.ceil(rows.length / 2)) return ' They are often bowled or lbw — attack the stumps.';
      return '';
    };
    const sections = [];
    const scopePlayed = scope.filter(m => !m.forfeit && m.battedFirst != null);
    const setting = scopePlayed.filter(m => m.battedFirst === true);
    const chasing = scopePlayed.filter(m => m.battedFirst === false);
    const sw = wl(setting), cw = wl(chasing);
    if (sw.n >= 2 && cw.n >= 2 && Math.abs(sw.w / sw.n - cw.w / cw.n) >= 0.1) {
      const chaseBetter = cw.w / cw.n > sw.w / sw.n;
      const won = (chaseBetter ? chasing : setting).filter(m => m.outcome === 'W');
      const byName = {};
      if (chaseBetter) {
        for (const m of won) for (const b of m.batting || []) {
          const x = byName[b.name] ??= { name: b.name, r: 0, b: 0 };
          x.r += b.r || 0; x.b += b.b || 0;
        }
      } else {
        for (const m of won) for (const w of m.bowling || []) {
          const x = byName[w.name] ??= { name: w.name, r: 0, b: 0, w: 0 };
          x.w = (x.w || 0) + (w.w || 0); x.r += w.r || 0; x.b += w.balls || 0;
        }
      }
      const top = Object.values(byName).sort((p, q) => chaseBetter ? q.r - p.r : (q.w - p.w) || (p.b ? p.r / p.b : 9) - (q.b ? q.r / q.b : 9)).slice(0, 2);
      const who = top.map(x => chaseBetter
        ? `${esc(x.name)} (${x.r} runs off ${x.b}, SR ${f1(x.b ? 100 * x.r / x.b : NaN)} in those wins)`
        : `${esc(x.name)} (${x.w} wickets, econ ${f1(x.b ? 6 * x.r / x.b : NaN)} in those wins)`).join(' and ');
      const sample = `${scopePlayed.length} matches (this season and the last 5)`;
      const record = `they've won ${sw.w}/${sw.n} setting a total and ${cw.w}/${cw.n} chasing, ${sample}`;
      const html = chaseBetter
        ? `<b>Toss plan.</b> Win the toss: bowl first and make them bat first and set a total (${record}). Lose the toss and you bat first: be very disciplined, because their chasers ${who} win it for them.`
        : `<b>Toss plan.</b> Win the toss: bat first and make them chase (${record}). Lose the toss and you bowl first: be very disciplined, because their bowlers ${who} win it when they are setting a total.`;
      sections.push(html);
    } else {
      const chaseBetter = (cw.n ? cw.w / cw.n : 0) > (sw.n ? sw.w / sw.n : 0);
      const pool = chaseBetter ? chasing : setting;
      const won = pool.filter(m => m.outcome === 'W');
      const source = won.length ? won : pool;
      const byName = {};
      if (chaseBetter) {
        for (const m of source) for (const b of m.batting || []) {
          const x = byName[b.name] ??= { name: b.name, r: 0, b: 0 };
          x.r += b.r || 0; x.b += b.b || 0;
        }
      } else {
        for (const m of source) for (const w of m.bowling || []) {
          const x = byName[w.name] ??= { name: w.name, r: 0, b: 0, w: 0 };
          x.w = (x.w || 0) + (w.w || 0); x.r += w.r || 0; x.b += w.balls || 0;
        }
      }
      const top = Object.values(byName).sort((p, q) => chaseBetter ? q.r - p.r : (q.w - p.w) || (p.b ? p.r / p.b : 9) - (q.b ? q.r / q.b : 9)).slice(0, 2);
      const inWhat = won.length ? 'in those wins' : 'in this sample';
      const who = top.map(x => chaseBetter
        ? `${esc(x.name)} (${x.r} runs off ${x.b}, SR ${f1(x.b ? 100 * x.r / x.b : NaN)} ${inWhat})`
        : `${esc(x.name)} (${x.w} wickets, econ ${f1(x.b ? 6 * x.r / x.b : NaN)} ${inWhat})`).join(' and ');
      const sample = `${scopePlayed.length} matches (this season and the last 5)`;
      const record = `they've won ${sw.w}/${sw.n} setting a total and ${cw.w}/${cw.n} chasing, ${sample}`;
      const named = who ? (chaseBetter ? `because their chasers ${who} win it for them` : `because their bowlers ${who} win it when they are setting a total`) : 'the sample is too thin to name anyone';
      const html = chaseBetter
        ? `<b>Toss plan.</b> Limited data. Win the toss: bowl first and make them bat first and set a total (${record}). Lose the toss and you bat first: be very disciplined, ${named}.`
        : `<b>Toss plan.</b> Limited data. Win the toss: bat first and make them chase (${record}). Lose the toss and you bowl first: be very disciplined, ${named}.`;
      sections.push(html);
    }
    const batterRow = x => {
      const rate = G.srX(x), bound = bPct(x), dots = dotEst(x), d = howInfo(x.how);
      return { x, rate, bound, dots, d };
    };
    const slog = sloggers.slice(0, cap);
    if (slog.length) {
      const who = joinNames(slog.map(r => batStat(r, `, ${r.x.s} six${r.x.s === 1 ? '' : 'es'}, ${Math.round(r.bound)}% boundaries`)));
      sections.push(`<b>Sloggers.</b> ${who}. Take the pace off, bowl cutters and wide yorkers, and protect the long boundaries.${dismissal(slog, true)}`);
    } else {
      const pool = (mainB.length ? mainB : G.B.filter(x => x.b > 0)).map(batterRow);
      pool.sort((p, q) => Math.max(q.rate / sloggerSr, q.bound / 50, q.x.r ? (6 * q.x.s / q.x.r) / 0.3 : 0) - Math.max(p.rate / sloggerSr, p.bound / 50, p.x.r ? (6 * p.x.s / p.x.r) / 0.3 : 0));
      const pick = pool.slice(0, 2);
      const who = pick.length ? joinNames(pick.map(r => batStat(r, `, ${r.x.s} six${r.x.s === 1 ? '' : 'es'}, ${Math.round(r.bound)}% boundaries`))) : '';
      sections.push(who
        ? `<b>Sloggers.</b> Limited data. Closest: ${who}. Take the pace off, bowl cutters and wide yorkers, and protect the long boundaries.`
        : `<b>Sloggers.</b> Limited data. No batting in this window. Still take the pace off if a hitter walks in.`);
    }
    const rots = rotators.slice(0, cap);
    if (rots.length) {
      const who = joinNames(rots.map(r => batStat(r, `, ${Math.round(r.bound)}% boundaries${r.dots != null ? `, about ${Math.round(r.dots)}% dots` : ''}`)));
      sections.push(`<b>Rotation experts.</b> ${who}. Cut off the single with a ring field, bowl for dots, and squeeze them so the pressure moves to the other end.${dismissal(rots, false)}`);
    } else {
      const used = new Set(sloggers.map(r => r.x.name));
      const pool = (mainB.length ? mainB : G.B.filter(x => x.b > 0)).map(batterRow).filter(r => !used.has(r.x.name));
      const dist = r => {
        const srDist = r.rate >= rotLo && r.rate <= rotHi ? 0 : r.rate >= rotFloor && r.rate < rotLo ? 0 : r.rate < rotFloor ? rotFloor - r.rate : r.rate - rotHi;
        const dotDist = r.dots == null ? 20 : Math.max(0, r.dots - 45);
        const boundCap = r.rate < rotLo ? 20 : 45;
        return srDist + dotDist + Math.max(0, r.bound - boundCap);
      };
      pool.sort((p, q) => dist(p) - dist(q) || q.x.r - p.x.r);
      const pick = pool.slice(0, 2);
      const who = pick.length ? joinNames(pick.map(r => batStat(r, `, ${Math.round(r.bound)}% boundaries${r.dots != null ? `, about ${Math.round(r.dots)}% dots` : ''}`))) : '';
      sections.push(who
        ? `<b>Rotation experts.</b> Limited data. Closest: ${who}. Cut off the single with a ring field and bowl for dots.`
        : `<b>Rotation experts.</b> Limited data. No batting in this window. Still cut off the single.`);
    }
    const slows = slowStarters.slice(0, cap);
    if (slows.length) {
      const who = joinNames(slows.map(r => batStat(r, r.dots != null ? `, about ${Math.round(r.dots)}% dots` : '')));
      sections.push(`<b>Slow starters.</b> ${who}. Bowl dots and field a ring. They soak up balls without releasing the pressure.${dismissal(slows, false)}`);
    } else {
      const pool = (mainB.length ? mainB : G.B.filter(x => x.b > 0)).map(batterRow).sort((p, q) => p.rate - q.rate || q.x.b - p.x.b);
      const pick = pool.slice(0, 2);
      const who = pick.length ? joinNames(pick.map(r => batStat(r, r.dots != null ? `, about ${Math.round(r.dots)}% dots` : ''))) : '';
      sections.push(who
        ? `<b>Slow starters.</b> Limited data. Closest: ${who}. Bowl dots and field a ring.`
        : `<b>Slow starters.</b> Limited data. No batting in this window. Still bowl dots early.`);
    }
    const chaseBy = {};
    for (const m of chasing) {
      const won = m.outcome === 'W';
      for (const b of m.batting || []) {
        const x = chaseBy[b.name] ??= { name: b.name, inns: 0, r: 0, b: 0, allR: 0, allB: 0, posSum: 0, posN: 0 };
        x.inns++; x.allR += b.r || 0; x.allB += b.b || 0;
        if (b.pos) { x.posSum += b.pos; x.posN++; }
        if (won) { x.r += b.r || 0; x.b += b.b || 0; }
      }
    }
    const experts = Object.values(chaseBy).filter(x => x.inns >= 2 && x.r > 0).sort((a, b) => b.r - a.r).slice(0, cap);
    if (experts.length) {
      const who = joinNames(experts.map(x => {
        const spot = x.posN ? Math.round(x.posSum / x.posN) : null;
        return `${esc(x.name)} (${x.r} off ${x.b} in winning chases${spot ? `, usually bats at ${spot}` : ''})`;
      }));
      const plan = experts.length > 1
        ? 'When defending, plan your best overs for when they come in and keep them off strike.'
        : 'When defending, plan your best overs for when he comes in and keep him off strike.';
      sections.push(`<b>${experts.length > 1 ? 'Chase experts' : 'Chase expert'}.</b> ${who}. ${plan}`);
    } else {
      let fb = Object.values(chaseBy).filter(x => x.inns > 0).sort((a, b) => b.allR - a.allR).slice(0, cap);
      let where = 'in chases, including losses';
      if (!fb.length) {
        fb = [...G.B].sort((a, b) => b.r - a.r).slice(0, cap).map(x => ({ name: x.name, allR: x.r, allB: x.b, posN: x.posN, posSum: x.posSum }));
        where = 'overall, with no chase in this window';
      }
      const who = fb.length ? joinNames(fb.map(x => {
        const spot = x.posN ? Math.round(x.posSum / x.posN) : null;
        return `${esc(x.name)} (${x.allR} off ${x.allB} ${where}${spot ? `, usually bats at ${spot}` : ''})`;
      })) : '';
      sections.push(who
        ? `<b>Chase experts.</b> Limited data. Closest: ${who}. When defending, plan your best overs for when they come in and keep them off strike.`
        : `<b>Chase experts.</b> Limited data. No batting in this window. Still save an over for the set batter.`);
    }
    const scopeBalls = G.W.reduce((s, x) => s + x.balls, 0);
    const scopeRuns = G.W.reduce((s, x) => s + x.r, 0);
    const scopeEcon = scopeBalls ? 6 * scopeRuns / scopeBalls : null;
    const attack = [];
    for (const x of G.W) {
      if (x.balls < minOvBalls) continue;
      const e = G.ecX(x);
      if (scopeEcon != null && e < scopeEcon) continue;
      if (!(e >= attackAbs || (scopeEcon != null && e >= scopeEcon * 1.15))) continue;
      const excess = scopeEcon == null ? 0 : (e - scopeEcon) * (x.balls / 6);
      attack.push({ x, e, excess });
    }
    attack.sort((a, b) => b.excess - a.excess || b.e - a.e);
    const attackPick = attack.slice(0, cap);
    const attackNames = new Set(attackPick.map(a => a.x.name));
    if (attackPick.length) {
      const opensOften = x => x.opens >= 2 && x.opens / x.spells >= 0.5;
      const who = joinNames(attackPick.map(({ x, e }) => {
        const opens = opensOften(x) ? `opens ${x.opens} of ${x.spells}, ` : '';
        const bounds = x.bounds && x.bounds === x.spells ? `, ${x.f + x.s} boundaries conceded` : '';
        return `${esc(x.name)} (${opens}econ ${f1(e)}, ${ov(x.balls)} ov, ${x.w} wicket${x.w === 1 ? '' : 's'}${extraTxt(x)}${bounds})`;
      }));
      const opened = attackPick.filter(a => opensOften(a.x)).length;
      const one = attackPick.length === 1;
      const plan = opened === attackPick.length
        ? (one ? 'Go after him in the powerplay.' : 'Go after them in the powerplay.')
        : opened ? 'Go after the openers in the powerplay and take the others on.'
        : (one ? 'Take him on.' : 'Take them on.');
      sections.push(`<b>Bowlers to attack.</b> ${who}. ${plan}`);
    } else {
      const pool = G.W.filter(x => x.balls > 0).map(x => ({ x, e: G.ecX(x), ratio: scopeEcon ? G.ecX(x) / scopeEcon : G.ecX(x) }));
      pool.sort((a, b) => (b.x.balls >= minOvBalls) - (a.x.balls >= minOvBalls) || b.ratio - a.ratio);
      const pick = pool.slice(0, 2);
      pick.forEach(a => attackNames.add(a.x.name));
      const who = pick.length ? joinNames(pick.map(({ x, e, ratio }) => `${esc(x.name)} (${f1(ratio)}x the team economy, econ ${f1(e)}, ${ov(x.balls)} ov, ${x.w} wicket${x.w === 1 ? '' : 's'}${extraTxt(x)})`)) : '';
      sections.push(who
        ? `<b>Bowlers to attack.</b> Limited data. Closest: ${who}. Take them on.`
        : `<b>Bowlers to attack.</b> Limited data. No bowling in this window. Still look for the expensive over.`);
    }
    const good = [];
    for (const x of G.W) {
      if (x.balls < minOvBalls || attackNames.has(x.name)) continue;
      const e = G.ecX(x);
      if (e <= seeAbs && (scopeEcon == null || e <= scopeEcon - seeGap)) good.push({ x, e });
    }
    good.sort((a, b) => b.x.w - a.x.w || a.e - b.e);
    const see = good.slice(0, cap);
    if (see.length) {
      const who = joinNames(see.map(({ x, e }) => `${esc(x.name)} (econ ${f1(e)}, ${x.w} wicket${x.w === 1 ? '' : 's'}, ${ov(x.balls)} ov)`));
      sections.push(`<b>Bowlers to see off.</b> ${who}. See them off and rotate the strike. Target the other bowlers.`);
    } else {
      const pool = G.W.filter(x => x.balls > 0 && !attackNames.has(x.name)).map(x => ({ x, e: G.ecX(x) }));
      pool.sort((a, b) => (b.x.balls >= minOvBalls) - (a.x.balls >= minOvBalls) || a.e - b.e || b.x.w - a.x.w);
      const pick = pool.slice(0, 2);
      const who = pick.length ? joinNames(pick.map(({ x, e }) => `${esc(x.name)} (econ ${f1(e)}, ${x.w} wicket${x.w === 1 ? '' : 's'}, ${ov(x.balls)} ov)`)) : '';
      sections.push(who
        ? `<b>Bowlers to see off.</b> Limited data. Closest: ${who}. See them off and rotate the strike.`
        : `<b>Bowlers to see off.</b> Limited data. No other bowler in this window. Still respect the tightest over.`);
    }
    let ppWkts = 0, fowInns = 0, wd = 0, nb = 0, bowlInns = 0;
    for (const m of G.played) {
      const fow = (m.fow || []).slice().sort((p, q) => p.over - q.over);
      if (fow.length) { fowInns++; ppWkts += fow.filter(f => f.over <= 6).length; }
      if (m.extrasBowled) { wd += m.extrasBowled.wd || 0; nb += m.extrasBowled.nb || 0; bowlInns++; }
      else if ((m.bowling || []).length) {
        for (const w of m.bowling) { wd += w.wd || 0; nb += w.nb || 0; }
        bowlInns++;
      }
    }
    const ppBit = fowInns >= 3 && ppWkts / fowInns >= 1.8 ? `The powerplay is when they wobble: ${ppWkts} wickets fell by over 6 across ${fowInns} innings. Attack with the new ball.` : '';
    const exBit = bowlInns >= 3 && (wd + nb) / bowlInns >= extrasFloor ? `Their bowlers give away extras: ${wd} wides and ${nb} no-balls across ${bowlInns} bowling innings (${f1((wd + nb) / bowlInns)} a match). Make them bowl it again.` : '';
    if (ppBit || exBit) sections.push(`<b>Powerplay and extras.</b> ${[ppBit, exBit].filter(Boolean).join(' ')}`);
    else {
      const bits = ['Limited data.'];
      if (fowInns) bits.push(`${ppWkts} wickets fell by over 6 across ${fowInns} innings.`);
      else bits.push('No fall of wickets on these cards.');
      if (bowlInns) bits.push(`Extras: ${wd} wides and ${nb} no-balls (${f1((wd + nb) / bowlInns)} a match). Make them bowl it again.`);
      else bits.push('No extras recorded.');
      sections.push(`<b>Powerplay and extras.</b> ${bits.join(' ')}`);
    }
    const grounds = {};
    for (const m of G.played) if (m.ground) (grounds[m.ground] ??= []).push(m);
    const grow = Object.entries(grounds).map(([name, list]) => {
      const rec = wl(list);
      const bfScores = list.filter(m => m.battedFirst === true).map(G.usInn).filter(Boolean).map(i => Number(i.runs)).filter(n => !isNaN(n));
      return { name, ...rec, bfAvg: bfScores.length ? Math.round(bfScores.reduce((s, n) => s + n, 0) / bfScores.length) : null, bfN: bfScores.length };
    });
    const jinxes = grow.filter(x => x.n >= 2 && x.l >= 2 && x.w / x.n <= 0.4).sort((p, q) => p.w / p.n - q.w / q.n || q.n - p.n).slice(0, 2);
    const jinxNames = new Set(jinxes.map(x => x.name));
    const thrives = grow.filter(x => x.n >= 2 && x.w >= 2 && x.w / x.n >= 0.65 && !jinxNames.has(x.name)).sort((p, q) => q.w / q.n - p.w / p.n || q.n - p.n).slice(0, 2);
    const groundBits = [];
    for (const j of jinxes) groundBits.push(`At ${esc(j.name)} they've lost ${j.l}/${j.n}. Expect them to struggle, and back your plan there.`);
    for (const t of thrives) {
      const avgBit = t.bfN >= 2 ? `, averaging ${t.bfAvg} batting first` : '';
      groundBits.push(`At ${esc(t.name)} they thrive (${t.w}W–${t.l}L${avgBit}). A bigger par is needed there.`);
    }
    if (groundBits.length) sections.push(`<b>Grounds.</b> ${groundBits.join(' ')}`);
    else {
      const used = new Set([...jinxes, ...thrives].map(x => x.name));
      const rest = grow.filter(x => !used.has(x.name)).sort((a, b) => b.n - a.n || b.w - a.w).slice(0, 2);
      sections.push(rest.length
        ? `<b>Grounds.</b> Limited data. ${rest.map(g => `At ${esc(g.name)} they are ${g.w}W–${g.l}L. Match the plan to that ground.`).join(' ')}`
        : `<b>Grounds.</b> Limited data. No ground is recorded. Adapt the plan to the pitch you get.`);
    }
    const S = agg(DATA.matches || []);
    const seasonB = S.B.filter(x => x.inn >= 3 && x.b >= 30).sort((p, q) => S.imp(q) - S.imp(p));
    const seasonW = S.W.filter(x => x.balls >= 36).sort((p, q) => q.w - p.w || S.ecX(p) - S.ecX(q));
    const absent = name => !R.seen.has(name);
    const picked = [];
    for (const x of seasonB) if (absent(x.name)) picked.push({ kind: 'bat', x, score: S.imp(x) });
    for (const x of seasonW) if (absent(x.name)) picked.push({ kind: 'bowl', x, score: x.w * 18 + Math.max(0, 9 - S.ecX(x)) * 6 });
    picked.sort((p, q) => q.score - p.score);
    const chosen = [];
    for (const row of picked) {
      if (chosen.length >= 4) break;
      if (chosen.some(c => c.x.name === row.x.name)) continue;
      chosen.push(row);
    }
    const cards = chosen.map(({ kind, x }) => {
      if (kind === 'bat') {
        const rate = S.srX(x), bound = bPct(x), dots = dotEst(x), pos = posOf(x), d = howInfo(x.how);
        const where = posTxt(x);
        let plan;
        if (pos != null && pos >= 6 && rate >= 125 * srK) plan = 'At the death take the pace off and bowl wide yorkers, with the long boundary protected.';
        else if (rate >= sloggerSr || bound >= 55) plan = 'Bowl tight lines, set the field, and target them early with your best bowler.';
        else if (rate < 105 * srK) plan = 'Build dot pressure and field a ring.';
        else plan = 'Cut off the single with a ring field and squeeze them so the pressure moves to the other end.';
        if (d.caughtMaj) plan += ' Often caught — keep catchers in the deep.';
        else if (d.timberMaj) plan += ' Often bowled or lbw — attack the stumps.';
        const stat = `${x.r} runs · SR ${f1(rate)} · ${where || x.inn + ' inns'} · ${Math.round(bound)}% boundaries · ${x.s} sixes${d.text ? ' · ' + d.text : ''}`;
        return `<div class="pl"><span class="av" style="background:${hue(x.name)}">${esc(ini(x.name))}</span><div class="pn"><b>${esc(x.name)}</b><div class="roles"><span class="role bat">Batter</span></div><span>${stat}</span></div></div><p class="tackle">${plan}</p>`;
      }
      const econ = S.ecX(x);
      const plan = econ <= 7 * ecK
        ? 'See them off, rotate the strike, and target the other bowlers.'
        : x.w >= 4
          ? 'See their overs off early and avoid risk against them.'
          : 'Take them on — the economy is there to be hit — and do not hand them a wicket for free.';
      const stat = `${x.w} wickets · econ ${f1(econ)} · ${ov(x.balls)} ov`;
      return `<div class="pl"><span class="av" style="background:${hue(x.name)}">${esc(ini(x.name))}</span><div class="pn"><b>${esc(x.name)}</b><div class="roles"><span class="role bowl">Bowler</span></div><span>${stat}</span></div></div><p class="tackle">${plan}</p>`;
    }).join('');
    const slowNote = srK === 1 ? 'slow starter SR 45 or under' : `slow starter SR ${f1(slowSr)} or under`;
    const list = `<ul class="notes">${sections.map(html => `<li>${html}</li>`).join('')}</ul><div class="note">Each section: this season plus the last 5 · up to 4 players · 3+ inns and 30+ balls · ${slowNote} · 2+ chase innings · 4+ overs. A section is left out when nobody qualifies.</div>`;
    let sub = cards ? `<h3>Surprise packages</h3><p class="subhead">Haven't played in the last 5 matches</p>${cards}<div class="note">Current and last season · 3+ inns & 30+ balls, 6+ overs</div>` : '';
    if (!sub) {
      const topB = [...S.B].sort((a, b) => S.imp(b) - S.imp(a))[0];
      const topW = [...S.W].sort((a, b) => b.w - a.w || S.ecX(a) - S.ecX(b))[0];
      const bits = [];
      if (topB) bits.push(`${esc(topB.name)} (${topB.r} runs, SR ${f1(S.srX(topB))})`);
      if (topW) bits.push(`${esc(topW.name)} (${topW.w} wickets, econ ${f1(S.ecX(topW))})`);
      sub = `<h3>Surprise packages</h3><p class="subhead">Limited data</p><p>${bits.length ? `Closest: ${bits.join('; ')}. They have been in the recent sample, so treat this as the nearest package.` : 'No batting or bowling in this window.'}</p>`;
    }
    return card('🎯', 'How to beat them', list + sub, 'This season and the last 5');
  }
}
$('#go').onclick = () => addLeague($('#lg').value);
$('#lg').onkeydown = e => { if (e.key === 'Enter') addLeague($('#lg').value); };
$('#leagueSel').onchange = () => { if ($('#leagueSel').value) selectCached($('#leagueSel').value); };
$('#teamSearch').oninput = () => openTeamList();
$('#teamSearch').onfocus = () => { if ($('#teamSearch').value.trim() && $('#teamSearch').value !== $('#team').value) openTeamList(); };
$('#teamSearch').onblur = () => setTimeout(() => {
  if (document.activeElement && $('#teamList') && $('#teamList').contains(document.activeElement)) return;
  closeTeamList();
  restoreTeamText();
}, 150);
$('#teamSearch').onkeydown = e => {
  const list = $('#teamList');
  const opts = list && !list.hidden ? [...list.querySelectorAll('[role="option"]')] : [];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!opts.length) { openTeamList(); return; }
    teamActive = Math.min(opts.length - 1, teamActive + 1);
    paintTeamActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!opts.length) return;
    teamActive = Math.max(0, teamActive - 1);
    paintTeamActive();
  } else if (e.key === 'Enter') {
    const name = opts[teamActive] && opts[teamActive].getAttribute('data-team');
    if (name) { e.preventDefault(); chooseTeam(name); }
  } else if (e.key === 'Escape') {
    closeTeamList();
    restoreTeamText();
  }
};
$('#teamList').onmousedown = e => { if (e.target.closest('[data-team]')) e.preventDefault(); };
$('#teamClear').onclick = () => clearTeamSearch();
$('#period').onchange = render;
document.addEventListener('error', e => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG') return;
  img.classList.add('broken');
  const badge = img.closest('.badge');
  if (badge) badge.classList.add('show-fallback');
}, true);
document.addEventListener('click', e => {
  const pageBtn = e.target.closest('[data-page-tab]');
  if (pageBtn) {
    const id = pageBtn.getAttribute('data-page-tab');
    if (!PAGE_TABS.some(t => t[0] === id) || id === pageTab) return;
    pageTab = id;
    remember('tab', pageTab);
    render();
    window.scrollTo(0, 0);
    return;
  }
  const tab = e.target.closest('[data-ps-tab]');
  if (tab) {
    const y = window.scrollY;
    psTab = tab.getAttribute('data-ps-tab');
    render();
    window.scrollTo(0, y);
    return;
  }
  const sortBtn = e.target.closest('[data-ps-sort]');
  if (sortBtn) {
    const y = window.scrollY;
    const k = sortBtn.getAttribute('data-ps-sort');
    const cur = psSort[psTab];
    if (cur.k === k) cur.d *= -1;
    else {
      const first = Number(sortBtn.getAttribute('data-ps-first'));
      psSort[psTab] = { k, d: first === 1 ? 1 : -1 };
    }
    render();
    window.scrollTo(0, y);
    return;
  }
  const b = e.target.closest('[data-lg]');
  if (b) { addLeague(b.dataset.lg); return; }
  const opt = e.target.closest('[data-team]');
  if (opt && $('#teamList') && $('#teamList').contains(opt)) {
    chooseTeam(opt.getAttribute('data-team'));
    return;
  }
  if (!e.target.closest('#teamPick')) closeTeamList();
});
window.addEventListener('hashchange', () => {
  const id = tabFromHash();
  if (!id || id === pageTab) return;
  pageTab = id;
  remember('tab', pageTab);
  if (DATA) { render(); window.scrollTo(0, 0); }
});
window.addEventListener('resize', syncStick);
async function init() {
  const fromHash = tabFromHash();
  const saved = recall('tab');
  pageTab = fromHash || (PAGE_TABS.some(t => t[0] === saved) ? saved : 'overview');
  const q = new URLSearchParams(location.search);
  if (['last5', 'current', 'last', 'all'].includes(q.get('period'))) $('#period').value = q.get('period');
  try { await loadCatalog(); }
  catch (e) { msg(e.message); hideDock(); $('#main').innerHTML = welcomeHTML(); return; }
  const code = q.get('league') || recall('lg');
  if (code) { if (!selectCached(code, q.get('team') || '')) addLeague(code); }
  else { hideDock(); $('#main').innerHTML = welcomeHTML(); }
}
init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
