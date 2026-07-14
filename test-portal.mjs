import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const html = read("index.html");
const app = read("app.js");
const css = read("styles.css");
const sw = read("sw.js");
const manifest = JSON.parse(read("manifest.webmanifest"));

const urls = {
  portal: "https://weigenwu.github.io/ikun-calculator/",
  wb: "https://weigenwu.github.io/wb/#studio",
  ifihc: "https://if-group-pictures.onrender.com/"
};

for (const url of Object.values(urls)) {
  assert.ok(html.includes(`href="${url}"`), `缺少套件入口：${url}`);
}
assert.ok(!html.includes('target="_blank"'), "跨站入口必须在当前标签页打开");
assert.match(html, /class="suite-nav"[\s\S]*?>实验流程<[\s\S]*?>WB<[\s\S]*?>IF \/ IHC</);

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML 中存在重复 id");

const panels = new Map(
  [...html.matchAll(/<section\s+id="([^"]+)"[^>]*\sdata-panel="([^"]+)"[^>]*>/g)]
    .map((match) => [match[2], match[1]])
);
const tabs = [...html.matchAll(/<button\s+class="tab-button[^"]*"[^>]*\sdata-tab="([^"]+)"[^>]*\saria-controls="([^"]+)"[^>]*>/g)];
assert.equal(tabs.length, 10, "顶级模块应为 10 个");
for (const [, tab, controlledId] of tabs) {
  assert.equal(panels.get(tab), controlledId, `标签 ${tab} 没有映射到对应面板`);
}
assert.equal(panels.size, tabs.length, "顶级标签和面板数量不一致");

const workflowTools = [...html.matchAll(/<button\s+class="workflow-card"[^>]*data-workbench-tab="([^"]+)"/g)].map((match) => match[1]);
assert.equal(workflowTools.length, 10, "实验流程首页应覆盖全部 10 个顶级计算模块");
assert.deepEqual(new Set(workflowTools), new Set(tabs.map((match) => match[1])), "流程入口与顶级模块不一致");
assert.match(html, /class="workflow-card external"[^>]*href="https:\/\/weigenwu\.github\.io\/wb\/#studio"/);
assert.match(html, /class="workflow-card external remote"[^>]*href="https:\/\/if-group-pictures\.onrender\.com\/"/);

const qpcrModes = new Map(
  [...html.matchAll(/<section\s+id="([^"]+)"[^>]*data-qpcr-mode="([^"]+)"[^>]*>/g)]
    .map((match) => [match[2], match[1]])
);
const qpcrModeTabs = [...html.matchAll(/<button\s+class="qpcr-mode-button[^"]*"[^>]*data-qpcr-mode-target="([^"]+)"[^>]*aria-controls="([^"]+)"[^>]*>/g)];
assert.deepEqual([...qpcrModes.keys()], ["rt", "mastermix", "qpcrdata", "qmulti"]);
assert.equal(qpcrModeTabs.length, 4, "qPCR 全流程应保留四个模式");
for (const [, mode, controlledId] of qpcrModeTabs) {
  assert.equal(qpcrModes.get(mode), controlledId, `qPCR 模式 ${mode} 映射错误`);
}
for (const oldPanel of ["panel-mastermix", "panel-qpcrdata", "panel-qmulti"]) {
  assert.ok(!html.includes(`id="${oldPanel}"`), `${oldPanel} 不应继续作为顶级面板`);
}
assert.match(app, /legacyQpcrMode = \{ qpcr: "rt", mastermix: "mastermix", qpcrdata: "qpcrdata", qmulti: "qmulti" \}\[initialTab\]/);
assert.match(app, /revealPanel = \(name\)[\s\S]*?scrollIntoView\(\{ block: "start" \}\)/);
assert.match(app, /function migrateQpcrDrafts\(\)[\s\S]*?legacyNames = \["mastermix", "qpcrdata", "qmulti"\][\s\S]*?Object\.assign\(merged, current\)[\s\S]*?localStorage\.setItem\(panelDraftKey\("qpcr"\)/);

assert.ok(!html.includes('id="panel-wbdensity"'), "旧 WB 灰度面板必须移除");
assert.ok(!html.includes("wbg-"), "HTML 仍有旧 WB 控件");
assert.ok(!app.includes("wbg"), "JavaScript 仍有旧 WB 状态或解析代码");
assert.ok(!css.includes("wbg-") && !css.includes("roi-kind-"), "CSS 仍有旧 WB 专用样式");
assert.match(app, /initialTab === "wbdensity"[\s\S]*?location\.replace\(WB_WORKSPACE_URL\)/);
assert.match(html, /蛋白定量与上样/);
assert.ok(!html.includes("BCA/WB"), "旧 BCA/WB 命名仍然存在");

assert.equal(manifest.name, "实验室一体化工作台");
assert.equal(manifest.start_url, "./index.html");
assert.equal(manifest.scope, "./");
assert.match(manifest.description, /实验流程.*WB.*IF\/IHC/);

const appVersion = app.match(/const APP_VERSION = "(v\d+)";/)?.[1];
const cacheVersion = sw.match(/CACHE_NAME = "[^"]+-(v\d+)";/)?.[1];
assert.equal(appVersion, "v24");
assert.equal(cacheVersion, appVersion, "应用版本与 Service Worker 缓存版本不一致");
for (const asset of ["./index.html", "./styles.css", "./app.js", "./manifest.webmanifest"]) {
  assert.ok(sw.includes(`"${asset}"`), `Service Worker 缺少缓存资源：${asset}`);
}

assert.match(html, /数据边界/);
console.log(`Portal checks passed: ${ids.length} unique IDs, ${tabs.length} top-level modules, ${qpcrModeTabs.length} qPCR modes.`);
