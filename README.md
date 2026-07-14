# 实验室一体化工作台

统一入口连接三个实验工具：

- 实验计算器：<https://weigenwu.github.io/ikun-calculator/>
- WB 组图与灰度：<https://weigenwu.github.io/wb/#studio>
- IF / IHC 组图：<https://if-group-pictures.onrender.com/>

## 数据边界

实验计算器和 WB 工具在浏览器本地处理数据；IF / IHC 工具需要把用户选中的图片上传到服务器。上传前请移除姓名、编号等敏感信息。原始实验数据不应提交到本仓库。

## 本地启动

```powershell
python -m http.server 8000
```

然后打开 <http://localhost:8000/>。不要直接双击 `index.html`，HTTP 服务才能完整验证 PWA 行为。

## 静态检查

```powershell
node test-portal.mjs
```

检查覆盖统一入口链接、HTML 唯一 ID、标签页和面板映射、Manifest 字段、应用版本及 Service Worker 缓存清单。

## 部署

仓库由 GitHub Pages 托管；推送到发布分支后等待 Pages 构建完成，再用无痕窗口确认三个入口和离线缓存。
