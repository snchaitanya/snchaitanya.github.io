// Run with: node --test ledger-check/test/engine.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const Sample = require('../sample.js');

test('parseAmount handles common bank formats in exact cents', () => {
  assert.equal(E.parseAmount('1,234.56'), 123456);
  assert.equal(E.parseAmount('-$12.00'), -1200);
  assert.equal(E.parseAmount('$-12.00'), -1200);
  assert.equal(E.parseAmount('(45.10)'), -4510);
  assert.equal(E.parseAmount('12.34 DR'), -1234);
  assert.equal(E.parseAmount('12.34 CR'), 1234);
  assert.equal(E.parseAmount('1.234,56'), 123456);
  assert.equal(E.parseAmount('0.1'), 10);
  assert.equal(E.parseAmount(''), null);
  assert.equal(E.parseAmount('abc'), null);
});

test('parseDate supports ISO, US, EU and named-month dates', () => {
  const iso = (s, o) => E.fmtDate(E.parseDate(s, o));
  assert.equal(iso('2026-10-05'), '2026-10-05');
  assert.equal(iso('10/05/2026'), '2026-10-05');
  assert.equal(iso('05/10/2026', 'DMY'), '2026-10-05');
  assert.equal(iso('10/5/26'), '2026-10-05');
  assert.equal(iso('05-Oct-2026'), '2026-10-05');
  assert.equal(iso('Oct 5, 2026'), '2026-10-05');
  assert.equal(iso('10/02/2026 as of 10/01/2026'), '2026-10-02');
  assert.equal(E.parseDate('02/30/2026'), null);
  assert.equal(E.detectDateOrder(['13/01/2026', '01/02/2026']), 'DMY');
});

test('CSV parser handles quotes, embedded newlines, BOM and delimiters', () => {
  const r = E.parseCSV('﻿a,b\n"x, ""y""","line1\nline2"\n');
  assert.deepEqual(r.rows, [['a', 'b'], ['x, "y"', 'line1\nline2']]);
  assert.equal(E.parseCSV('a;b;c\n1;2;3\n').rows[1][2], '3');
});

test('maskSensitive hides card/account numbers and emails', () => {
  assert.equal(E.maskSensitive('CARD 4111 1111 1111 1234 x'), 'CARD ••••1234 x');
  assert.equal(E.maskSensitive('ACCT 99887766'), 'ACCT ••••7766');
  assert.equal(E.maskSensitive('to me@example.com'), 'to •••@•••');
});

test('CSV export neutralises spreadsheet formulas', () => {
  assert.equal(E.csvCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(E.csvCell('+cmd'), "'+cmd");
  assert.equal(E.csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(E.csvCell('-12.50'), '-12.50');
});

test('merchant normalisation strips processor prefixes, store ids and cities', () => {
  assert.equal(E.normalizeMerchant('SQ *BLUE BOTTLE COFFEE #123 OAKLAND CA'), 'BLUE BOTTLE');
  assert.equal(E.normalizeMerchant('NETFLIX.COM'), 'NETFLIX');
  assert.equal(E.normalizeMerchant('GOOGLE *GOOGLE ONE'), 'GOOGLE ONE');
});

function runSample() {
  const files = Sample.build(new Date(Date.UTC(2026, 10, 2))).map(f => {
    const p = E.parseCSV(f.text);
    return { name: f.name, rows: p.rows, cfg: E.inspectFile(p, f.name) };
  });
  return { files, result: E.analyze(files, { Dining: 30000 }, { asOf: E.parseDate('2026-11-02') }) };
}

test('sample: column mapping and sign detection', () => {
  const { files } = runSample();
  assert.equal(files[0].cfg.mapping.description, 2, 'checking uses Description, not Details');
  assert.equal(files[0].cfg.flipSign, false, 'checking sign fixed by running balance');
  assert.equal(files[1].cfg.flipSign, true, 'card charges exported positive');
  assert.equal(files[2].cfg.kind, 'brokerage');
  assert.equal(files[2].cfg.headerRow, 1, 'skips brokerage preamble');
});

test('sample: every planted issue is detected', () => {
  const { result } = runSample();
  const has = (check, re) => result.findings.some(f => f.check === check && re.test(f.title));
  assert.ok(has('AN-02', /Duplicate subscription: NETFLIX/), 'Netflix on two accounts');
  assert.ok(has('AN-02', /Overlapping video streaming/), 'Hulu + Netflix overlap');
  assert.ok(has('AN-03', /SPOTIFY went up/), 'Spotify price rise');
  assert.ok(has('AN-01', /GOLDEN SPOON/), 'restaurant double charge');
  assert.ok(has('AN-05', /Tiny charge/), 'card-testing micro charge');
  assert.ok(has('AN-05', /fee/), 'overdraft fee');
  assert.ok(has('AN-04', /SAFEWAY/), 'grocery outlier');
  assert.ok(has('RC-01', /balance break of -\$25\.00/), 'running balance break');
  assert.ok(has('RC-03', /Unmatched transfer -\$500\.00/), 'transfer to unloaded savings');
  assert.ok(has('RC-04', /AAPL/), 'trade arithmetic');
  assert.ok(has('BG-01', /Dining over budget/), 'dining over budget');
});

test('sample: no false alarms on clean items', () => {
  const { result } = runSample();
  const titles = result.findings.map(f => f.title).join('\n');
  assert.equal(result.findings.filter(f => f.check === 'DQ-01').length, 0, 'footer/preamble rows are not rejects');
  assert.equal(result.transferStats.unmatched, 1, 'card autopays match their card-side payment');
  assert.ok(!/BLUE BOTTLE|SAFEWAY|SHELL/.test(result.subscriptions.map(s => s.merchant).join()), 'habits are not subscriptions');
  assert.ok(!/AN-04.*DEBIT/.test(titles));
});

test('loading the same account twice is caught and de-duplicated', () => {
  const text = 'Date,Description,Amount\n2026-09-01,COFFEE,-4.00\n2026-09-02,BOOKS,-20.00\n2026-09-03,LUNCH,-12.00\n';
  const p = E.parseCSV(text);
  const mk = name => ({ name, rows: p.rows, cfg: Object.assign(E.inspectFile(p, name), { account: 'Checking' }) });
  const r = E.analyze([mk('a.csv'), mk('b.csv')], {}, { asOf: E.parseDate('2026-11-01') });
  assert.equal(r.summary.excludedDuplicates, 3);
  assert.equal(r.summary.transactions, 3);
  assert.ok(r.findings.some(f => f.check === 'DQ-02' && f.severity === 'high'));
});

test('statement control totals reconcile to the cent', () => {
  const p = E.parseCSV('Date,Description,Amount\n2026-09-01,A,-10.10\n2026-09-02,B,5.05\n');
  const cfg = Object.assign(E.inspectFile(p, 'x.csv'), { opening: 10000, closing: 9495 });
  let r = E.analyze([{ name: 'x', rows: p.rows, cfg }], {}, {});
  assert.ok(!r.findings.some(f => f.check === 'RC-02'));
  cfg.closing = 9500;
  r = E.analyze([{ name: 'x', rows: p.rows, cfg }], {}, {});
  assert.ok(r.findings.some(f => f.check === 'RC-02' && /\$0\.05/.test(f.title)));
});
