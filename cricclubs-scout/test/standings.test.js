const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildStandingsDoc } = require('../lib/standings');

function sample(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', name), 'utf8'));
}

test('Fall 2026 has a table and no playoff line yet', () => {
  const raw = sample('normalized_DDCL_Fall_2026.json');
  const doc = buildStandingsDoc(raw.pointsTable, raw.playoffs);
  const row = doc.teams['Bay Area Falcons'];
  assert.equal(row.position, 5);
  assert.equal(row.of, 9);
  assert.equal(row.group, 'Group B');
  assert.equal(row.points, 10);
  assert.equal(row.playoff, null);
  assert.equal(doc.playoffs.found, false);
  assert.match(row.logo, /^https:\/\/media\.cricclubs\.com\//);
});

test('completed playoffs mark the rest as did not qualify', () => {
  const raw = sample('normalized_DDCL_Summer_26.json');
  const doc = buildStandingsDoc(raw.pointsTable, raw.playoffs);
  assert.deepEqual(doc.teams['Vodoo Rangers'].playoff, { text: 'Winner', muted: false });
  assert.equal(doc.teams['Deccan Chargers'].playoff.text, 'Runner-up');
  assert.match(doc.teams['Namma Boys'].playoff.text, /^Lost in playoffs \(Semi Final\)$/);
  assert.deepEqual(doc.teams['Bay Area Falcons'].playoff, { text: 'Did not qualify', muted: true });
});

test('Fall 2025 keeps the cup name on the playoff line', () => {
  const raw = sample('normalized_DDCL_Fall_2025.json');
  const doc = buildStandingsDoc(raw.pointsTable, raw.playoffs);
  assert.equal(doc.teams['Vodoo Rangers'].position, 1);
  assert.equal(doc.teams['Vodoo Rangers'].played, 7);
  assert.equal(doc.teams['Legion Mavericks'].playoff.text, 'Winner – Silver Cup');
  assert.equal(doc.teams['Retro Runners'].playoff.text, 'Runner-up – Silver Cup');
  assert.match(doc.teams['Loyals'].playoff.text, /^Lost in playoffs \(Semi Final\) – Silver Cup$/);
});
