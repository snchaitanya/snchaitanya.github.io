// Copy scan-result.json onto GITHUB_OUTPUT for the comment job. The delimiter is random
// and the comment is produced by our code, not by raw issue text.
const fs = require('fs');
const crypto = require('crypto');

const file = process.env.GITHUB_OUTPUT;
let result;
try {
  result = JSON.parse(fs.readFileSync('scan-result.json', 'utf8'));
} catch {
  result = {
    ok: false,
    close: false,
    comment: '<!-- scout-handled -->\n**Scan request failed.**\n\nThe scraper stopped before it could write a result. Check the Actions log, then remove and re-add the `scan-request` label to retry.\n'
  };
}
const delim = 'SCOUT_' + crypto.randomBytes(8).toString('hex');
const comment = String(result.comment || 'Scan request failed.');
if (comment.includes(delim)) throw new Error('comment delimiter collision');
const body = [
  `ok=${result.ok ? 'true' : 'false'}`,
  `close=${result.close === false ? 'false' : 'true'}`,
  `comment<<${delim}`,
  comment,
  delim
].join('\n') + '\n';
if (file) fs.appendFileSync(file, body);
else process.stdout.write(body);
