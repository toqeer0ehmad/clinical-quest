// Points the game at your domain.
//   npm run set-domain -- clinicalquest.com
// Updates wrangler.jsonc (custom domain + APP_ORIGIN) and the social-share
// image link in public/index.html. Safe to run again with a different domain.
import { readFile, writeFile } from "node:fs/promises";

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: npm run set-domain -- yourdomain.com");
  process.exit(1);
}
const host = raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) {
  console.error(`"${raw}" doesn't look like a domain. Example: npm run set-domain -- clinicalquest.com`);
  process.exit(1);
}
const origin = `https://${host}`;

let w = await readFile("wrangler.jsonc", "utf8");
const routes = `"routes": [{ "pattern": "${host}", "custom_domain": true }],`;
if (/^\s*(\/\/\s*)?"routes":.*$/m.test(w)) {
  w = w.replace(/^(\s*)(\/\/\s*)?"routes":.*$/m, `$1${routes}`);
} else {
  w = w.replace(/("compatibility_flags":[^\n]*\n)/, `$1  ${routes}\n`);
}
w = w.replace(/"APP_ORIGIN":\s*"[^"]*"/, `"APP_ORIGIN": "${origin}"`);
await writeFile("wrangler.jsonc", w);

let h = await readFile("public/index.html", "utf8");
h = h.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${origin}/clinical-quest_og.png$2`);
await writeFile("public/index.html", h);

console.log(`Domain set to ${host}. Next: npm run deploy`);
