(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var daySel = $("day");

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ago(iso) {
    if (!iso) return "";
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!isFinite(mins) || mins < 0) return "";
    if (mins < 60) return mins + "m ago";
    var h = Math.round(mins / 60);
    return h < 48 ? h + "h ago" : Math.round(h / 24) + "d ago";
  }

  function card(section) {
    var c = el("section", "card");
    c.style.setProperty("--c", "var(--" + section.id + ")");
    c.appendChild(el("h3", null, section.title));
    if (!section.items.length) {
      c.appendChild(el("p", "empty", "No headlines available right now."));
      return c;
    }
    var ol = el("ol");
    section.items.forEach(function (it) {
      var li = el("li");
      var body = el("div");
      var a = el("a", null, it.title);
      a.href = it.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      body.appendChild(a);
      var meta = [it.source, ago(it.published)].filter(Boolean).join(" · ");
      if (meta) body.appendChild(el("span", "src", meta));
      if (it.summary) body.appendChild(el("p", "sum", it.summary));
      li.appendChild(body);
      ol.appendChild(li);
    });
    c.appendChild(ol);
    return c;
  }

  function render(report) {
    var byId = {};
    report.sections.forEach(function (s) { byId[s.id] = s; });

    var d = new Date(report.date + "T12:00:00");
    $("dateline").textContent = d.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });
    var gen = new Date(report.generated_at);
    $("updated").textContent = "Updated " + gen.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
    });

    ["g-top", "g-mid", "g-pop"].forEach(function (gid) {
      var g = $(gid);
      g.textContent = "";
      g.getAttribute("data-sections").split(" ").forEach(function (sid) {
        if (byId[sid]) g.appendChild(card(byId[sid]));
      });
    });
  }

  function load(file) {
    $("msg").hidden = true;
    return fetch("data/" + file + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(render)
      .catch(function () {
        $("msg").textContent = "Couldn't load this report. It may not have been generated yet.";
        $("msg").hidden = false;
        $("updated").textContent = "";
      });
  }

  fetch("data/index.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : { days: [] }; })
    .catch(function () { return { days: [] }; })
    .then(function (idx) {
      var latest = el("option", null, "Latest");
      latest.value = "latest";
      daySel.appendChild(latest);
      (idx.days || []).forEach(function (day) {
        var o = el("option", null, new Date(day + "T12:00:00").toLocaleDateString(undefined, {
          weekday: "short", month: "short", day: "numeric"
        }));
        o.value = day;
        daySel.appendChild(o);
      });
    });

  daySel.addEventListener("change", function () {
    load(daySel.value === "latest" ? "latest.json" : daySel.value + ".json");
  });

  load("latest.json");
})();
