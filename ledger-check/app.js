/*
 * Ledger Check — UI layer.
 *
 * Security rules this file follows:
 *  - Untrusted text (anything from a CSV) is only ever written with textContent /
 *    form .value. There is no innerHTML, insertAdjacentHTML, document.write or eval.
 *  - No network, no storage APIs. State lives in the `S` object and is dropped on Clear.
 *  - Exports are built in memory and handed to the browser as a Blob download, with
 *    spreadsheet-formula characters neutralised (see engine csvCell).
 */
(function () {
  'use strict';
  var E = window.LedgerEngine;
  var MAX_FILE_BYTES = 25 * 1024 * 1024;
  var MAX_FILES = 25;
  var SEVS = ['high', 'medium', 'low', 'info'];
  var FIELD_LABELS = {
    date: 'Date', description: 'Description', amount: 'Amount (signed)', debit: 'Debit / money out', credit: 'Credit / money in',
    balance: 'Running balance', category: 'Category', account: 'Account', symbol: 'Symbol', quantity: 'Quantity',
    price: 'Price', fees: 'Fees', action: 'Action'
  };

  var S = freshState();
  function freshState() {
    return {
      files: [], budget: {}, result: null, mask: true,
      opts: { nearDupDays: E.DEFAULTS.nearDupDays, budgetTolerancePct: E.DEFAULTS.budgetTolerancePct, baselineDriftPct: E.DEFAULTS.baselineDriftPct, outlierZ: E.DEFAULTS.outlierZ, asOf: null },
      filter: { sevs: new Set(SEVS), check: '', q: '' },
      open: new Set(), budgetCats: ''
    };
  }

  // ------------------------------------------------------------ helpers ----

  function $(id) { return document.getElementById(id); }

  /** Safe element builder: text children become text nodes; no HTML parsing ever. */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function show(el, on) { el.hidden = !on; }
  function masked(s) { return S.mask ? E.maskSensitive(s) : String(s == null ? '' : s); }
  function money(c) { return E.fmtMoney(c); }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 60); }

  function fileMsg(text) { var m = $('fileMsg'); m.textContent = text || ''; show(m, !!text); }

  // ------------------------------------------------------------- loading ----

  function addTextFile(name, text) {
    if (S.files.length >= MAX_FILES) { fileMsg('Up to ' + MAX_FILES + ' files at a time.'); return; }
    if (/\u0000/.test(text.slice(0, 4096)) || /^PK\u0003\u0004/.test(text)) {
      fileMsg('"' + name + '" looks like a spreadsheet or binary file. Export it from your bank as CSV and try again.');
      return;
    }
    var parsed = E.parseCSV(text);
    if (parsed.rows.length < 2) { fileMsg('"' + name + '" has no data rows.'); return; }
    var cfg = E.inspectFile(parsed, name);
    if (cfg.mapping.date == null || (cfg.mapping.amount == null && cfg.mapping.debit == null && cfg.mapping.credit == null)) {
      fileMsg('Could not find date/amount columns in "' + name + '". Pick them under "Columns" on its card.');
    }
    S.files.push({ name: name, rows: parsed.rows, truncated: parsed.truncated, cfg: cfg, uid: Math.random().toString(36).slice(2) });
  }

  function readFiles(list) {
    fileMsg('');
    var files = Array.prototype.slice.call(list || []);
    var big = files.filter(function (f) { return f.size > MAX_FILE_BYTES; });
    if (big.length) fileMsg(big.map(function (f) { return f.name; }).join(', ') + ' is larger than 25 MB and was skipped.');
    Promise.all(files.filter(function (f) { return f.size <= MAX_FILE_BYTES; }).map(function (f) {
      return f.text().then(function (t) { return { name: f.name, text: t }; });
    })).then(function (loaded) {
      loaded.forEach(function (x) { addTextFile(x.name, x.text); });
      renderFiles(); schedule();
    }).catch(function () { fileMsg('A file could not be read.'); });
  }

  function loadSample() {
    clearAll(true);
    window.LedgerSample.build(new Date()).forEach(function (f) { addTextFile(f.name, f.text); });
    S.budget = { Dining: 30000, Groceries: 90000, Shopping: 25000, Subscriptions: 6000 };
    renderFiles(); schedule();
  }

  function clearAll(silent) {
    S = freshState();
    $('fileInput').value = '';
    $('budgetInput').value = '';
    clear($('fileList')); clear($('results')); clear($('budgetTable'));
    show($('results'), false); show($('budgetSection'), false);
    $('clearBtn').disabled = true;
    syncSettings();
    if (!silent) fileMsg('');
  }

  // --------------------------------------------------------- file cards ----

  function renderFiles() {
    var list = clear($('fileList'));
    $('clearBtn').disabled = !S.files.length;
    show($('budgetSection'), S.files.length > 0);
    S.files.forEach(function (f, idx) {
      var c = f.cfg;
      var stats = h('span', { class: 'file-stats', id: 'stats-' + f.uid, text: (f.rows.length - c.headerRow - 1) + ' rows' });
      var mapGrid = h('div', { class: 'map-grid' });
      E.FIELDS.forEach(function (field) {
        if (c.kind !== 'brokerage' && ['symbol', 'quantity', 'price', 'fees', 'action'].indexOf(field) >= 0 && c.mapping[field] == null) return;
        var sel = h('select', { 'aria-label': FIELD_LABELS[field] + ' column', onchange: function () {
          if (sel.value === '') delete c.mapping[field]; else c.mapping[field] = +sel.value;
          schedule();
        } }, h('option', { value: '', text: '— none —' }));
        c.header.forEach(function (name, i) {
          sel.appendChild(h('option', { value: String(i), text: (String(name).trim() || 'Column ' + (i + 1)).slice(0, 40), selected: c.mapping[field] === i }));
        });
        mapGrid.appendChild(h('label', null, FIELD_LABELS[field], sel));
      });
      var headerSel = h('input', { type: 'number', min: '1', max: String(Math.min(f.rows.length, 30)), value: String(c.headerRow + 1), onchange: function (e) {
        var n = Math.max(1, Math.min(f.rows.length, parseInt(e.target.value, 10) || 1)) - 1;
        c.headerRow = n; c.header = f.rows[n] || []; c.mapping = E.guessMapping(c.header);
        renderFiles(); schedule();
      } });

      list.appendChild(h('article', { class: 'file' },
        h('div', { class: 'file-head' },
          h('div', null, h('div', { class: 'file-name', text: f.name }), stats),
          h('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove ' + f.name, onclick: function () {
            S.files.splice(idx, 1); renderFiles(); schedule();
          } }, 'Remove')),
        h('div', { class: 'file-grid' },
          h('label', null, 'Account name', h('input', { type: 'text', maxlength: '40', value: c.account, onchange: function (e) { c.account = e.target.value.trim() || f.name; schedule(); } })),
          h('label', null, 'Type', h('select', { onchange: function (e) { c.kind = e.target.value; renderFiles(); schedule(); } },
            h('option', { value: 'bank', text: 'Bank / card', selected: c.kind === 'bank' }),
            h('option', { value: 'brokerage', text: 'Brokerage', selected: c.kind === 'brokerage' }))),
          h('label', null, 'Date format', h('select', { onchange: function (e) { c.dateOrder = e.target.value; schedule(); } },
            h('option', { value: 'MDY', text: 'Month/Day/Year', selected: c.dateOrder === 'MDY' }),
            h('option', { value: 'DMY', text: 'Day/Month/Year', selected: c.dateOrder === 'DMY' }))),
          h('label', null, 'Statement opening balance', h('input', { type: 'text', inputmode: 'decimal', placeholder: 'optional', value: c.opening != null ? (c.opening / 100).toFixed(2) : '', onchange: function (e) { c.opening = E.parseAmount(e.target.value); schedule(); } })),
          h('label', null, 'Statement closing balance', h('input', { type: 'text', inputmode: 'decimal', placeholder: 'optional', value: c.closing != null ? (c.closing / 100).toFixed(2) : '', onchange: function (e) { c.closing = E.parseAmount(e.target.value); schedule(); } })),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.flipSign, onchange: function (e) { c.flipSign = e.target.checked; schedule(); } }),
            'Flip sign (charges exported as positive)')),
        h('details', null, h('summary', null, 'Columns'),
          h('p', { class: 'hint', text: 'Auto-detected. Fix any that are wrong — results update instantly.' }),
          h('label', null, 'Header is on row', headerSel), mapGrid)));
    });
  }

  function updateFileStats() {
    if (!S.result) return;
    S.result.files.forEach(function (rf, i) {
      var f = S.files[i]; if (!f) return;
      var el = $('stats-' + f.uid); if (!el) return;
      var bits = [rf.count + ' transactions'];
      if (rf.minDate != null) bits.push(E.fmtDate(rf.minDate) + ' → ' + E.fmtDate(rf.maxDate));
      if (rf.rejects.length) bits.push(rf.rejects.length + ' unreadable');
      if (f.cfg.kind === 'brokerage') bits.push('brokerage');
      if (rf.hasBalance) bits.push(rf.balanceBreaks ? rf.balanceBreaks + ' balance breaks' : 'balance ties ✓');
      el.textContent = bits.join(' · ');
    });
  }

  // ------------------------------------------------------------- budget ----

  function budgetCents() { return S.budget; }

  function renderBudget(force) {
    if (!S.result) return;
    var r = S.result;
    var cats = Object.keys(r.byCat).filter(function (c) { return c !== 'Transfer'; });
    Object.keys(S.budget).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
    cats.sort();
    var sig = cats.join('|') + '#' + r.months.join('|');
    if (!force && sig === S.budgetCats) return;  // keep focus while typing
    S.budgetCats = sig;
    var t = clear($('budgetTable'));
    t.appendChild(h('thead', null, h('tr', null, h('th', null, 'Category'), h('th', { class: 'num' }, 'Median / month'), h('th', { class: 'num' }, 'Monthly budget'))));
    var tb = h('tbody');
    cats.forEach(function (cat) {
      var vals = r.months.map(function (m) { return (r.byCat[cat] || {})[m] || 0; });
      tb.appendChild(h('tr', null,
        h('td', { text: cat }),
        h('td', { class: 'num muted', text: money(E.median(vals) || 0) }),
        h('td', { class: 'num' }, h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Budget for ' + cat, placeholder: '—',
          value: S.budget[cat] != null ? (S.budget[cat] / 100).toFixed(2) : '',
          onchange: function (e) {
            var v = E.parseAmount(e.target.value);
            if (v == null || v <= 0) delete S.budget[cat]; else S.budget[cat] = Math.abs(v);
            schedule();
          } }))));
    });
    t.appendChild(tb);
  }

  function importBudget(file) {
    if (!file || file.size > 1024 * 1024) { fileMsg('Budget file must be a small CSV.'); return; }
    file.text().then(function (text) {
      var rows = E.parseCSV(text).rows, n = 0;
      rows.forEach(function (r) {
        var v = E.parseAmount(r[1]);
        var cat = String(r[0] || '').trim().slice(0, 60);
        if (cat && v != null) { S.budget[cat] = Math.abs(v); n++; }
      });
      if (!n) fileMsg('No "category,amount" rows found in the budget file.');
      S.budgetCats = ''; schedule();
    });
  }

  // ------------------------------------------------------------ results ----

  function run() {
    if (!S.files.length) { S.result = null; clear($('results')); show($('results'), false); return; }
    var opts = Object.assign({}, S.opts);
    S.result = E.analyze(S.files.map(function (f) { return { name: f.name, rows: f.rows, truncated: f.truncated, cfg: f.cfg }; }), budgetCents(), opts);
    updateFileStats();
    renderBudget(false);
    renderResults();
  }

  function renderResults() {
    var r = S.result, root = clear($('results'));
    show(root, true);
    var sm = r.summary;
    root.appendChild(h('div', { class: 'tiles' },
      tile('Transactions', sm.transactions.toLocaleString(), sm.accounts + ' account' + (sm.accounts === 1 ? '' : 's') + (sm.excludedDuplicates ? ' · ' + sm.excludedDuplicates + ' double-loaded excluded' : '')),
      tile('Period', sm.from != null ? E.fmtDate(sm.from).slice(0, 7) + ' → ' + E.fmtDate(sm.to).slice(0, 7) : '—', r.months.length + ' month(s)'),
      tile('Spending', money(-sm.spend), 'Income ' + money(sm.income) + ' · transfers excluded'),
      tile('Recurring charges', money(sm.subsAnnual) + '/yr', sm.subsCount + ' active'),
      tile('Findings', String(r.findings.length), SEVS.map(function (s) { return sm.bySeverity[s] + ' ' + s; }).join(' · '))));

    root.appendChild(scorecard(r));
    root.appendChild(findingsSection(r));
    root.appendChild(recurringSection(r));
    root.appendChild(budgetSection(r));
  }

  function tile(k, v, s) { return h('div', { class: 'tile' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }), h('div', { class: 's', text: s })); }

  function scorecard(r) {
    var groups = {};
    r.scorecard.forEach(function (c) { (groups[c.group] = groups[c.group] || []).push(c); });
    var wrap = h('div', { class: 'score-groups' });
    Object.keys(groups).forEach(function (g) {
      wrap.appendChild(h('div', null, h('h3', { text: g }), h('ul', { class: 'score-list' }, groups[g].map(function (c) {
        return h('li', null, h('button', { type: 'button', title: 'Show ' + c.id + ' findings', onclick: function () {
          S.filter.check = c.status === 'n/a' ? '' : c.id; S.filter.sevs = new Set(SEVS); renderResults();
          var f = $('findings'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } }, h('div', { class: 'score-item' },
          h('span', { class: 'pill ' + c.status, text: c.status === 'n/a' ? 'n/a' : c.status }),
          h('div', null, h('div', { class: 'score-name', text: c.name }), h('div', { class: 'score-desc', text: c.desc })),
          h('div', { class: 'num' }, h('div', { class: 'score-id', text: c.id }), h('div', { class: 'muted', text: c.count ? String(c.count) : '' })))));
      }))));
    });
    return h('section', { class: 'card' }, h('div', { class: 'section-head' }, h('h2', { text: 'Control scorecard' }),
      h('button', { type: 'button', class: 'btn small ghost no-print', onclick: function () { window.print(); } }, 'Print report')), wrap);
  }

  function findingsSection(r) {
    var f = S.filter;
    var items = r.findings.filter(function (x) {
      if (!f.sevs.has(x.severity)) return false;
      if (f.check && x.check !== f.check) return false;
      if (f.q) { var q = f.q.toLowerCase(); if ((x.title + ' ' + x.detail + ' ' + (x.account || '')).toLowerCase().indexOf(q) < 0) return false; }
      return true;
    });
    var chips = SEVS.map(function (s) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': f.sevs.has(s) ? 'true' : 'false', onclick: function () {
        if (f.sevs.has(s)) f.sevs.delete(s); else f.sevs.add(s); renderResults();
      } }, s + ' (' + r.summary.bySeverity[s] + ')');
    });
    var checkSel = h('select', { 'aria-label': 'Filter by check', onchange: function (e) { f.check = e.target.value; renderResults(); } },
      h('option', { value: '', text: 'All checks' }),
      E.CHECKS.map(function (c) { return h('option', { value: c.id, text: c.id + ' ' + c.name, selected: f.check === c.id }); }));
    var search = h('input', { type: 'search', placeholder: 'Search findings', value: f.q, 'aria-label': 'Search findings', oninput: function (e) {
      f.q = e.target.value; clearTimeout(search._t); search._t = setTimeout(function () { renderResults(); var s = document.querySelector('#findings input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 200);
    } });

    var body = h('tbody');
    var shown = items.slice(0, 500);
    shown.forEach(function (x) {
      var key = x.check + '|' + x.title + '|' + x.txIds.join(',');
      var open = S.open.has(key);
      var txs = x.txIds.map(function (id) { return r.txById.get(id); }).filter(Boolean);
      var expandable = txs.length || (x.rows && x.rows.length);
      var tr = h('tr', { class: expandable ? 'finding-row' : '', tabindex: expandable ? '0' : null, 'aria-expanded': expandable ? String(open) : null },
        h('td', null, h('span', { class: 'pill ' + x.severity, text: x.severity })),
        h('td', { class: 'hide-sm' }, h('span', { class: 'score-id', text: x.check })),
        h('td', null, h('div', { class: 'finding-title', text: masked(x.title) }), h('div', { class: 'finding-detail', text: masked(x.detail) }),
          expandable ? h('div', { class: 'expander', text: (open ? '▾ hide ' : '▸ show ') + (txs.length ? txs.length + ' transaction' + (txs.length > 1 ? 's' : '') : x.rows.length + ' row(s)') }) : null),
        h('td', { class: 'hide-sm', text: x.account ? masked(x.account) : '' }),
        h('td', { class: 'num hide-sm', text: x.date != null ? E.fmtDate(x.date) : '' }),
        h('td', { class: 'num', text: x.amount != null ? money(x.amount) : '' }));
      function toggle() { if (S.open.has(key)) S.open.delete(key); else S.open.add(key); renderResults(); }
      if (expandable) { tr.addEventListener('click', toggle); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }); }
      body.appendChild(tr);
      if (open && expandable) body.appendChild(h('tr', { class: 'tx-row' }, h('td', { colspan: '6' }, h('div', { class: 'tx-list' }, h('table', null, h('tbody', null,
        txs.length ? txs.map(function (t) {
          return h('tr', null, h('td', { class: 'num', text: E.fmtDate(t.date) }), h('td', { text: masked(t.account) }), h('td', { text: masked(t.description) }),
            h('td', { class: 'num' + (t.amount > 0 ? ' money-in' : ''), text: money(t.amount) }), h('td', { class: 'src', text: masked(S.files[t.file] ? S.files[t.file].name : '') + ':' + t.line }));
        }) : x.rows.slice(0, 50).map(function (rj) {
          return h('tr', null, h('td', { class: 'src', text: 'line ' + rj.line }), h('td', { text: rj.reason }), h('td', { text: masked(rj.raw) }));
        })))))));
    });

    var table = h('div', { class: 'table-scroll' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, h('th', null, 'Severity'), h('th', { class: 'hide-sm' }, 'Check'), h('th', null, 'Finding'), h('th', { class: 'hide-sm' }, 'Account'), h('th', { class: 'num hide-sm' }, 'Date'), h('th', { class: 'num' }, 'Amount'))),
      body));

    return h('section', { class: 'card', id: 'findings' },
      h('div', { class: 'section-head' }, h('h2', { text: 'Findings' }),
        h('button', { type: 'button', class: 'btn small ghost no-print', onclick: exportFindings, disabled: !r.findings.length }, 'Export findings CSV')),
      h('div', { class: 'filters' }, chips, checkSel, search),
      items.length ? table : h('p', { class: 'empty', text: r.findings.length ? 'No findings match these filters.' : 'No findings. Every check passed.' }),
      items.length > 500 ? h('p', { class: 'muted', text: 'Showing the first 500 of ' + items.length + '. Export to see all.' }) : null);
  }

  function recurringSection(r) {
    var subs = r.subscriptions;
    var rows = subs.map(function (s) {
      return h('tr', null,
        h('td', null, h('div', { class: 'finding-title', text: s.merchant }), h('div', { class: 'finding-detail', text: masked(s.description) })),
        h('td', { text: masked(s.account) }),
        h('td', { text: s.cadence }),
        h('td', { class: 'num', text: money(s.typical) }),
        h('td', { class: 'num', text: money(s.annual) }),
        h('td', { class: 'num', text: E.fmtDate(s.lastDate) }),
        h('td', null, h('span', { class: 'pill ' + (s.active ? 'pass' : 'n/a'), text: s.active ? 'active' : 'stopped' })));
    });
    return h('section', { class: 'card' },
      h('div', { class: 'section-head' }, h('h2', { text: 'Recurring charges' }),
        h('span', { class: 'muted', text: 'Fixed-amount charges on a regular cadence — subscriptions, bills, memberships.' })),
      subs.length ? h('div', { class: 'table-scroll' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, ['Merchant', 'Account', 'Cadence', 'Typical', 'Per year', 'Last charge', 'Status'].map(function (c, i) { return h('th', { class: i >= 3 && i <= 5 ? 'num' : '', text: c }); }))),
        h('tbody', null, rows))) : h('p', { class: 'empty', text: 'No recurring charges detected. Load at least three months of history.' }));
  }

  function budgetSection(r) {
    var cats = Object.keys(r.byCat).filter(function (c) { return c !== 'Transfer'; }).sort(function (a, b) {
      var sa = 0, sb = 0; r.months.forEach(function (m) { sa += r.byCat[a][m] || 0; sb += r.byCat[b][m] || 0; }); return sb - sa;
    });
    if (!cats.length) return h('div');
    var tol = S.opts.budgetTolerancePct / 100;
    var head = h('tr', null, h('th', null, 'Category'), r.months.map(function (m) { return h('th', { class: 'num', text: m }); }), h('th', { class: 'num' }, 'Budget'));
    var totals = r.months.map(function () { return 0; });
    var body = cats.map(function (cat) {
      var b = r.budget[cat];
      return h('tr', null, h('td', { text: cat }), r.months.map(function (m, i) {
        var v = r.byCat[cat][m] || 0; totals[i] += v;
        var cls = 'num';
        if (b > 0) cls += v > b * (1 + tol) ? ' cell-over' : v > b ? ' cell-near' : ' cell-under';
        return h('td', { class: cls, text: v ? money(v) : '—' });
      }), h('td', { class: 'num muted', text: b > 0 ? money(b) : '' }));
    });
    var foot = h('tr', null, h('td', null, h('strong', null, 'Total')), totals.map(function (v) { return h('td', { class: 'num' }, h('strong', null, money(v))); }),
      h('td', { class: 'num muted', text: Object.keys(r.budget).length ? money(Object.keys(r.budget).reduce(function (s, k) { return s + r.budget[k]; }, 0)) : '' }));
    var last = r.months[r.months.length - 1];
    return h('section', { class: 'card' },
      h('div', { class: 'section-head' }, h('h2', { text: 'Budget vs actual' }),
        h('span', { class: 'muted', text: 'Spending by month. Red = over budget beyond tolerance, amber = slightly over.' + (last ? ' ' + last + ' may be a partial month.' : '') })),
      h('div', { class: 'table-scroll' }, h('table', { class: 'grid' }, h('thead', null, head), h('tbody', null, body, foot))));
  }

  function exportFindings() {
    var r = S.result;
    var rows = [['severity', 'check', 'check_name', 'title', 'detail', 'account', 'date', 'amount', 'transactions']];
    var names = {}; E.CHECKS.forEach(function (c) { names[c.id] = c.name; });
    r.findings.forEach(function (f) {
      var txs = f.txIds.map(function (id) { var t = r.txById.get(id); return t ? E.fmtDate(t.date) + ' ' + masked(t.description) + ' ' + money(t.amount) : ''; }).join(' | ');
      rows.push([f.severity, f.check, names[f.check], masked(f.title), masked(f.detail), masked(f.account || ''), f.date != null ? E.fmtDate(f.date) : '', f.amount != null ? (f.amount / 100).toFixed(2) : '', txs]);
    });
    download('ledger-check-findings-' + E.fmtDate(Math.floor(Date.now() / E.DAY)) + '.csv', E.toCSV(rows));
  }

  // ----------------------------------------------------------- settings ----

  function syncSettings() {
    var asOf = S.opts.asOf != null ? S.opts.asOf : Math.floor(Date.now() / E.DAY);
    $('optAsOf').value = E.fmtDate(asOf);
    $('optNearDup').value = S.opts.nearDupDays;
    $('optTol').value = S.opts.budgetTolerancePct;
    $('optDrift').value = S.opts.baselineDriftPct;
    $('optZ').value = S.opts.outlierZ;
    $('optMask').checked = S.mask;
  }

  function num(el, lo, hi, dflt) { var v = parseFloat(el.value); if (!isFinite(v)) v = dflt; return Math.min(hi, Math.max(lo, v)); }

  function wire() {
    var drop = $('drop'), input = $('fileInput');
    input.addEventListener('change', function () { readFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); readFiles(e.dataTransfer.files); });
    // Stop a mis-aimed drop from navigating the tab to the file.
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    $('sampleBtn').addEventListener('click', loadSample);
    $('clearBtn').addEventListener('click', function () { clearAll(false); });

    $('suggestBudget').addEventListener('click', function () {
      if (!S.result) return;
      var sug = E.suggestBudget(S.result);
      Object.keys(sug).forEach(function (k) { if (S.budget[k] == null && k !== 'Income' && k !== 'Other Income') S.budget[k] = sug[k]; });
      S.budgetCats = ''; schedule();
    });
    $('clearBudget').addEventListener('click', function () { S.budget = {}; S.budgetCats = ''; schedule(); });
    $('exportBudget').addEventListener('click', function () {
      var rows = [['category', 'monthly_budget']];
      Object.keys(S.budget).sort().forEach(function (k) { rows.push([k, (S.budget[k] / 100).toFixed(2)]); });
      download('budget.csv', E.toCSV(rows));
    });
    $('budgetInput').addEventListener('change', function (e) { importBudget(e.target.files[0]); e.target.value = ''; });

    $('optAsOf').addEventListener('change', function (e) { var d = E.parseDate(e.target.value); S.opts.asOf = d; schedule(); });
    $('optNearDup').addEventListener('change', function (e) { S.opts.nearDupDays = num(e.target, 0, 14, 3); schedule(); });
    $('optTol').addEventListener('change', function (e) { S.opts.budgetTolerancePct = num(e.target, 0, 100, 10); schedule(); });
    $('optDrift').addEventListener('change', function (e) { S.opts.baselineDriftPct = num(e.target, 5, 500, 30); schedule(); });
    $('optZ').addEventListener('change', function (e) { S.opts.outlierZ = num(e.target, 2, 10, 3.5); schedule(); });
    $('optMask').addEventListener('change', function (e) { S.mask = e.target.checked; if (S.result) renderResults(); });

    syncSettings();
  }

  wire();
})();
