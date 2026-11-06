# Money Agent

A daily agent that searches the web for real ways for you to earn money, gives
you ready-to-send drafts, and gets better each day by learning from what paid.

## What it does every morning

1. **Reads its memory**: `memory/profile.md` (who you are, your limits),
   `memory/strategy.md` (its current plan), `memory/learnings.md`,
   `memory/feedback.md` (your notes) and `memory/ledger.csv` (what you earned).
2. **Researches**: Claude searches the web and opens listings (bounties,
   freelance gigs, expert networks, paid writing, AI-evaluation work, ways to
   make money from Cric Scout and your site). It only reports listings it
   checked, with the link, the pay, the time needed and a draft you can paste.
3. **Learns**: it rewrites `memory/strategy.md` and adds to
   `memory/learnings.md`, so tomorrow's search is better.
4. **Tells you**: saves `reports/YYYY-MM-DD.md` and opens a GitHub issue with
   the report, so you get an email.

It does **not** spend money, create accounts, send messages, or trade. It finds
and prepares; you choose and click submit. That keeps your accounts and
reputation safe.

## Setup (5 minutes)

1. Get an API key at https://console.anthropic.com (Settings > API keys) and
   add some credit.
2. In this repository on GitHub: **Settings > Secrets and variables > Actions >
   New repository secret**. Name: `ANTHROPIC_API_KEY`, value: your key.
3. **Settings > Actions > General > Workflow permissions**: choose **Read and
   write permissions**.
4. Edit `memory/profile.md` so it is correct (location, time per day, any
   employer or visa limits).
5. Run it once by hand: **Actions > Money Agent > Run workflow**. After that it
   runs every day at 14:23 UTC.

## Your part (2 minutes a day): this is what makes it learn

- When you earn money, add a line to `memory/ledger.csv`:
  `2026-11-12,algora bounty,50,2,fixed a CSV parser bug`
- When you try something, add a line to `memory/feedback.md`, whether it
  worked or not ("applied, no reply", "already claimed", "don't suggest X").

You can edit both files on github.com from your phone. Without this feedback
the agent can only guess what works.

## Cost

Each run costs roughly $0.50 to $2 in API usage (tokens plus about $0.01 per
web search), so about $15 to $60 a month. Ways to lower it, set as repository
variables or in the workflow `env`:

- `AGENT_EFFORT=medium` (default `high`)
- `AGENT_MAX_SEARCHES=10`, `AGENT_MAX_FETCHES=8`
- `AGENT_MODEL=claude-sonnet-5-5` (cheaper model)
- Run every other day by changing the `cron` line.

## Privacy

This repository is public. The reports, your ledger and the daily issues can be
seen by anyone. `_config.yml` keeps these files off your website, but they are
still visible on GitHub. To keep them private, copy the `money-agent/` folder
and `.github/workflows/money-agent.yml` into a **private** repository and
follow the same setup there. Nothing else needs to change.

## Run locally

```bash
pip install -r money-agent/requirements.txt
export ANTHROPIC_API_KEY=...
python money-agent/agent.py
```
