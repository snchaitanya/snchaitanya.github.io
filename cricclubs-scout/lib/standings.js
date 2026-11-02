// Turn a captured points table and playoff summary into the JSON the site reads.
function buildStandingsDoc(pointsTable, playoffs) {
  const found = !!(playoffs && playoffs.playoffsFound);
  const pending = !!(playoffs && playoffs.fixturesPending);
  const outcomes = (playoffs && playoffs.teams) || {};
  const teams = {};
  const logos = {};
  for (const g of (pointsTable && pointsTable.groups) || []) {
    const rows = g.rows || [];
    for (const row of rows) {
      const prev = teams[row.team];
      if (prev && (prev.played > row.played || (prev.played === row.played && prev.position <= row.position))) continue;
      if (row.logo) logos[row.team] = row.logo;
      let playoff = null;
      const oc = outcomes[row.team];
      if (oc && oc.result) playoff = { text: oc.result, muted: false };
      else if (found && !pending) playoff = { text: 'Did not qualify', muted: true };
      teams[row.team] = {
        position: row.position,
        of: rows.length,
        group: g.group || '',
        played: row.played,
        won: row.won,
        lost: row.lost,
        nr: row.nr,
        points: row.points,
        nrr: row.nrr,
        logo: row.logo || null,
        playoff
      };
    }
  }
  return {
    series: pointsTable.series,
    playoffs: { found, pending },
    teams,
    logos
  };
}

module.exports = { buildStandingsDoc };
