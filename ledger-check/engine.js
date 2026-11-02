/*
 * Ledger Check — analysis engine.
 *
 * Pure functions only: no DOM, no network, no storage. Every function takes
 * plain data in and returns plain data out, so the engine can be unit-tested
 * in Node and audited in isolation. Money is held as integer cents to keep
 * reconciliation arithmetic exact.
 *
 * Sign convention after normalisation: negative = money out, positive = money in.
 */
(function (root) {
  'use strict';

  var DAY = 86400000;
  var LIMITS = { maxRows: 250000, maxCols: 80, maxCell: 2000 };

  // ---------------------------------------------------------------- CSV ----

  function detectDelimiter(text) {
    var line = text.slice(0, 20000).split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 15);
    var best = ',', bestScore = -1;
    [',', ';', '\t', '|'].forEach(function (d) {
      var counts = line.map(function (l) { return countOutsideQuotes(l, d); });
      var max = Math.max.apply(null, counts.concat([0]));
      var consistent = counts.filter(function (c) { return c === max; }).length;
      var score = max > 0 ? consistent * 1000 + max : 0;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function countOutsideQuotes(line, d) {
    var n = 0, q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') q = !q; else if (c === d && !q) n++;
    }
    return n;
  }

  /** RFC 4180 parser with hard size limits. Returns {rows, truncated}. */
  function parseCSV(text, delimiter) {
    text = String(text || '');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var d = delimiter || detectDelimiter(text);
    var rows = [], row = [], field = '', q = false, truncated = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
        continue;
      }
      if (c === '"' && field === '') { q = true; continue; }
      if (c === d) { pushField(); continue; }
      if (c === '\r') continue;
      if (c === '\n') {
        pushField(); pushRow();
        if (rows.length >= LIMITS.maxRows) { truncated = i < text.length - 1; break; }
        continue;
      }
      field += c;
    }
    if (!truncated && (field !== '' || row.length)) { pushField(); pushRow(); }
    return { rows: rows, truncated: truncated, delimiter: d };

    function pushField() {
      if (row.length < LIMITS.maxCols) row.push(field.length > LIMITS.maxCell ? field.slice(0, LIMITS.maxCell) : field);
      field = '';
    }
    function pushRow() {
      if (row.some(function (f) { return f.trim() !== ''; })) rows.push(row);
      row = [];
    }
  }

  // ------------------------------------------------------ column mapping ----

  var FIELD_PATTERNS = {
    date: [/^(transaction|trans\.?|txn|trade|activity|run) ?date$/i, /^date$/i, /^(posted|posting|post|value|settlement|settle) ?date$/i, /date/i],
    description: [/^(description|transaction description|security description)$/i, /^(payee|merchant|merchant name|name|original description)$/i, /^(narrative|details|memo)$/i, /desc|payee|merchant|narrat/i],
    amount: [/^(amount|transaction amount|net amount|amount \(.*\)|amount \$|value)$/i, /amount/i],
    debit: [/^(debit|debits|withdrawal|withdrawals|money out|paid out|charge|charges|debit amount|outflow)$/i, /debit|withdraw/i],
    credit: [/^(credit|credits|deposit|deposits|money in|paid in|credit amount|inflow)$/i, /credit|deposit/i],
    balance: [/^(running balance|balance|ledger balance|running bal\.?)$/i, /balance/i],
    category: [/^(category|type of spend|spend category|budget category)$/i, /categor/i],
    account: [/^(account|account name|account number|card|card no\.?|card number|card member|account #)$/i, /^account/i],
    symbol: [/^(symbol|ticker|security id|cusip)$/i],
    quantity: [/^(quantity|qty|shares|units)$/i],
    price: [/^(price|share price|price \(\$\)|unit price)$/i],
    fees: [/^(fees|fee|commission|fees & comm|fees and commissions|commissions)$/i, /fee|commission/i],
    action: [/^(action|activity|transaction type|type|activity type)$/i]
  };
  var FIELDS = Object.keys(FIELD_PATTERNS);

  function looksLikeHeader(row) {
    var hits = 0;
    row.forEach(function (cell) {
      var c = cell.trim();
      if (/^(date|amount|description|payee|debit|credit|balance|symbol|quantity|transaction date|posted date|post date|trade date|merchant|category)$/i.test(c)) hits++;
    });
    return hits >= 2;
  }

  /** Banks often put a preamble above the header. Find the real header row. */
  function findHeaderRow(rows) {
    for (var i = 0; i < Math.min(rows.length, 25); i++) if (looksLikeHeader(rows[i])) return i;
    return 0;
  }

  function guessMapping(header) {
    var map = {}, used = {};
    FIELDS.forEach(function (f) {
      var pats = FIELD_PATTERNS[f];
      for (var p = 0; p < pats.length && map[f] == null; p++) {
        for (var i = 0; i < header.length; i++) {
          if (!used[i] && pats[p].test(header[i].trim())) { map[f] = i; used[i] = true; break; }
        }
      }
    });
    // A dedicated amount column beats debit/credit pairs when both exist, unless amount is blank.
    return map;
  }

  // -------------------------------------------------------------- values ----

  /** Parse a money string into integer cents, or null. */
  function parseAmount(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s || s === '-' || /^n\/?a$/i.test(s)) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
    if (/\s*CR$/i.test(s)) s = s.replace(/\s*CR$/i, '');
    else if (/\s*DR$/i.test(s)) { neg = !neg; s = s.replace(/\s*DR$/i, ''); }
    s = s.replace(/\b(USD|EUR|GBP|INR|CAD|AUD)\b/gi, '').replace(/[$€£₹¥\s\u00a0]/g, '');
    if (s[0] === '-' || s[0] === '\u2212') { neg = !neg; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    if (s[0] === '$') s = s.slice(1);
    if (s[s.length - 1] === '-') { neg = !neg; s = s.slice(0, -1); }
    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    var v = Math.round(parseFloat(s) * 100);
    if (!isFinite(v) || Math.abs(v) > 1e13) return null;
    return neg ? -v : v;
  }

  function parseNumber(s) {
    if (s == null) return null;
    s = String(s).trim().replace(/[$,\s]/g, '');
    if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    return parseFloat(s);
  }

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  function dayNum(y, m, d) {
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
    var t = Date.UTC(y, m - 1, d), dt = new Date(t);
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return Math.round(t / DAY);
  }

  /** Parse a date string to a UTC day number. order: 'MDY' | 'DMY' (numeric dates only). */
  function parseDate(s, order) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    s = s.split(/\s+as of\s+/i)[0].trim(); // brokerage "10/02/2026 as of 10/01/2026"
    var m;
    if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/.exec(s))) return dayNum(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return dayNum(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})(?:\s.*)?$/.exec(s))) {
      return order === 'DMY' ? dayNum(+m[3], +m[2], +m[1]) : dayNum(+m[3], +m[1], +m[2]);
    }
    if ((m = /^(\d{1,2})[-\s\/]([A-Za-z]{3,9})\.?[-\s\/,]+(\d{2}|\d{4})$/.exec(s)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
      return dayNum(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
    }
    if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
      return dayNum(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    }
    return null;
  }

  /** Decide MDY vs DMY from the values in a column. */
  function detectDateOrder(values) {
    var mdy = 0, dmy = 0;
    values.forEach(function (v) {
      var m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.]/.exec(String(v).trim());
      if (!m) return;
      if (+m[1] > 12) dmy++;
      if (+m[2] > 12) mdy++;
    });
    return dmy > mdy ? 'DMY' : 'MDY';
  }

  function fmtDate(n) {
    if (n == null) return '';
    return new Date(n * DAY).toISOString().slice(0, 10);
  }
  function monthKey(n) { return fmtDate(n).slice(0, 7); }

  function fmtMoney(c) {
    if (c == null || !isFinite(c)) return '';
    var neg = c < 0, a = Math.abs(c);
    var s = (a / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + s;
  }

  // ----------------------------------------------------- privacy helpers ----

  /** Mask card / account numbers and similar long digit runs, keep last 4. */
  function maskSensitive(s) {
    return String(s == null ? '' : s)
      .replace(/\b\d(?:[ -]?\d){11,18}\b/g, function (m) { var d = m.replace(/\D/g, ''); return '••••' + d.slice(-4); })
      .replace(/\b\d{6,}\b/g, function (m) { return '••••' + m.slice(-4); })
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '•••@•••');
  }

  /** Neutralise spreadsheet formula injection when exporting CSV. */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\$?\d[\d,]*(\.\d+)?$/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

  // ----------------------------------------------------------- merchants ----

  var STOP = { USA: 1, US: 1, INC: 1, LLC: 1, CO: 1, CORP: 1, THE: 1, COM: 1, LTD: 1, HTTPS: 1, WWW: 1, NA: 1, BILL: 1, HELP: 1, ONLINE: 1 };
  var STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');

  function normalizeMerchant(desc) {
    var s = String(desc || '').toUpperCase();
    for (var k = 0; k < 3; k++) {
      s = s.replace(/^\s*(POS|DEBIT|CREDIT|CHECKCARD|CHECK CARD|DEBIT CARD|PURCHASE|PURCHASE AUTHORIZED ON|RECURRING|RECURRING PAYMENT|PREAUTHORIZED|PREAUTH|ACH|WEB|CARD|VISA|MC|DBT|CRD)\b[\s:\-#]*/, '');
      s = s.replace(/^\s*(SQ|TST|SP|PY|PP|PAYPAL|DD|BT|IC|FS|CKO|EB)\s*\*\s*/, '');
    }
    s = s.replace(/\.(COM|NET|ORG|IO|TV|CO)\b/g, ' ')
      .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
      .replace(/\b[A-Z]*\d[A-Z0-9]*\b/g, ' ')
      .replace(/[^A-Z&+ ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    var words = s.split(' ').filter(function (w) { return w && !STOP[w] && w.length > 1; });
    if (words.length > 1 && STATES.indexOf(words[words.length - 1]) >= 0) words.pop();
    words = words.filter(function (w, i) { return words.indexOf(w) === i; });
    var out = words.slice(0, 2).join(' ');
    return out || String(desc || '').toUpperCase().trim().slice(0, 30) || '(blank)';
  }

  var TRANSFER_RE = /\b(TRANSFER|XFER|TFR|PAYMENT\s*-?\s*THANK YOU|THANK YOU FOR YOUR PAYMENT|AUTOPAY|AUTO PAY|AUTOMATIC PAYMENT|CARD PAYMENT|CREDIT CARD PAYMENT|CRCARDPMT|ONLINE PAYMENT|EPAYMENT|E-PAYMENT|DIRECTPAY|MOBILE PAYMENT|PAYMENT RECEIVED|INTERNAL TRANSFER)\b/i;
  var INCOME_RE = /\b(PAYROLL|SALARY|DIR DEP|DIRECT DEP|DIRECT DEPOSIT|DIRECTDEP)\b/i;
  var FEE_RE = /\b(OVERDRAFT|NSF|INSUFFICIENT FUNDS|LATE FEE|LATE PAYMENT FEE|ANNUAL FEE|MONTHLY SERVICE FEE|MAINTENANCE FEE|SERVICE CHARGE|INTEREST CHARGE|FINANCE CHARGE|FOREIGN TRANSACTION FEE|FOREIGN TRANS FEE|ATM FEE|RETURNED ITEM|WIRE FEE|CASH ADVANCE FEE)\b/i;

  var CATEGORY_RULES = [
    ['Transfer', TRANSFER_RE],
    ['Income', INCOME_RE],
    ['Fees & Interest', FEE_RE],
    ['Subscriptions', /NETFLIX|HULU|DISNEY|SPOTIFY|APPLE\.COM|ITUNES|YOUTUBE|PARAMOUNT|PEACOCK|\bHBO\b|\bMAX\b|AUDIBLE|PRIME VIDEO|AMAZON PRIME|ICLOUD|GOOGLE ONE|GOOGLE STORAGE|DROPBOX|MICROSOFT|ADOBE|NYTIMES|NEW YORK TIMES|PATREON|SIRIUS|PELOTON|CHATGPT|OPENAI|ANTHROPIC|CLAUDE\.AI|GYM|FITNESS|PLANET FITNESS/i],
    ['Groceries', /GROCER|SAFEWAY|KROGER|WHOLE FOODS|TRADER JOE|COSTCO|ALDI|PUBLIX|WEGMANS|SPROUTS|H-E-B|HEB\b|FOOD LION|INDIA BAZAAR|PATEL BROS|99 RANCH|SAFEWAY|LUCKY/i],
    ['Dining', /RESTAURANT|CAFE|COFFEE|STARBUCKS|DOORDASH|UBER EATS|UBEREATS|GRUBHUB|MCDONALD|CHIPOTLE|PIZZA|DINER|GRILL|BAR &|TAQUERIA|BURGER|SUBWAY|DUNKIN|PANERA|KITCHEN/i],
    ['Transport', /\bUBER\b|LYFT|SHELL|CHEVRON|EXXON|\bBP\b|ARCO|76 |VALERO|GAS STATION|FUEL|PARKING|TOLL|FASTRAK|TRANSIT|CLIPPER|BART|CALTRAIN|AIRLINE|DELTA|UNITED AIR|SOUTHWEST|AMERICAN AIR/i],
    ['Utilities', /ELECTRIC|PG&E|PGE|EDISON|WATER|SEWER|GAS CO|COMCAST|XFINITY|AT&T|VERIZON|T-MOBILE|TMOBILE|SPECTRUM|INTERNET|WASTE|UTILITY/i],
    ['Housing', /RENT\b|MORTGAGE|HOA|PROPERTY MGMT|LANDLORD/i],
    ['Insurance', /INSURANCE|GEICO|STATE FARM|ALLSTATE|PROGRESSIVE|LIBERTY MUTUAL/i],
    ['Health', /PHARMACY|CVS|WALGREENS|RITE AID|DENTAL|MEDICAL|CLINIC|HOSPITAL|KAISER|DOCTOR|OPTOMETR/i],
    ['Shopping', /AMAZON|AMZN|TARGET|WALMART|BEST BUY|EBAY|ETSY|IKEA|HOME DEPOT|LOWE'?S|MACY|NORDSTROM|TJ ?MAXX|MARSHALLS|ROSS/i]
  ];

  function categorize(desc, amount) {
    for (var i = 0; i < CATEGORY_RULES.length; i++) if (CATEGORY_RULES[i][1].test(desc)) return CATEGORY_RULES[i][0];
    return amount > 0 ? 'Other Income' : 'Uncategorized';
  }

  // Services that overlap functionally — paying for several is a common leak.
  var OVERLAP_GROUPS = [
    ['Video streaming', /NETFLIX|HULU|DISNEY|PARAMOUNT|PEACOCK|\bHBO\b|\bMAX\b|PRIME VIDEO|APPLE TV|YOUTUBE ?TV|SLING|FUBO|STARZ|SHOWTIME/i],
    ['Music streaming', /SPOTIFY|APPLE MUSIC|YOUTUBE ?MUSIC|YOUTUBE PREMIUM|PANDORA|TIDAL|AMAZON MUSIC|SIRIUS/i],
    ['Cloud storage', /ICLOUD|GOOGLE ONE|GOOGLE STORAGE|DROPBOX|ONEDRIVE|MICROSOFT 365|BOX\.COM/i],
    ['AI assistants', /CHATGPT|OPENAI|CLAUDE|ANTHROPIC|GEMINI|PERPLEXITY|COPILOT/i],
    ['Fitness', /PELOTON|PLANET FITNESS|EQUINOX|\bGYM\b|FITNESS|CLASSPASS|STRAVA/i]
  ];

  // ------------------------------------------------------- normalisation ----

  /**
   * Turn one parsed file into normalised transactions.
   * cfg: {mapping, headerRow, dateOrder, flipSign, account, kind}
   * Returns {txns, rejects}.
   */
  function normalizeFile(file, cfg) {
    var rows = file.rows, map = cfg.mapping, txns = [], rejects = [];
    var start = (cfg.headerRow == null ? 0 : cfg.headerRow + 1);
    function cell(r, f) { return map[f] == null ? '' : (r[map[f]] == null ? '' : r[map[f]]); }
    for (var i = start; i < rows.length; i++) {
      var r = rows[i], line = i + 1;
      var rawDate = cell(r, 'date'), date = parseDate(rawDate, cfg.dateOrder);
      var desc = String(cell(r, 'description') || '').trim();
      if (map.symbol != null && cell(r, 'symbol')) desc = (cell(r, 'action') ? cell(r, 'action') + ' ' : '') + cell(r, 'symbol') + (desc ? ' — ' + desc : '');
      var amt = null;
      if (map.amount != null) amt = parseAmount(cell(r, 'amount'));
      if (amt == null && (map.debit != null || map.credit != null)) {
        var dr = parseAmount(cell(r, 'debit')), cr = parseAmount(cell(r, 'credit'));
        if (dr != null || cr != null) amt = (cr || 0) - Math.abs(dr || 0);
      }
      var nonEmpty = r.filter(function (c) { return String(c).trim(); }).length;
      if (date == null && (/^(transactions? )?(total|ending|beginning|opening|closing|summary)/i.test(String(r[0] || '').trim()) || (amt == null && nonEmpty <= 2))) continue; // footer / summary line
      if (date == null || amt == null) {
        rejects.push({ line: line, reason: date == null ? (rawDate ? 'Unreadable date "' + maskSensitive(rawDate).slice(0, 30) + '"' : 'Missing date') : 'Missing or unreadable amount', raw: maskSensitive(r.join(' | ')).slice(0, 160) });
        continue;
      }
      if (cfg.flipSign) amt = -amt;
      var t = {
        id: cfg.fileIndex + ':' + line,
        file: cfg.fileIndex,
        line: line,
        account: cfg.account,
        kind: cfg.kind,
        date: date,
        description: desc,
        merchant: normalizeMerchant(desc),
        amount: amt,
        balance: map.balance != null ? parseAmount(cell(r, 'balance')) : null,
        category: (map.category != null && String(cell(r, 'category')).trim()) || categorize(desc, amt),
        quantity: map.quantity != null ? parseNumber(cell(r, 'quantity')) : null,
        price: map.price != null ? parseNumber(cell(r, 'price')) : null,
        fees: map.fees != null ? parseAmount(cell(r, 'fees')) : null,
        action: map.action != null ? String(cell(r, 'action')).trim() : '',
        raw: r.join('\u0001')
      };
      t.isTransfer = t.category === 'Transfer' || TRANSFER_RE.test(desc) || /^transfer/i.test(t.category);
      if (t.isTransfer) t.category = 'Transfer';
      txns.push(t);
    }
    return { txns: txns, rejects: rejects };
  }

  /**
   * Guess whether money-out is exported as positive numbers (common on credit cards).
   * Strongest evidence: a running balance column — pick the sign that makes it tie.
   * Otherwise use card-side payment wording and payroll deposits as anchors.
   */
  function guessFlip(file, mapping, headerRow) {
    if (mapping.amount == null) return false;
    var seq = [], pos = 0, neg = 0, votesFlip = 0, votesKeep = 0;
    for (var i = (headerRow || 0) + 1; i < file.rows.length; i++) {
      var r = file.rows[i], a = parseAmount(r[mapping.amount]);
      if (a == null) continue;
      if (a > 0) pos++; else if (a < 0) neg++;
      if (mapping.balance != null) { var b = parseAmount(r[mapping.balance]); if (b != null) seq.push([a, b]); }
      var d = mapping.description != null ? String(r[mapping.description] || '') : '';
      var inflowWords = /PAYMENT\s*-?\s*THANK YOU|THANK YOU FOR YOUR PAYMENT|PAYMENT RECEIVED|AUTOMATIC PAYMENT - THANK|\bREFUND\b|PAYROLL|DIR DEP|DIRECT DEP/i;
      if (inflowWords.test(d)) { if (a < 0) votesFlip++; else if (a > 0) votesKeep++; }
    }
    if (seq.length >= 3) {
      var ties = function (sign) {
        var ok = 0;
        for (var k = 1; k < seq.length; k++) {
          if (seq[k - 1][1] + sign * seq[k][0] === seq[k][1]) ok++;           // oldest-first
          if (seq[k][1] + sign * seq[k - 1][0] === seq[k - 1][1]) ok++;       // newest-first
        }
        return ok;
      };
      var keep = ties(1), flip = ties(-1);
      if (keep !== flip) return flip > keep;
    }
    if (votesFlip !== votesKeep) return votesFlip > votesKeep;
    return pos > neg * 3 && pos > 5;
  }

  /** Inspect a freshly parsed file and propose a configuration the user can override. */
  function inspectFile(parsed, name) {
    var headerRow = findHeaderRow(parsed.rows);
    var header = parsed.rows[headerRow] || [];
    var mapping = guessMapping(header);
    var dateVals = [];
    if (mapping.date != null) for (var i = headerRow + 1; i < Math.min(parsed.rows.length, headerRow + 400); i++) dateVals.push(parsed.rows[i][mapping.date] || '');
    var kind = (mapping.symbol != null || mapping.quantity != null) ? 'brokerage' : 'bank';
    return {
      name: name,
      headerRow: headerRow,
      header: header,
      mapping: mapping,
      dateOrder: detectDateOrder(dateVals),
      flipSign: guessFlip(parsed, mapping, headerRow),
      kind: kind,
      account: String(name || 'Account').replace(/\.(csv|tsv|txt)$/i, '').slice(0, 40)
    };
  }

  // ---------------------------------------------------------- statistics ----

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mad(a, med) { return median(a.map(function (x) { return Math.abs(x - med); })); }
  function percentile(a, p) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  }
  function groupBy(arr, fn) {
    var m = new Map();
    arr.forEach(function (x) { var k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return m;
  }

  // -------------------------------------------------------------- checks ----

  var CHECKS = [
    { id: 'DQ-01', group: 'Data quality', name: 'Parse completeness', dim: 'Completeness', desc: 'Every data row has a readable date and amount.' },
    { id: 'DQ-02', group: 'Data quality', name: 'Duplicate records', dim: 'Uniqueness', desc: 'Identical rows within a file, or the same account loaded twice with overlapping dates.' },
    { id: 'DQ-03', group: 'Data quality', name: 'Value validity', dim: 'Validity', desc: 'Future dates, zero amounts and implausibly large values.' },
    { id: 'DQ-04', group: 'Data quality', name: 'Coverage gaps', dim: 'Timeliness', desc: 'Unusually long silent periods that suggest a missing export window.' },
    { id: 'RC-01', group: 'Reconciliation', name: 'Running balance', dim: 'Consistency', desc: 'Previous balance + amount = reported balance on every row.' },
    { id: 'RC-02', group: 'Reconciliation', name: 'Statement control totals', dim: 'Accuracy', desc: 'Opening balance + net activity = closing balance you entered.' },
    { id: 'RC-03', group: 'Reconciliation', name: 'Transfer matching', dim: 'Consistency', desc: 'Each transfer out of one account lands in another loaded account.' },
    { id: 'RC-04', group: 'Reconciliation', name: 'Trade arithmetic', dim: 'Accuracy', desc: 'Brokerage quantity × price ± fees = net amount.' },
    { id: 'AN-01', group: 'Anomalies', name: 'Duplicate charges', dim: 'Anomaly', desc: 'Same merchant and amount charged again within a few days.' },
    { id: 'AN-02', group: 'Anomalies', name: 'Duplicate subscriptions', dim: 'Anomaly', desc: 'The same service billed on two accounts or twice a cycle, or overlapping services.' },
    { id: 'AN-03', group: 'Anomalies', name: 'Subscription price changes', dim: 'Drift', desc: 'A recurring charge that has moved from its usual amount.' },
    { id: 'AN-04', group: 'Anomalies', name: 'Odd charges', dim: 'Anomaly', desc: 'Charges far outside a merchant\u2019s or category\u2019s normal range, large first-time merchants.' },
    { id: 'AN-05', group: 'Anomalies', name: 'Fees & card-testing signals', dim: 'Anomaly', desc: 'Bank fees, interest, and tiny charges from unfamiliar merchants.' },
    { id: 'BG-01', group: 'Budget', name: 'Budget drift', dim: 'Drift', desc: 'Category spending over budget, or well above its own trailing baseline.' }
  ];

  var DEFAULTS = {
    asOf: null,                 // day number; defaults to today
    nearDupDays: 3,
    budgetTolerancePct: 10,
    baselineDriftPct: 30,
    outlierZ: 3.5,
    largeAmount: 2500000,       // $25,000 in cents
    gapDays: 21
  };

  function finding(check, severity, title, detail, txns, extra) {
    var f = { check: check, severity: severity, title: title, detail: detail || '', txIds: (txns || []).map(function (t) { return t.id; }) };
    if (txns && txns.length) { f.date = txns[0].date; f.account = txns[0].account; f.amount = txns[0].amount; }
    if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
    return f;
  }

  // DQ-01
  function checkCompleteness(ctx) {
    var out = [];
    ctx.files.forEach(function (f) {
      if (f.truncated) out.push(finding('DQ-01', 'high', f.account + ': file truncated', 'Only the first ' + LIMITS.maxRows.toLocaleString() + ' rows were read.', [], { account: f.account }));
      if (!f.rejects.length) return;
      var share = f.rejects.length / (f.rejects.length + f.count);
      var sev = share > 0.05 ? 'high' : 'medium';
      out.push(finding('DQ-01', sev, f.account + ': ' + f.rejects.length + ' unreadable row' + (f.rejects.length > 1 ? 's' : ''),
        f.rejects.slice(0, 5).map(function (r) { return 'line ' + r.line + ': ' + r.reason; }).join('; ') + (f.rejects.length > 5 ? '; …' : '') + '. Check the column mapping and date format.', [], { account: f.account, rows: f.rejects }));
    });
    return out;
  }

  // DQ-02
  function checkDuplicates(ctx) {
    var out = [];
    // a) identical rows inside one file
    groupBy(ctx.txns, function (t) { return t.file + '|' + t.raw; }).forEach(function (g) {
      if (g.length < 2) return;
      out.push(finding('DQ-02', 'medium', 'Identical row appears ' + g.length + '× in ' + g[0].account,
        'Every field matches. Could be two genuine identical purchases, a double charge, or a duplicated export line.', g));
    });
    // b) same account loaded from more than one file with overlapping dates
    var byAcct = groupBy(ctx.files, function (f) { return f.account.toLowerCase(); });
    byAcct.forEach(function (files) {
      if (files.length < 2) return;
      for (var i = 0; i < files.length; i++) for (var j = i + 1; j < files.length; j++) {
        var a = files[i], b = files[j];
        if (a.minDate == null || b.minDate == null) continue;
        var lo = Math.max(a.minDate, b.minDate), hi = Math.min(a.maxDate, b.maxDate);
        if (lo > hi) continue;
        var key = function (t) { return t.date + '|' + t.amount + '|' + t.description; };
        var seen = new Map();
        ctx.txns.forEach(function (t) { if (t.file === a.index && t.date >= lo && t.date <= hi) seen.set(key(t), t); });
        var dups = ctx.txns.filter(function (t) { return t.file === b.index && t.date >= lo && t.date <= hi && seen.has(key(t)); });
        if (!dups.length) continue;
        dups.forEach(function (t) { ctx.doubleCounted.add(t.id); });
        out.push(finding('DQ-02', 'high', a.account + ': ' + dups.length + ' transactions loaded twice',
          'Files "' + a.name + '" and "' + b.name + '" overlap ' + fmtDate(lo) + ' → ' + fmtDate(hi) + '. The second copy is excluded from totals and anomaly checks.', dups.slice(0, 50)));
      }
    });
    return out;
  }

  // DQ-03
  function checkValidity(ctx) {
    var out = [], o = ctx.opts;
    var future = ctx.txns.filter(function (t) { return t.date > o.asOf + 1; });
    if (future.length) out.push(finding('DQ-03', 'high', future.length + ' future-dated transaction' + (future.length > 1 ? 's' : ''), 'Dated after ' + fmtDate(o.asOf) + '. Often a DD/MM vs MM/DD mix-up — check the date format for that file.', future.slice(0, 50)));
    var zero = ctx.txns.filter(function (t) { return t.amount === 0 && t.kind !== 'brokerage'; });
    if (zero.length) out.push(finding('DQ-03', 'low', zero.length + ' zero-amount transaction' + (zero.length > 1 ? 's' : ''), 'Usually authorisation holds or reversals; harmless but worth knowing.', zero.slice(0, 50)));
    ctx.txns.filter(function (t) { return Math.abs(t.amount) >= o.largeAmount; }).forEach(function (t) {
      out.push(finding('DQ-03', 'low', 'Very large amount: ' + fmtMoney(t.amount), maskSensitive(t.description) + ' — confirm it is real and not a parsing error (e.g. a missing decimal point).', [t]));
    });
    var old = ctx.txns.filter(function (t) { return t.date < o.asOf - 365 * 15; });
    if (old.length) out.push(finding('DQ-03', 'medium', old.length + ' transactions older than 15 years', 'Possibly a two-digit-year or date-format problem.', old.slice(0, 50)));
    return out;
  }

  // DQ-04
  function checkGaps(ctx) {
    var out = [];
    groupBy(ctx.live, function (t) { return t.account; }).forEach(function (ts, acct) {
      if (ts.length < 10) return;
      var dates = Array.from(new Set(ts.map(function (t) { return t.date; }))).sort(function (a, b) { return a - b; });
      var gaps = [];
      for (var i = 1; i < dates.length; i++) gaps.push(dates[i] - dates[i - 1]);
      var med = median(gaps) || 1;
      var limit = Math.max(ctx.opts.gapDays, med * 6);
      for (var k = 1; k < dates.length; k++) {
        var g = dates[k] - dates[k - 1];
        if (g > limit) out.push(finding('DQ-04', g > limit * 2 ? 'medium' : 'low', acct + ': no activity for ' + g + ' days',
          fmtDate(dates[k - 1]) + ' → ' + fmtDate(dates[k]) + '. This account normally has activity every ' + Math.round(med) + ' day(s); a statement period may be missing.', [], { account: acct, date: dates[k - 1] }));
      }
    });
    return out;
  }

  // RC-01
  function checkRunningBalance(ctx) {
    var out = [];
    ctx.files.forEach(function (f) {
      var ts = ctx.txns.filter(function (t) { return t.file === f.index && t.balance != null; }).sort(function (a, b) { return a.line - b.line; });
      if (ts.length < 2) return;
      f.hasBalance = true;
      // Exports are newest-first or oldest-first; try both and keep the better fit.
      function breaks(seq) {
        var b = [];
        for (var i = 1; i < seq.length; i++) {
          var exp = seq[i - 1].balance + seq[i].amount;
          if (exp !== seq[i].balance) b.push({ t: seq[i], prev: seq[i - 1], expected: exp, diff: seq[i].balance - exp });
        }
        return b;
      }
      var fwd = breaks(ts), rev = breaks(ts.slice().reverse());
      var res = rev.length < fwd.length ? rev : fwd;
      f.balanceBreaks = res.length;
      if (!res.length) return;
      // Inconsistent sign or mapping makes almost every row break: report once.
      if (res.length > ts.length * 0.6) {
        out.push(finding('RC-01', 'medium', f.account + ': running balance does not tie on most rows', res.length + ' of ' + (ts.length - 1) + ' rows break. The sign may be inverted (try "Flip sign") or the balance column may be an available — not ledger — balance.', [], { account: f.account }));
        return;
      }
      res.slice(0, 25).forEach(function (b) {
        out.push(finding('RC-01', 'high', f.account + ': balance break of ' + fmtMoney(b.diff),
          'After "' + maskSensitive(b.t.description).slice(0, 60) + '" the bank shows ' + fmtMoney(b.t.balance) + ' but prior balance ' + fmtMoney(b.prev.balance) + ' + ' + fmtMoney(b.t.amount) + ' = ' + fmtMoney(b.expected) + '. A transaction is missing, duplicated, or mis-stated.', [b.t]));
      });
      if (res.length > 25) out.push(finding('RC-01', 'high', f.account + ': ' + (res.length - 25) + ' more balance breaks', '', [], { account: f.account }));
    });
    return out;
  }

  // RC-02
  function checkControlTotals(ctx) {
    var out = [];
    ctx.files.forEach(function (f) {
      if (f.opening == null || f.closing == null) return;
      var net = ctx.txns.filter(function (t) { return t.file === f.index; }).reduce(function (s, t) { return s + t.amount; }, 0);
      var exp = f.opening + net, diff = f.closing - exp;
      f.controlDiff = diff;
      if (diff !== 0) out.push(finding('RC-02', 'high', f.account + ': out of balance by ' + fmtMoney(diff),
        'Opening ' + fmtMoney(f.opening) + ' + net activity ' + fmtMoney(net) + ' = ' + fmtMoney(exp) + ', but the statement closes at ' + fmtMoney(f.closing) + '.', [], { account: f.account, amount: diff }));
    });
    return out;
  }

  // RC-03
  function checkTransfers(ctx) {
    var out = [];
    var accounts = new Set(ctx.live.map(function (t) { return t.account; }));
    var tr = ctx.live.filter(function (t) { return t.isTransfer && t.amount !== 0; }).sort(function (a, b) { return a.date - b.date; });
    if (!tr.length) return out;
    var used = new Set(), unmatched = [];
    tr.forEach(function (t) {
      if (used.has(t.id)) return;
      var m = null;
      for (var i = 0; i < tr.length; i++) {
        var u = tr[i];
        if (u === t || used.has(u.id) || u.account === t.account) continue;
        if (u.amount === -t.amount && Math.abs(u.date - t.date) <= 5) { m = u; break; }
      }
      if (m) { used.add(t.id); used.add(m.id); } else unmatched.push(t);
    });
    ctx.transferStats = { total: tr.length, matched: used.size, unmatched: unmatched.length };
    if (accounts.size < 2) {
      out.push(finding('RC-03', 'info', tr.length + ' transfers found, only one account loaded', 'Load the other side (e.g. checking + credit card) to verify each transfer arrived.', []));
      return out;
    }
    unmatched.slice(0, 40).forEach(function (t) {
      out.push(finding('RC-03', Math.abs(t.amount) >= 50000 ? 'medium' : 'low', 'Unmatched transfer ' + fmtMoney(t.amount) + ' in ' + t.account,
        'No equal and opposite entry in another loaded account within 5 days. The destination account may not be loaded, or the money went somewhere unexpected.', [t]));
    });
    return out;
  }

  // RC-04
  function checkTrades(ctx) {
    var out = [];
    ctx.txns.forEach(function (t) {
      if (t.kind !== 'brokerage' || t.quantity == null || t.price == null || !t.quantity || !t.price) return;
      var gross = Math.round(Math.abs(t.quantity * t.price) * 100), fees = Math.abs(t.fees || 0), net = Math.abs(t.amount);
      var ok = [gross + fees, gross - fees, gross].some(function (v) { return Math.abs(v - net) <= Math.max(2, Math.round(net * 0.001)); });
      if (!ok) out.push(finding('RC-04', 'medium', 'Trade does not tie: ' + maskSensitive(t.description).slice(0, 50),
        t.quantity + ' × ' + t.price + ' = ' + fmtMoney(gross) + (fees ? ' (fees ' + fmtMoney(fees) + ')' : '') + ' but net amount is ' + fmtMoney(t.amount) + '.', [t]));
    });
    return out;
  }

  // Recurring series detection, shared by AN-01/02/03.
  var CADENCES = [
    { name: 'Weekly', days: 7, tol: 2 },
    { name: 'Every 2 weeks', days: 14, tol: 3 },
    { name: 'Monthly', days: 30.4, tol: 5 },
    { name: 'Quarterly', days: 91, tol: 10 },
    { name: 'Yearly', days: 365, tol: 15 }
  ];

  function detectRecurring(ctx) {
    var subs = [];
    var spend = ctx.live.filter(function (t) { return t.amount < 0 && !t.isTransfer && t.kind !== 'brokerage'; });
    groupBy(spend, function (t) { return t.account + '|' + t.merchant; }).forEach(function (ts) {
      if (ts.length < 2) return;
      ts.sort(function (a, b) { return a.date - b.date; });
      // Split a merchant's charges into amount clusters (two plans at one merchant = two series).
      var clusters = [];
      ts.forEach(function (t) {
        var a = -t.amount, c = null;
        for (var i = 0; i < clusters.length; i++) if (Math.abs(a - clusters[i].ref) <= Math.max(100, clusters[i].ref * 0.2)) { c = clusters[i]; break; }
        if (!c) { c = { ref: a, ts: [] }; clusters.push(c); }
        c.ts.push(t);
      });
      clusters.forEach(function (c) {
        var s = c.ts;
        if (s.length < 2) return;
        var gaps = [];
        for (var i = 1; i < s.length; i++) gaps.push(s[i].date - s[i - 1].date);
        var g = median(gaps), cad = null;
        CADENCES.forEach(function (k) { if (!cad && Math.abs(g - k.days) <= k.tol) cad = k; });
        if (!cad) return;
        var fit = gaps.filter(function (x) { return Math.abs(x - cad.days) <= cad.tol; }).length / gaps.length;
        var need = cad.days >= 300 ? 2 : 3;
        if (s.length < need || fit < 0.6) return;
        var amts = s.map(function (t) { return -t.amount; });
        // Subscriptions and fixed bills charge (nearly) the same amount every time;
        // weekly grocery runs do not. Allow one price step within the series.
        var medAll = median(amts);
        var stable = amts.filter(function (a) { return Math.abs(a - medAll) <= Math.max(50, medAll * 0.05); }).length / amts.length;
        if (stable < 0.8) return;
        // A real subscription is most of what you pay that merchant, not a slice of a habit.
        if (s.length / ts.length < 0.5) return;
        var typical = median(amts.slice(-3));
        var last = s[s.length - 1];
        subs.push({
          merchant: s[0].merchant,
          description: s[s.length - 1].description,
          account: s[0].account,
          cadence: cad.name,
          cadenceDays: cad.days,
          tol: cad.tol,
          count: s.length,
          typical: Math.round(typical),
          last: -last.amount,
          lastDate: last.date,
          firstDate: s[0].date,
          annual: Math.round(typical * 365 / cad.days),
          active: (ctx.maxDate - last.date) <= cad.days * 1.5 + cad.tol,
          category: last.category,
          txns: s
        });
      });
    });
    subs.sort(function (a, b) { return b.annual - a.annual; });
    return subs;
  }

  // AN-01
  function checkDuplicateCharges(ctx) {
    var out = [], days = ctx.opts.nearDupDays;
    var recurringIds = new Set();
    ctx.subs.forEach(function (s) { if (s.cadenceDays <= 14) s.txns.forEach(function (t) { recurringIds.add(t.id); }); });
    var spend = ctx.live.filter(function (t) { return t.amount < 0 && !t.isTransfer && t.kind !== 'brokerage' && !recurringIds.has(t.id); });
    var seenPairs = new Set();
    groupBy(spend, function (t) { return t.merchant + '|' + t.amount; }).forEach(function (g) {
      if (g.length < 2) return;
      g.sort(function (a, b) { return a.date - b.date; });
      for (var i = 0; i < g.length; i++) for (var j = i + 1; j < g.length && g[j].date - g[i].date <= days; j++) {
        var a = g[i], b = g[j];
        if (a.raw === b.raw && a.file === b.file) continue; // reported by DQ-02
        var key = a.id + '>' + b.id;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        var cross = a.account !== b.account;
        var sev = Math.abs(a.amount) >= 2000 ? 'medium' : 'low';
        if (cross) sev = 'medium';
        out.push(finding('AN-01', sev, (cross ? 'Same charge on two accounts: ' : 'Possible double charge: ') + a.merchant + ' ' + fmtMoney(a.amount),
          (b.date === a.date ? 'Same day' : (b.date - a.date) + ' day(s) apart') + (cross ? ', on ' + a.account + ' and ' + b.account : '') + '. Confirm one is not a duplicate before the dispute window closes.', [a, b]));
      }
    });
    return out;
  }

  // AN-02
  function brandKey(m) { var w = m.split(' ')[0]; return w.length >= 4 ? w : m; }

  function checkDuplicateSubscriptions(ctx) {
    var out = [];
    var active = ctx.subs.filter(function (s) { return s.active && s.cadenceDays >= 28; });
    // a) same brand, more than one active series: on different accounts at a similar price
    //    (paying twice), or two plans on one account.
    groupBy(active, function (s) { return brandKey(s.merchant); }).forEach(function (ss, brand) {
      if (ss.length < 2) return;
      var dup = [];
      for (var i = 0; i < ss.length; i++) for (var j = i + 1; j < ss.length; j++) {
        var a = ss[i], b = ss[j];
        if (a.cadence !== b.cadence) continue;
        var similar = Math.abs(a.typical - b.typical) <= Math.max(100, a.typical * 0.1);
        if ((a.account !== b.account && similar) || (a.account === b.account && a.merchant === b.merchant)) {
          if (dup.indexOf(a) < 0) dup.push(a);
          if (dup.indexOf(b) < 0) dup.push(b);
        }
      }
      if (dup.length < 2) return;
      var accts = Array.from(new Set(dup.map(function (s) { return s.account; })));
      var annual = dup.reduce(function (x, s) { return x + s.annual; }, 0);
      out.push(finding('AN-02', accts.length > 1 ? 'high' : 'medium', 'Duplicate subscription: ' + brand,
        dup.length + ' active series (' + dup.map(function (s) { return s.cadence.toLowerCase() + ' ' + fmtMoney(s.typical) + ' on ' + s.account; }).join('; ') + ')' +
        (accts.length > 1 ? ' — the same service billed to different accounts.' : ' — two plans on one account.') + ' Combined ≈ ' + fmtMoney(annual) + '/yr.',
        dup.map(function (s) { return s.txns[s.txns.length - 1]; }), { amount: -annual }));
    });
    // b) overlapping services in the same functional group
    OVERLAP_GROUPS.forEach(function (gp) {
      var ss = active.filter(function (s) { return gp[1].test(s.description) || gp[1].test(s.merchant); });
      var brands = Array.from(new Set(ss.map(function (s) { return brandKey(s.merchant); })));
      if (brands.length < 2) return;
      var annual = ss.reduce(function (x, s) { return x + s.annual; }, 0);
      out.push(finding('AN-02', 'info', 'Overlapping ' + gp[0].toLowerCase() + ': ' + brands.join(', '),
        brands.length + ' services that do similar things, ≈ ' + fmtMoney(annual) + '/yr together. Worth checking they are all still used.',
        ss.map(function (s) { return s.txns[s.txns.length - 1]; }), { amount: -annual }));
    });
    return out;
  }

  // AN-03
  function checkPriceChanges(ctx) {
    var out = [], done = new Set();
    var spend = ctx.live.filter(function (t) { return t.amount < 0 && !t.isTransfer; });
    var byM = groupBy(spend, function (t) { return t.account + '|' + t.merchant; });
    ctx.subs.slice().sort(function (a, b) { return b.lastDate - a.lastDate; }).forEach(function (s) {
      var key = s.account + '|' + s.merchant;
      if (done.has(key)) return;
      var all = byM.get(key).slice().sort(function (a, b) { return a.date - b.date; });
      var latest = all[all.length - 1], seriesLast = s.txns[s.txns.length - 1];
      // If the merchant's newest charge fell outside this series, the price moved out of the
      // series' amount band; otherwise compare the last two charges inside the series.
      var prev = latest.id !== seriesLast.id ? seriesLast : s.txns[s.txns.length - 2];
      if (!prev || latest.date <= prev.date) return;
      if (ctx.maxDate - latest.date > s.cadenceDays * 1.5 + 10) return;          // not current
      var cycles = Math.round((latest.date - prev.date) / s.cadenceDays);
      if (cycles < 1 || Math.abs(latest.date - prev.date - cycles * s.cadenceDays) > s.tol * cycles) return; // off-cycle one-off
      var a = -latest.amount, b = -prev.amount, d = a - b;
      if (Math.abs(d) < 100 || Math.abs(d) / b < 0.05) return;
      done.add(key);
      out.push(finding('AN-03', d > 0 ? 'medium' : 'info', s.merchant + ' ' + (d > 0 ? 'went up' : 'went down') + ' ' + Math.round(Math.abs(d) / b * 100) + '%',
        fmtMoney(-b) + ' on ' + fmtDate(prev.date) + ' → ' + fmtMoney(-a) + ' on ' + fmtDate(latest.date) + ' (' + s.account + ', ' + s.cadence.toLowerCase() + '). ≈ ' + fmtMoney(Math.round(d * 365 / s.cadenceDays)) + '/yr difference.', [latest, prev]));
    });
    return out;
  }

  // AN-04
  function checkOutliers(ctx) {
    var out = [], z = ctx.opts.outlierZ, flagged = new Set();
    var spend = ctx.live.filter(function (t) { return t.amount < 0 && !t.isTransfer && t.kind !== 'brokerage'; });
    // Per merchant
    groupBy(spend, function (t) { return t.merchant; }).forEach(function (g, m) {
      if (g.length < 4) return;
      var a = g.map(function (t) { return -t.amount; }), med = median(a), d = mad(a, med) || Math.max(100, med * 0.05);
      g.forEach(function (t) {
        var x = -t.amount, score = 0.6745 * (x - med) / d;
        if (score > z && x > med * 1.5 && x - med >= 2000) {
          flagged.add(t.id);
          out.push(finding('AN-04', x > med * 4 ? 'medium' : 'low', 'Unusually large ' + m + ' charge: ' + fmtMoney(t.amount),
            'Typical ' + m + ' charge is ' + fmtMoney(-med) + ' (' + g.length + ' charges). This one is ' + (x / med).toFixed(1) + '× that.', [t]));
        }
      });
    });
    // Per category
    groupBy(spend, function (t) { return t.category; }).forEach(function (g, c) {
      if (g.length < 8 || c === 'Housing' || c === 'Uncategorized') return;
      var a = g.map(function (t) { return -t.amount; }), med = median(a), d = mad(a, med) || Math.max(100, med * 0.05);
      g.forEach(function (t) {
        var x = -t.amount;
        if (flagged.has(t.id)) return;
        if (0.6745 * (x - med) / d > z * 2 && x > med * 3 && x >= 10000) {
          flagged.add(t.id);
          out.push(finding('AN-04', 'low', 'Large for ' + c + ': ' + fmtMoney(t.amount) + ' at ' + t.merchant,
            'Typical ' + c + ' transaction is ' + fmtMoney(-med) + '.', [t]));
        }
      });
    });
    // Large first-time merchants
    var p95 = percentile(spend.map(function (t) { return -t.amount; }), 0.95) || 0;
    var limit = Math.max(25000, p95);
    groupBy(spend, function (t) { return t.merchant; }).forEach(function (g, m) {
      if (g.length !== 1) return;
      var t = g[0];
      if (-t.amount >= limit && !flagged.has(t.id) && t.category !== 'Housing') {
        out.push(finding('AN-04', 'info', 'Large one-off at a new merchant: ' + fmtMoney(t.amount),
          maskSensitive(t.description) + ' — only charge from this merchant in the data, and in your top 5% of charges.', [t]));
      }
    });
    return out;
  }

  // AN-05
  function checkFeesAndTesting(ctx) {
    var out = [];
    var fees = ctx.live.filter(function (t) { return t.amount < 0 && (FEE_RE.test(t.description) || t.category === 'Fees & Interest'); });
    groupBy(fees, function (t) { return t.account; }).forEach(function (g, acct) {
      var total = g.reduce(function (s, t) { return s + t.amount; }, 0);
      out.push(finding('AN-05', 'medium', acct + ': ' + g.length + ' fee/interest charge' + (g.length > 1 ? 's' : '') + ' totalling ' + fmtMoney(total),
        'Bank fees and interest are often avoidable or refundable on request. ' + g.slice(0, 4).map(function (t) { return fmtDate(t.date) + ' ' + maskSensitive(t.description).slice(0, 40) + ' ' + fmtMoney(t.amount); }).join('; '), g, { amount: total }));
    });
    var counts = groupBy(ctx.live.filter(function (t) { return t.amount < 0; }), function (t) { return t.merchant; });
    ctx.live.forEach(function (t) {
      if (t.amount < 0 && t.amount > -200 && t.amount !== 0 && !t.isTransfer && (counts.get(t.merchant) || []).length <= 2 && !FEE_RE.test(t.description)) {
        out.push(finding('AN-05', 'medium', 'Tiny charge from unfamiliar merchant: ' + fmtMoney(t.amount),
          maskSensitive(t.description) + '. Small unknown charges are a common sign someone is testing a stolen card number.', [t]));
      }
    });
    return out;
  }

  // BG-01
  function monthlyByCategory(ctx) {
    var m = {};
    ctx.live.forEach(function (t) {
      if (t.amount >= 0 || t.isTransfer || t.kind === 'brokerage') return;
      var mk = monthKey(t.date);
      m[t.category] = m[t.category] || {};
      m[t.category][mk] = (m[t.category][mk] || 0) - t.amount;
    });
    return m;
  }

  function checkBudget(ctx) {
    var out = [], o = ctx.opts, budget = ctx.budget || {};
    var months = ctx.months;
    var hasBudget = Object.keys(budget).some(function (k) { return budget[k] > 0; });
    // Only judge complete months unless it's the only month we have.
    var lastFull = months.filter(function (mk) { return ctx.maxDate >= endOfMonth(mk); });
    var judge = lastFull.length ? lastFull : months;
    Object.keys(ctx.byCat).forEach(function (cat) {
      var series = ctx.byCat[cat];
      judge.forEach(function (mk, idx) {
        var actual = series[mk] || 0;
        var lim = budget[cat];
        if (lim > 0) {
          var over = actual - lim;
          if (over > lim * o.budgetTolerancePct / 100) {
            out.push(finding('BG-01', over > lim * 0.25 ? 'high' : 'medium', cat + ' over budget in ' + mk + ' by ' + fmtMoney(over),
              'Spent ' + fmtMoney(actual) + ' vs budget ' + fmtMoney(lim) + ' (' + Math.round(actual / lim * 100) + '%).', [], { date: monthStart(mk), amount: -over, month: mk, category: cat }));
          }
        } else if (!hasBudget || lim == null) {
          var prior = months.slice(Math.max(0, months.indexOf(mk) - 6), months.indexOf(mk)).map(function (p) { return series[p] || 0; });
          if (prior.length < 3) return;
          var base = median(prior);
          if (base > 0 && actual > base * (1 + o.baselineDriftPct / 100) && actual - base >= 5000) {
            out.push(finding('BG-01', actual > base * 2 ? 'medium' : 'low', cat + ' drifted above its baseline in ' + mk,
              fmtMoney(actual) + ' vs a trailing median of ' + fmtMoney(base) + ' (+' + Math.round((actual / base - 1) * 100) + '%). Set a budget for this category to track it explicitly.', [], { date: monthStart(mk), amount: -(actual - base), month: mk, category: cat }));
          }
        }
      });
    });
    return out;
  }
  function monthStart(mk) { return dayNum(+mk.slice(0, 4), +mk.slice(5, 7), 1); }
  function endOfMonth(mk) { var y = +mk.slice(0, 4), m = +mk.slice(5, 7); return dayNum(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1; }

  /** Suggest a monthly budget per category from history (median of full months). */
  function suggestBudget(result) {
    var b = {};
    Object.keys(result.byCat).forEach(function (cat) {
      if (cat === 'Transfer') return;
      var vals = result.months.map(function (mk) { return result.byCat[cat][mk] || 0; });
      var med = median(vals);
      if (med > 0) b[cat] = Math.ceil(med / 1000) * 1000; // round up to $10
    });
    return b;
  }

  // ---------------------------------------------------------------- run ----

  var SEV_RANK = { high: 0, medium: 1, low: 2, info: 3 };

  /**
   * files: [{name, rows, truncated, cfg:{mapping, headerRow, dateOrder, flipSign, account, kind, opening, closing}}]
   * budget: {category: cents}
   */
  function analyze(files, budget, opts) {
    var o = {};
    Object.keys(DEFAULTS).forEach(function (k) { o[k] = (opts && opts[k] != null) ? opts[k] : DEFAULTS[k]; });
    if (o.asOf == null) o.asOf = Math.floor(Date.now() / DAY);

    var ctx = { opts: o, files: [], txns: [], budget: budget || {}, doubleCounted: new Set() };
    files.forEach(function (f, i) {
      var cfg = Object.assign({}, f.cfg, { fileIndex: i });
      var n = normalizeFile(f, cfg);
      var dates = n.txns.map(function (t) { return t.date; });
      ctx.files.push({
        index: i, name: f.name, account: cfg.account, kind: cfg.kind, truncated: !!f.truncated,
        count: n.txns.length, rejects: n.rejects,
        minDate: dates.length ? Math.min.apply(null, dates) : null,
        maxDate: dates.length ? Math.max.apply(null, dates) : null,
        opening: cfg.opening, closing: cfg.closing
      });
      Array.prototype.push.apply(ctx.txns, n.txns);
    });

    var findings = [];
    findings = findings.concat(checkCompleteness(ctx), checkDuplicates(ctx));
    ctx.live = ctx.txns.filter(function (t) { return !ctx.doubleCounted.has(t.id); });
    var dates = ctx.live.map(function (t) { return t.date; });
    ctx.minDate = dates.length ? dates.reduce(function (a, b) { return Math.min(a, b); }) : null;
    ctx.maxDate = dates.length ? dates.reduce(function (a, b) { return Math.max(a, b); }) : null;
    ctx.months = Array.from(new Set(ctx.live.filter(function (t) { return t.kind !== 'brokerage'; }).map(function (t) { return monthKey(t.date); }))).sort();
    ctx.byCat = monthlyByCategory(ctx);
    ctx.subs = detectRecurring(ctx);

    findings = findings.concat(
      checkValidity(ctx), checkGaps(ctx),
      checkRunningBalance(ctx), checkControlTotals(ctx), checkTransfers(ctx), checkTrades(ctx),
      checkDuplicateCharges(ctx), checkDuplicateSubscriptions(ctx), checkPriceChanges(ctx),
      checkOutliers(ctx), checkFeesAndTesting(ctx), checkBudget(ctx)
    );
    findings.forEach(function (f, i) { f.id = i; });
    findings.sort(function (a, b) { return SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.check.localeCompare(b.check) || (b.date || 0) - (a.date || 0); });

    // Scorecard
    var applicable = {
      'RC-01': ctx.files.some(function (f) { return f.hasBalance; }),
      'RC-02': ctx.files.some(function (f) { return f.opening != null && f.closing != null; }),
      'RC-03': ctx.live.some(function (t) { return t.isTransfer; }),
      'RC-04': ctx.txns.some(function (t) { return t.kind === 'brokerage' && t.quantity != null && t.price != null; })
    };
    var scorecard = CHECKS.map(function (c) {
      var fs = findings.filter(function (f) { return f.check === c.id; });
      var worst = fs.reduce(function (w, f) { return Math.min(w, SEV_RANK[f.severity]); }, 9);
      var status = applicable[c.id] === false ? 'n/a' : worst === 0 ? 'fail' : worst <= 2 ? 'warn' : 'pass';
      return Object.assign({}, c, { status: status, count: fs.length });
    });

    var spend = ctx.live.filter(function (t) { return t.amount < 0 && !t.isTransfer && t.kind !== 'brokerage'; });
    var income = ctx.live.filter(function (t) { return t.amount > 0 && !t.isTransfer && t.kind !== 'brokerage'; });
    var activeSubs = ctx.subs.filter(function (s) { return s.active; });

    return {
      files: ctx.files,
      txns: ctx.txns,
      txById: new Map(ctx.txns.map(function (t) { return [t.id, t]; })),
      findings: findings,
      scorecard: scorecard,
      subscriptions: ctx.subs,
      byCat: ctx.byCat,
      months: ctx.months,
      budget: ctx.budget,
      transferStats: ctx.transferStats || null,
      summary: {
        transactions: ctx.live.length,
        excludedDuplicates: ctx.doubleCounted.size,
        accounts: new Set(ctx.live.map(function (t) { return t.account; })).size,
        from: ctx.minDate, to: ctx.maxDate,
        spend: spend.reduce(function (s, t) { return s + t.amount; }, 0),
        income: income.reduce(function (s, t) { return s + t.amount; }, 0),
        subsAnnual: activeSubs.reduce(function (s, x) { return s + x.annual; }, 0),
        subsCount: activeSubs.length,
        bySeverity: ['high', 'medium', 'low', 'info'].reduce(function (m, s) { m[s] = findings.filter(function (f) { return f.severity === s; }).length; return m; }, {})
      }
    };
  }

  var api = {
    LIMITS: LIMITS, FIELDS: FIELDS, CHECKS: CHECKS, DEFAULTS: DEFAULTS,
    parseCSV: parseCSV, detectDelimiter: detectDelimiter, findHeaderRow: findHeaderRow, guessMapping: guessMapping,
    parseAmount: parseAmount, parseDate: parseDate, detectDateOrder: detectDateOrder,
    fmtDate: fmtDate, fmtMoney: fmtMoney, monthKey: monthKey,
    maskSensitive: maskSensitive, csvCell: csvCell, toCSV: toCSV,
    normalizeMerchant: normalizeMerchant, categorize: categorize,
    inspectFile: inspectFile, normalizeFile: normalizeFile, analyze: analyze, suggestBudget: suggestBudget,
    median: median, DAY: DAY
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LedgerEngine = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
