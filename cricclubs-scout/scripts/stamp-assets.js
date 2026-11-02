// Pages deploys replace __ASSET_VERSION__ with the commit SHA so browsers fetch the new JS and CSS.
const fs = require('fs');
const path = require('path');
const sha = String(process.env.GITHUB_SHA || process.argv[2] || 'dev').slice(0, 7);
const root = path.join(__dirname, '..');
for (const rel of ['site/index.html', 'site/sw.js']) {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('__ASSET_VERSION__')) continue;
  fs.writeFileSync(file, text.split('__ASSET_VERSION__').join(sha));
  console.error('stamped', rel, sha);
}
