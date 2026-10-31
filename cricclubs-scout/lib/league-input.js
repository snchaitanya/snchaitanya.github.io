// League code parsing with no npm dependencies, so the scan prepare job can load it before npm ci.
function parseLeagueInput(s) {
  s = String(s || '').trim();
  const m = s.match(/cricclubs\.com\/([A-Za-z0-9_-]+)/i);
  const code = m ? m[1] : s.replace(/^\/+|\/.*$/g, '');
  return /^[A-Za-z0-9_-]{2,80}$/.test(code) ? code : null;
}

module.exports = { parseLeagueInput };
