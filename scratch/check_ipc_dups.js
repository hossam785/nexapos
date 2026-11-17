const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(path.join(__dirname, '../electron/ipc/registerDbHandlers.js'), 'utf8');
const routes = require(path.join(__dirname, '../electron/local-api/routeManifest.js')).LOCAL_API_ROUTES.map(r => r.channel);

const matches = Array.from(content.matchAll(/handleMeasured\(['"]([^'"]+)['"]/g)).map(m => m[1]);
const duplicatesWithLocalApi = matches.filter(ch => routes.includes(ch));
console.log('Duplicates with LocalApi routes:', duplicatesWithLocalApi);

const seen = new Set();
const internalDups = [];
for (const ch of matches) {
  if (seen.has(ch)) internalDups.push(ch);
  seen.add(ch);
}
console.log('Internal duplicates in handleMeasured:', internalDups);
