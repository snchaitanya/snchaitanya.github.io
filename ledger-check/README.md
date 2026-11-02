# Ledger Check

Data-quality, reconciliation and anomaly checks for household finances — a mini
CCAR-style control report for your bank, credit-card and brokerage CSV exports.

Live: <https://snchaitanya.github.io/ledger-check/>

## Privacy & security model

Your statements never leave your browser. This is enforced by the browser, not just promised:

| Control | How |
|---|---|
| No uploads / network | CSP `connect-src 'none'`, `img-src 'self'`, `form-action 'none'` — fetch, XHR, beacons, image pixels and form posts are all blocked by the browser |
| No third-party code | CSP `script-src 'self'`, `default-src 'none'`; no CDNs, fonts, analytics |
| No persistence | No cookies, localStorage or IndexedDB. *Clear everything* (or closing the tab) discards all data |
| No HTML injection | Untrusted CSV text is only written via `textContent`; the code has no `innerHTML`/`eval` |
| Safe exports | CSV exports neutralise `= + - @` formula injection |
| Masking | Card/account numbers and emails masked on screen and in exports (on by default) |
| Resource limits | 25 MB per file, 25 files, 250k rows, 80 columns |
| Offline | Works from `file://` — download the folder and run it disconnected |

## Checks

| ID | Group | Check |
|---|---|---|
| DQ-01 | Data quality | Parse completeness — unreadable dates/amounts, truncated files |
| DQ-02 | Data quality | Duplicate records — identical rows; same account loaded twice (deduplicated) |
| DQ-03 | Data quality | Validity — future dates, zero amounts, implausible values |
| DQ-04 | Data quality | Coverage gaps — missing statement periods |
| RC-01 | Reconciliation | Running balance ties row by row |
| RC-02 | Reconciliation | Statement opening + activity = closing (enter balances per file) |
| RC-03 | Reconciliation | Transfers matched across accounts (e.g. card autopay ↔ card payment) |
| RC-04 | Reconciliation | Brokerage quantity × price ± fees = net amount |
| AN-01 | Anomalies | Duplicate charges (same merchant & amount within N days, or on two cards) |
| AN-02 | Anomalies | Duplicate subscriptions (same service on two accounts / two plans) and overlapping services |
| AN-03 | Anomalies | Subscription price changes |
| AN-04 | Anomalies | Odd charges — robust z-score (median/MAD) per merchant and category; large one-offs |
| AN-05 | Anomalies | Bank fees/interest; tiny charges from unknown merchants (card testing) |
| BG-01 | Budget | Over budget beyond tolerance, or drift above trailing 6-month median |

All money is held in integer cents, so reconciliations are exact.

## Files

- `engine.js` — pure analysis functions (no DOM, network or storage)
- `app.js` — UI
- `sample.js` — synthetic demo data with planted issues
- `test/engine.test.js` — `node --test ledger-check/test/engine.test.js`
