const test = require('node:test');
const assert = require('node:assert');
const { parseIssueBody, sanitizeLeague, sanitizeTeam, commentFor } = require('../lib/issue');

test('parses an issue form body', () => {
  const body = '### League\n\nhttps://cricclubs.com/DublinandDanvilleCricketLeague/results\n\n### Team\n\nBay Area Falcons\n';
  const fields = parseIssueBody(body);
  assert.equal(sanitizeLeague(fields.league), 'DublinandDanvilleCricketLeague');
  assert.deepEqual(sanitizeTeam(fields.team), { ok: true, value: 'Bay Area Falcons' });
});

test('blank team is the GitHub no-response placeholder', () => {
  const fields = parseIssueBody('### League\n\nDublinandDanvilleCricketLeague\n\n### Team\n\n_No response_\n');
  assert.equal(fields.team, '');
  assert.deepEqual(sanitizeTeam(fields.team), { ok: true, value: '' });
});

test('rejects league and team injection', () => {
  assert.equal(sanitizeLeague('$(rm -rf /)'), null);
  assert.equal(sanitizeLeague('../etc/passwd'), null);
  assert.equal(sanitizeLeague(''), null);
  assert.equal(sanitizeLeague('ok;curl evil'), null);
  assert.equal(sanitizeTeam('Bay; rm -rf /').ok, false);
  assert.equal(sanitizeTeam('$(reboot)').ok, false);
  assert.equal(sanitizeTeam('a\nb').ok, false);
  assert.equal(sanitizeTeam('Foo "bar').ok, false);
});

test('failure comment does not echo shell metacharacters as a command', () => {
  const text = commentFor({ ok: false, error: 'League "nope" was not found on CricClubs.' });
  assert.match(text, /<!-- scout-handled -->/);
  assert.match(text, /Scan request failed/);
  assert.doesNotMatch(text, /node |curl |bash /);
});
