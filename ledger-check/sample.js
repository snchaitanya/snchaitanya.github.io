/*
 * Synthetic demo data. Entirely made up — no real people, accounts or merchants'
 * customer data. Generated deterministically so the demo is stable and so the
 * test suite can assert that each planted issue is detected.
 *
 * Planted issues:
 *  - Netflix billed on both the checking debit card and the credit card   (AN-02)
 *  - Video + music services overlap                                       (AN-02 info)
 *  - Spotify price rise in the latest month                               (AN-03)
 *  - Restaurant charged twice two days apart                              (AN-01)
 *  - $1.00 charge from an unknown merchant                                (AN-05)
 *  - Overdraft fee                                                        (AN-05)
 *  - $612 grocery run vs ~$140 typical                                    (AN-04)
 *  - One checking row whose running balance doesn't tie                   (RC-01)
 *  - A transfer to a savings account that isn't loaded                    (RC-03)
 *  - A brokerage trade whose qty × price ≠ amount                         (RC-04)
 *  - Dining well above budget in the last full month                      (BG-01)
 *  - Credit card exported with charges as positive numbers (sign flip)
 */
(function (root) {
  'use strict';

  function rng(seed) { return function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; }

  function build(today) {
    var DAY = 86400000;
    var end = today || new Date();
    var endUTC = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    var start = Date.UTC(end.getFullYear(), end.getMonth() - 5, 1);
    var r = rng(42);
    function d(t) { var x = new Date(t); return (x.getUTCMonth() + 1) + '/' + x.getUTCDate() + '/' + x.getUTCFullYear(); }
    function iso(t) { return new Date(t).toISOString().slice(0, 10); }
    function money(c) { return (c / 100).toFixed(2); }

    var chk = [], card = [], brk = [];
    function monthDay(y, m, dd) { return Date.UTC(y, m, dd); }
    var months = [];
    for (var t = start; t <= endUTC; t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) months.push(new Date(t));
    var lastMonthIdx = months.length - 2; // last full month

    months.forEach(function (m, mi) {
      var y = m.getUTCFullYear(), mo = m.getUTCMonth();
      function on(dd) { var x = monthDay(y, mo, dd); return x <= endUTC ? x : null; }
      var x;
      if ((x = on(1))) chk.push([x, 'ACME CORP PAYROLL DIR DEP', 512000]);
      if ((x = on(15))) chk.push([x, 'ACME CORP PAYROLL DIR DEP', 512000]);
      if ((x = on(2))) chk.push([x, 'OAK STREET PROPERTY MGMT RENT', -265000]);
      if ((x = on(9))) chk.push([x, 'PG&E WEB ONLINE', -(11000 + Math.round(r() * 6000))]);
      if ((x = on(12))) chk.push([x, 'COMCAST XFINITY 800-266-2278', -8999]);
      if ((x = on(6))) chk.push([x, 'NETFLIX.COM LOS GATOS CA', -1549]);         // debit-card Netflix
      if ((x = on(20))) chk.push([x, 'GEICO AUTO INSURANCE', -14200]);
      if ((x = on(25))) chk.push([x, 'CHASE CREDIT CRD AUTOPAY', -(140000 + mi * 3100)]);
      if ((x = on(25))) card.push([x, 'AUTOMATIC PAYMENT - THANK YOU', -(140000 + mi * 3100)]); // card shows payment negative

      // card spending (positive = charge in this export)
      if ((x = on(6))) card.push([x, 'NETFLIX.COM', 1549]);                       // duplicate Netflix
      if ((x = on(3))) card.push([x, 'SPOTIFY USA', mi >= lastMonthIdx ? 1299 : 1199]);
      if ((x = on(14))) card.push([x, 'HULU 877-8244858 CA', 1899]);
      if ((x = on(18))) card.push([x, 'GOOGLE *GOOGLE ONE', 299]);
      for (var w = 0; w < 4; w++) {
        if ((x = on(4 + w * 7))) card.push([x, 'SAFEWAY #1' + (200 + w), 11000 + Math.round(r() * 6000)]);
        if ((x = on(5 + w * 7))) card.push([x, 'TRADER JOE S #55' + w, 4000 + Math.round(r() * 3000)]);
        if ((x = on(2 + w * 7))) card.push([x, 'SQ *BLUE BOTTLE COFFEE', 600 + Math.round(r() * 300)]);
        if ((x = on(6 + w * 7))) card.push([x, 'SHELL OIL 5744' + w, 4500 + Math.round(r() * 2000)]);
      }
      var dine = mi === lastMonthIdx ? 9 : 4;                                     // dining spike
      for (var k = 0; k < dine; k++) if ((x = on(3 + k * 3))) card.push([x, ['CHIPOTLE 2231', 'DOORDASH*THAI BASIL', 'TST* SUSHI ZONE', 'PIZZA MY HEART'][k % 4], 2500 + Math.round(r() * 3500)]);
      if ((x = on(11))) card.push([x, 'AMAZON MKTPL*' + (100 + mi) + 'AB', 2000 + Math.round(r() * 8000)]);
      if ((x = on(22))) card.push([x, 'TARGET 00012345', 3000 + Math.round(r() * 7000)]);
    });

    var L = months[lastMonthIdx], ly = L.getUTCFullYear(), lm = L.getUTCMonth();
    card.push([Date.UTC(ly, lm, 16), 'THE GOLDEN SPOON RESTAURANT', 8640]);
    card.push([Date.UTC(ly, lm, 18), 'THE GOLDEN SPOON RESTAURANT', 8640]);       // double charge
    card.push([Date.UTC(ly, lm, 19), 'SAFEWAY #1209', 61237]);                    // outlier
    card.push([Date.UTC(ly, lm, 21), 'PAYMNT*VXQ DIGITAL SVCS', 100]);            // card-testing signal
    chk.push([Date.UTC(ly, lm, 23), 'OVERDRAFT FEE', -3500]);
    chk.push([Date.UTC(ly, lm, 10), 'ONLINE TRANSFER TO SAVINGS XXXX9921', -50000]); // other side not loaded
    chk.push([Date.UTC(ly, lm, 17), 'CHECK DEPOSIT MOBILE', 21500]);

    // Checking: newest-first with a running balance, one break planted.
    chk.sort(function (a, b) { return a[0] - b[0] || b[2] - a[2]; });
    var bal = 840000, chkRows = [];
    chk.forEach(function (c, i) {
      bal += c[2];
      var shown = bal;
      if (c[1] === 'GEICO AUTO INSURANCE' && i > chk.length / 2 && !chk.brokeOnce) { chk.brokeOnce = true; bal -= 2500; shown = bal; } // unexplained $25 drop
      chkRows.push([d(c[0]), c[1], money(c[2]), money(shown)]);
    });
    chkRows.reverse();
    var checking = 'Details,Posting Date,Description,Amount,Balance\n' + chkRows.map(function (rw) {
      return [rw[2][0] === '-' ? 'DEBIT' : 'CREDIT', rw[0], '"' + rw[1] + '"', rw[2], rw[3]].join(',');
    }).join('\n') + '\n';

    card.sort(function (a, b) { return a[0] - b[0]; });
    var credit = 'Transaction Date,Post Date,Description,Category,Amount\n' + card.map(function (c) {
      var cat = /PAYMENT/.test(c[1]) ? '' : /SAFEWAY|TRADER/.test(c[1]) ? 'Groceries' : /SHELL/.test(c[1]) ? 'Gas' : /CHIPOTLE|DOORDASH|SUSHI|PIZZA|GOLDEN|COFFEE/.test(c[1]) ? 'Dining' : /NETFLIX|SPOTIFY|HULU|GOOGLE/.test(c[1]) ? 'Subscriptions' : 'Shopping';
      return [iso(c[0]), iso(c[0] + DAY), '"' + c[1] + '"', cat, money(c[2])].join(',');
    }).join('\n') + '\n';

    // Brokerage export with a preamble line, like many brokers produce.
    var b0 = Date.UTC(ly, lm, 5);
    brk.push([d(b0), 'Buy', 'VTI', 'VANGUARD TOTAL STOCK MKT ETF', '10', '$262.15', '', '-$2,621.50']);
    brk.push([d(b0 + 7 * DAY), 'Buy', 'VXUS', 'VANGUARD TOTAL INTL STOCK ETF', '25', '$63.40', '', '-$1,585.00']);
    brk.push([d(b0 + 14 * DAY), 'Sell', 'AAPL', 'APPLE INC', '5', '$228.30', '$0.03', '$1,114.47']); // should be 1141.47
    brk.push([d(b0 + 20 * DAY), 'Qualified Dividend', 'VTI', 'VANGUARD TOTAL STOCK MKT ETF', '', '', '', '$31.22']);
    var brokerage = '"Transactions for account Brokerage ...4417 as of ' + d(endUTC) + '"\n' +
      '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"\n' +
      brk.map(function (rw) { return rw.map(function (v) { return '"' + v + '"'; }).join(','); }).join('\n') + '\n' +
      '"Transactions Total","","","","","","","-$3,060.81"\n';

    return [
      { name: 'Everyday Checking.csv', text: checking },
      { name: 'Rewards Credit Card.csv', text: credit },
      { name: 'Brokerage.csv', text: brokerage }
    ];
  }

  var api = { build: build };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LedgerSample = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
