const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');

test('cached Bay Area Falcons report keeps match facts and drops raw dismissals', () => {
  const league = store.readLeague('DublinandDanvilleCricketLeague');
  assert.ok(league);
  assert.ok(league.teams.includes('Bay Area Falcons'));
  assert.ok(league.seasons.current && league.seasons.last);
  const report = store.teamReport(league, 'Bay Area Falcons');
  assert.equal(report.team, 'Bay Area Falcons');
  assert.ok(report.matches.length >= 10);
  assert.ok(report.matches.every(m => !Object.prototype.hasOwnProperty.call(m, 'dismissals')));
  assert.ok(report.matches.every(m => Array.isArray(m.fielding)));
  assert.ok(report.seasons.current.scrapedAt);
  const file = path.join(store.STORE, 'leagues', 'dublinanddanvillecricketleague', 'teams', 'bay-area-falcons.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sample = raw.matches[Object.keys(raw.matches)[0]];
  assert.ok(sample.dismissals, 'store copy still has dismissals for the next scan');
});

test('publish writes relative site JSON', () => {
  const index = store.publish();
  assert.equal(index.leagues.length, 1);
  assert.equal(index.leagues[0].code, 'DublinandDanvilleCricketLeague');
  const team = path.join(store.SITE, 'leagues', 'dublinanddanvillecricketleague', 'teams', 'bay-area-falcons.json');
  const tipsy = path.join(store.SITE, 'leagues', 'dublinanddanvillecricketleague', 'teams', 'tipsy-bulls.json');
  assert.ok(fs.existsSync(team));
  assert.ok(fs.existsSync(tipsy));
  const report = JSON.parse(fs.readFileSync(team, 'utf8'));
  assert.equal(report.league.name, 'DDCL');
  assert.ok(report.matches.length >= 10);
  assert.match(report.logo, /^https:\/\/media\.cricclubs\.com\//);
  const stand = path.join(store.SITE, 'leagues', 'dublinanddanvillecricketleague', 'standings', 'ddcl-fall-2026.json');
  assert.ok(fs.existsSync(stand));
  assert.equal(JSON.parse(fs.readFileSync(stand, 'utf8')).teams['Bay Area Falcons'].position, 5);
});
