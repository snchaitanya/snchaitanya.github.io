// Parse and sanitize scan-request issue bodies. The workflow only passes these checked values through.
const { parseLeagueInput } = require('./league-input');

const NO_RESPONSE = /^(_No response_|N\/A|none|n\/a)$/i;
const TEAM_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .&'()\-+/]{0,79}$/u;

function field(body, label) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const re = new RegExp(`(?:^|\\n)###\\s+${label}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s+|$)`, 'i');
  const m = text.match(re);
  if (!m) return '';
  const v = m[1].trim();
  if (!v || NO_RESPONSE.test(v)) return '';
  return v;
}

function parseIssueBody(body) {
  return { league: field(body, 'League'), team: field(body, 'Team') };
}

function sanitizeLeague(input) {
  const code = parseLeagueInput(input);
  return code;
}

function sanitizeTeam(input) {
  const raw = String(input ?? '');
  if (/[\r\n\0]/.test(raw)) {
    return { ok: false, error: 'Invalid team name. Use the team name from CricClubs (letters, numbers, spaces, and . & \' -).' };
  }
  const value = raw.replace(/[ \t]+/g, ' ').trim();
  if (!value) return { ok: true, value: '' };
  if (value.length > 80 || !TEAM_RE.test(value)) {
    return { ok: false, error: 'Invalid team name. Use the team name from CricClubs (letters, numbers, spaces, and . & \' -).' };
  }
  return { ok: true, value };
}

function siteBase() {
  return (process.env.SITE_URL || 'https://kunal1985.github.io/cricclubs-scout/').replace(/\/?$/, '/');
}

function siteUrl(code, team) {
  const u = new URL(siteBase());
  if (code) u.searchParams.set('league', code);
  if (team) u.searchParams.set('team', team);
  return u.toString();
}

function commentFor(r) {
  const marker = '<!-- scout-handled -->';
  if (!r.ok) {
    return `${marker}\n**Scan request failed.**\n\n${r.error}\n\nUse the league code from the cricclubs.com URL (for example \`DublinandDanvilleCricketLeague\`) and the team name shown on the site.\n`;
  }
  if (r.kind === 'weekly') {
    const lines = (r.summary || []).map(s => `- \`${s.league}\` / ${s.team}: ${s.error || (s.newMatches + ' new')}`);
    return `${marker}\nWeekly current-season rescan finished (${r.teamCount} teams).\n\n${lines.join('\n')}\n\n${r.url}\n`;
  }
  if (r.kind === 'league') {
    return `${marker}\n**${r.name}** (\`${r.code}\`) is cached.\n\n- Teams: ${r.teamCount}\n- Current season: ${r.current || 'none'}\n- Last season: ${r.last || 'none'}\n\nOpen the site and request a team scan: ${r.url}\n`;
  }
  return `${marker}\n**${r.team}** in **${r.name}** (\`${r.code}\`) is scanned.\n\n- New matches: ${r.newMatches}\n- Current season: ${r.current || 'none'}\n- Last season: ${r.last || 'none'}\n\n${r.url}\n\n${r.asOf || ''}\n`;
}

module.exports = { parseIssueBody, sanitizeLeague, sanitizeTeam, siteUrl, commentFor, siteBase };
