# Cric Scout

Free [CricClubs](https://cricclubs.com) team scouting site. The pages are static JSON on GitHub Pages. A GitHub Actions workflow runs the scraper (headless Chrome) and commits the cache back to `main`.

Site: <https://kunal1985.github.io/cricclubs-scout/>

There is no server to host. Plain fetches of CricClubs get a Cloudflare 403, and the JSON API expects headers the site itself adds, so the scraper opens the public pages in Chrome and keeps the responses the page already requested.

## How it works

```text
site/                  GitHub Pages (relative URLs, works under /cricclubs-scout/)
  data/index.json      cached leagues for the dropdown
  data/leagues/<code>/league.json
  data/leagues/<code>/teams/<slug>.json
  data/leagues/<code>/standings/<season>.json
data/store/            scraper cache committed to the repo (scorecards included)
  leagues/<code>/league.json    league id, current + last season, team ids
  leagues/<code>/teams/         normalized matches, including dismissals
  leagues/<code>/scorecards/    raw scorecards, reused across teams
```

Each published team file includes a logo URL when the points table has one (`https://media.cricclubs.com/...`). The standings card uses the current season for Last 5 and the current season view, the previous season for Last season, and both when Both seasons is selected. A playoff line appears only after that season's playoffs have a result.

The browser ranks players from the published team JSON. Ranking rules are the same as the previous app: batters need 3 innings and 30 balls (2 and 15 for the last 5) and sort by runs × strike rate ÷ 100; bowlers need 6 overs (2 for the last 5) and sort by wickets, then economy. Fielding is parsed from opponent dismissal text when the JSON is published.

Seasons are the two series that have already started, ordered by start date (`MM/DD/YYYY`), using today's date in `America/Los_Angeles`. The newer one is current. The older one is last.

A team scan fetches the current-season match list and downloads scorecards only for match ids that are not already stored. The last season is scanned once and then left alone. The Monday job refreshes each cached league, then repeats that current-season incremental scan for every team that already has a file under `data/store/.../teams/`.

## Using the site

1. Pick a league from the dropdown. The list is `site/data/index.json`.
2. Or type a league code or `cricclubs.com` URL in **Add league**. If that league is not cached, the page shows **Coming Soon!**.
3. Pick a team. A scanned team renders the report and shows **data as of** the latest scrape time. A team with no file shows **Coming Soon!**.

## Workflows

| Workflow | When | What |
| --- | --- | --- |
| `pages.yml` | Push to `main` that changes `site/`, or manual | Deploy `site/` to GitHub Pages |
| `scan.yml` | Mondays 10:00 UTC | Rescan current seasons of every cached team, commit, deploy |
| `scan.yml` | **Actions → Scan → Run workflow** | Inputs: league, and team (team empty = refresh the league only) |
| `scan.yml` | Issue opened or labeled `scan-request` | Validate, scan, comment the result and site link, close the issue |
| `labels.yml` | Push of this file to `main`, or manual | Create the `scan-request` label |

Invalid league or team text gets an error comment and the issue is closed. The scraper is only started as `node cli.js run`. League and team reach it through environment variables after `prepare.js` checks the characters. A team must match a name in the current or last season exactly (case-insensitive). The workflow does not put issue text in a shell command.

`scan.yml` uses one concurrency group, `scout-data`, so two runs cannot commit at the same time. A second `opened`/`labeled` pair for the same issue is ignored once this run has already commented. A failed scrape comments and leaves the issue open; remove the label and add it again to retry.

Token permissions, per job, and nothing broader:

- Pages deploy: `contents: read`, `pages: write`, `id-token: write`
- Scan and commit: `contents: write`, `pages: write`, `id-token: write`
- Issue comment: `issues: write`
- Prepare: `contents: read`, `issues: read`
- Label setup: `issues: write`

Pushes made with `GITHUB_TOKEN` do not start another workflow, so the scan workflow deploys Pages itself after it commits. A normal push to `main` still runs `pages.yml`.

## One-time setup

After this is merged to `main`:

1. **Settings → Actions → General → Workflow permissions → Read and write permissions.** Job-level `contents: write` cannot exceed this. Without it, scans cannot commit and the label workflow cannot create `scan-request`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** The expected URL is <https://kunal1985.github.io/cricclubs-scout/>.
3. If the `github-pages` environment asks for approval, approve the deployment from the default branch.
4. If `main` is protected, allow `github-actions[bot]` to push data commits (or the scan workflow will fail at `git push`).
5. Run **Actions → Ensure labels** once if the first push did not create `scan-request`. The issue form only applies labels that already exist.

## Local commands

Requires Node 22+ and Chrome (`CHROME_PATH` if it is not on the default path).

```bash
npm ci
node cli.js publish
node cli.js league DublinandDanvilleCricketLeague
node cli.js scan DublinandDanvilleCricketLeague "Bay Area Falcons"
node cli.js weekly
npm test
```

`publish` rebuilds `site/data` from `data/store` without using Chrome. Serve `site/` with any static file server and open it from that directory so the relative `data/` URLs resolve. A path prefix such as `/cricclubs-scout/` works the same way, because nothing is rooted at `/`.

CricClubs sits behind Cloudflare. The scraper is a real Chrome session because a plain HTTP client is rejected. If the runner is shown the "Just a moment" check and it does not clear, the scan exits with that error and leaves the last good JSON in place. Re-run the workflow later. The Dublin and Danville cache shipped with this repo is enough for the site to render those teams before the first successful Actions scan.
