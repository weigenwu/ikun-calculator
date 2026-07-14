import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const html = read("index.html");
const app = read("app.js");
const sw = read("sw.js");
const manifest = JSON.parse(read("manifest.webmanifest"));

const canonicalUrls = [
  "https://weigenwu.github.io/ikun-calculator/",
  "https://weigenwu.github.io/wb/#studio",
  "https://if-group-pictures.onrender.com/"
];

for (const url of canonicalUrls) {
  assert.ok(html.includes(`href="${url}"`), `缺少统一入口：${url}`);
}

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML 中存在重复 id");

const panels = new Map(
  [...html.matchAll(/<section\s+id="([^"]+)"[^>]*\sdata-panel="([^"]+)"[^>]*>/g)]
    .map((match) => [match[2], match[1]])
);
const tabs = [...html.matchAll(/<button\s+class="tab-button[^"]*"[^>]*\sdata-tab="([^"]+)"[^>]*\saria-controls="([^"]+)"[^>]*>/g)];
assert.ok(tabs.length > 0, "没有找到标签页按钮");
for (const [, tab, controlledId] of tabs) {
  assert.equal(panels.get(tab), controlledId, `标签页 ${tab} 没有映射到对应面板`);
}
assert.equal(panels.size, tabs.length, "标签页和面板数量不一致");

assert.equal(manifest.name, "实验室一体化工作台");
assert.equal(manifest.start_url, "./index.html");
assert.equal(manifest.scope, "./");
assert.match(manifest.description, /WB.*IF\/IHC/);

const appVersion = app.match(/const APP_VERSION = "(v\d+)";/)?.[1];
const cacheVersion = sw.match(/CACHE_NAME = "[^"]+-(v\d+)";/)?.[1];
assert.ok(appVersion, "app.js 缺少 APP_VERSION");
assert.equal(cacheVersion, appVersion, "应用版本与 Service Worker 缓存版本不一致");
for (const asset of ["./index.html", "./styles.css", "./app.js", "./manifest.webmanifest"]) {
  assert.ok(sw.includes(`"${asset}"`), `Service Worker 缺少缓存资源：${asset}`);
}

assert.match(html, /id="panel-wbdensity"[\s\S]*?打开新版 WB 工作台/);
assert.match(html, /数据边界/);

console.log(`Portal checks passed: ${ids.length} unique IDs, ${tabs.length} tab-panel mappings.`);
