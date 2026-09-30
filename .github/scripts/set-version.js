// Usage: node set-version.js <path to app.json> <version>
const fs = require('fs');
const [file, version] = process.argv.slice(2);
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
json.expo.version = version;
fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
