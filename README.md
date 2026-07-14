# 实验室工作台

统一入口按实验流程组织三个站点：

- 实验流程：<https://weigenwu.github.io/ikun-calculator/>
- WB：<https://weigenwu.github.io/wb/#studio>
- IF / IHC：<https://if-group-pictures.onrender.com/>

## 功能结构

本页保留 10 个顶级计算模块：细胞计数、铺板、药物梯度、慢病毒、活性/ADCC、IC50、ELISA、蛋白定量与上样、qPCR 全流程和流式统计。

qPCR 全流程内部包含四个原有步骤：RT 与上机简算、精确 Master Mix、快速结果分析、孔板/多基因增强。旧的 `#mastermix`、`#qpcrdata`、`#qmulti` 深链会打开对应步骤；旧的 `#wbdensity` 会直接迁移到新版 WB 工作台。

旧 WB 灰度模块已经从本仓库移除，TIFF、ROI、条带组图、灰度定量和 Prism 导出统一由 WB 站点提供。BCA 标准曲线与上样体积仍保留在“蛋白定量与上样”中；ELISA 标准曲线处理的是不同实验输入，因此继续独立保留。

## 数据边界

实验流程与 WB 在浏览器本地处理数据；IF / IHC 会把用户选择的图片上传到处理服务器。上传前请移除姓名、编号等敏感信息。原始实验数据不应提交到本仓库。

## 本地启动

```powershell
python -m http.server 8000
```

然后打开 <http://localhost:8000/>。通过 HTTP 服务才能完整验证 PWA 行为。

## 检查

```powershell
node test-portal.mjs
node test-portal-e2e.cjs
node --check app.js
node --check sw.js
```

静态检查覆盖唯一 ID、10 个顶级标签与面板、qPCR 四模式及旧深链、WB 迁移、草稿键迁移、同标签页跨站导航、Manifest 与 Service Worker 版本。浏览器检查使用 Edge 验证四个 qPCR 步骤、旧草稿迁移、深链可见性和 390 px 手机布局；需要本机可用的 Playwright 与 Edge。
