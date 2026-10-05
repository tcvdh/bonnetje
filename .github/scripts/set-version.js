// Usage: node set-version.js <path to app.json> <version>
const fs = require('fs');
const [file, version] = process.argv.slice(2);
// The app compares versions as X.Y.Z (utils/version.ts); anything else would never lock or nag an install.
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error(`Version must look like 1.2.3, got "${version}"`);
  process.exit(1);
}
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
json.expo.version = version;
fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
