# W3 实验手册：Web 与瓦片渲染原理

> 对应《WebGIS 12 周学习计划》W3。建议时间：2026-10-20 ~ 2026-10-26（每天 1.5~2 h）。
> 环境前提：Chrome/Edge（DevTools 熟练打开 Network 面板）、Node.js（跑 `webgis-starter`，用 **npm** 不用 pnpm——W0 坑 #1）、VS Code。
> 纪律提醒：README 进度表里 W2 还没打勾。**先按 [W2 手册](W2-空间数据格式与转换-实验手册.md) 通关 W2 再进本周**——W4 要直接消费 W2 的 `guangzhou_slim.geojson`。
> 承接 W1：瓦片公式你已经在 [coord.mjs](../projects/coordinate-lab/coord.mjs) 里写完了（`tileXY` / `tileBounds`，还带手算校验）。本周不是学新数学，是把它变成网页、看懂浏览器在背后干了什么。

---

## 0. 本周要建立的三个认知

| # | 认知 | 为什么重要 |
| --- | --- | --- |
| 1 | **Web 地图就是一堆按 z/x/y 编号贴出来的 `<img>`** | OpenLayers / MapLibre 只是自动帮你算视野、调度金字塔、拼接瓦片。自己手写一次 URL，"地图库"的魔法就祛魅了——这是 W4 的地基 |
| 2 | **缓存和 CORS 是两件互不相干的事** | 缓存决定"要不要重新发请求"（Network 里的 304 / from disk cache）；CORS 决定"浏览器允不允许 JS **读**响应"（控制台里的 CORS error）。混淆这两者的人，排错时会到处乱撞 |
| 3 | **OGC 服务的区别在于"给你什么"** | WMS 给渲染好的图、WMTS 给预切好的瓦片、WFS 给数据本身、MVT 给按瓦片切好的几何。选型 = 在前端职责与后端成本之间做取舍，W8 会真的用到 |

---

## 1. 学（约 4 小时，周一到周三分散进行）

### 1.1 HTML/CSS/JS 最小必要集（1 h）

> **学完你能做什么**：能用纯 HTML + 一个 JS 文件做出"输入经纬度 → 点按钮 → 屏幕上出现一张瓦片"的页面，并且知道每一行代码是干什么的。

只学这四样，够本周用，**不要顺手展开成"系统学前端"**：

- **DOM**：`document.getElementById` / `createElement` / `appendChild`，`img.src = ...`
- **事件**：`addEventListener('click', ...)`、表单 `submit` 时 `e.preventDefault()`
- **ES 模块**：`import` / `export` + `<script type="module">`（对照 [src/main.js](../projects/webgis-starter/src/main.js) 是怎么把模块接起来的）
- **fetch**：`fetch(url)` → `res.ok` / `res.status` → `res.blob()` / `res.json()`

四件套逐一过一遍：

**① DOM（文档对象模型）**
- **定义**：浏览器把 HTML 解析成的一棵"对象树"，JS 通过它读写页面上的任何元素。
- **类比**：HTML 是盖好的房子，DOM 是房子的"遥控器"——`getElementById` 是点名找某个房间，`img.src = ...` 是按遥控器换电视频道。
- **最小示例**【浏览器 DevTools→Console，任意网页上敲】：
  ```js
  document.title = '我在操控这个页面';   // 看浏览器标签页标题变了
  document.body.children.length           // 返回一个数字，如 3
  ```
  预期输出：标签页标题立刻变化；第二行返回数字。**失败时**：`Cannot set properties of null` 说明你 `getElementById` 找的 id 不存在（拼写错误或脚本执行时元素还没加载）。
- **常见误区**：① 以为改了 JS 变量页面就会变——不会，必须操作 DOM；② `getElementById` 不加 `#`（那是 `querySelector` 的写法）。

**② 事件（addEventListener）**
- **定义**：给元素挂一个"当……发生时执行这段代码"的规则。
- **类比**：门铃——你不在门口盯着，按了（click）才响。
- **最小示例**【浏览器 DevTools→Console】：
  ```js
  document.body.addEventListener('click', () => console.log('点到了'));
  ```
  预期输出：之后每次点击页面，Console 打一行"点到了"。
- **常见误区**：① 写成 `addEventListener('click', fn())`——带括号是**立刻执行**，要去掉括号传函数本身；② 忘记 `e.preventDefault()`，表单 submit 会刷新页面，你的 JS 状态全丢。

**③ ES 模块（import/export）**
- **定义**：把 JS 拆成多个文件、互相 `import` 使用的官方机制；浏览器只认 `<script type="module">` 入口。
- **类比**：乐高分包——每袋零件（文件）只倒出你 `import` 的那几块。
- **最小示例**【VS Code，看真实代码】：打开 [main.js](../projects/webgis-starter/src/main.js) 第 12~13 行 `import {createMap} from './map.js'`，再打开 [map.js](../projects/webgis-starter/src/map.js) 第 86 行 `export async function createMap(...)`——一头一尾对上了，这就是模块接线。
- **常见误区**：① 路径漏写 `./`（`import './map.js'` 才对，`'map.js'` 会被当成 npm 包）；② 双击 html 用 `file://` 打开——ES module 会报 CORS 错（坑 P8），必须起本地服务。

**④ fetch（网络请求）**
- **定义**：浏览器提供的"JS 主动发 HTTP 请求并读响应"的函数，返回 Promise。
- **类比**：`img.src` 是"把外卖电话贴在冰箱上，送来就吃"；`fetch` 是"自己打电话、等餐、开箱验货"——能看小票（status / headers），但规矩多（CORS）。
- **最小示例**【浏览器 DevTools→Console，在 <http://127.0.0.1:5173> 页面里敲】：
  ```js
  const r = await fetch('/data/sample-points.geojson');
  r.status            // 预期：200
  (await r.json()).features.length   // 预期：一个数字
  ```
  **失败时**：`Unexpected token '<'` 多半是你 fetch 了一个不存在的路径，服务器返回了 404 的 HTML 页面，`r.json()` 解析失败——先用 `r.status` 和 `r.url` 确认拿到的是什么。
- **常见误区**：① 忘了 `await`，拿到的是 Promise 不是结果；② HTTP 404 时 fetch **不抛异常**，要自己判 `res.ok`。

学习方式：**先花 20 分钟读 `webgis-starter` 的 `index.html` + `main.js` 开头，再自己从零写**（练习 1）。读是读不会的，写才会。

### 1.2 HTTP 与缓存（0.5 h）

> **学完你能做什么**：打开 Network 面板，能说出每条瓦片请求是真发了还是缓存命中，并知道去哪一列找证据。

- **定义**：浏览器和服务器之间"一问一答"的协议；缓存是浏览器把答案复印下来、下次先翻复印件。
- **类比**：缓存像便利贴——问过一次的问题写在便利贴上贴桌上，下次先看桌上有没有（`from disk cache`）；便利贴上写着有效期（`Cache-Control`）；过期了就打电话问"变了没"，没变就继续用（`304`）。
- 状态码：`200` 真请求了 / `304` 问过了没变化 / `404` 编号写错或超 maxZoom / `429` 被限流（OSM 对脚本刷瓦片会给你这个）
- 关键响应头：`Cache-Control`、`ETag`、`Access-Control-Allow-Origin`（在 DevTools → Network → 点任意瓦片请求 → Headers 里逐个找到它们，**截图进笔记**）
- **最小示例（缓存对比实验）**【浏览器 DevTools→Network】：
  1. 打开 <http://127.0.0.1:5173>，F12 → Network → 筛选框输入 `png`；
  2. 刷新页面，看 Size 列：大部分是数字（如 `23.4 kB`）；
  3. 再刷新一次（不关面板）：这次 Size 列出现 `(disk cache)` / `(memory cache)`；
  4. 勾上面板顶部的 **Disable cache**，再刷新：全部变回真实字节数。
  - **预期输出**：第 3 步几乎不耗流量、加载明显快；第 4 步回到"每张图都真下载"。
  - **失败时**：看不到 `(disk cache)`——检查是否勾了 Disable cache，或用了无痕窗口（无痕默认不存缓存）。
- **常见误区**：① 以为 `304` 是"没请求"——其实发了一个很小的询问请求，只是没下载图片本体；② 以为清缓存要重启浏览器——Network 面板右键 → Clear browser cache 即可。
- 结论：地图拖动"丝滑"的一半原因是缓存，不是网络快。

### 1.3 CORS（1 h，本周最容易"啊？"的点）

> **学完你能做什么**：看到 Console 里红色的 CORS 报错，能立刻说出"该找谁、有哪两条解法"，并且能解释为什么 `<img>` 能显示的图 `fetch` 读不到。

- 同源策略：协议 / 域名 / 端口任一不同即跨域；简单请求直接发，复杂请求先发 `OPTIONS` 预检。
- **关键区分**：`<img src="跨域URL">` 显示图片**不受** CORS 限制；`fetch` 要读响应体**受** CORS 限制。所以"图能看到" ≠ "fetch 能拿到"——练习 1 会让你亲手撞上这堵墙。
- 报错时该找谁（验收项 3 的前半）：**找服务端**——是响应方没给 `Access-Control-Allow-Origin`，浏览器端没有任何设置能"绕过"它（插件除外，那不是解决方案）。
- 两种解法（验收项 3 的后半）：
  1. **服务端开**：服务提供方加 CORS 响应头。OSM / Carto 已默认为你开好；GeoServer 后台有现成 CORS 按钮（W8 你会亲手点）。
  2. **客户端代理**：让请求从**同源**发出，转发的事交给服务器。你仓库里已有现成例子——[vite.config.js](../projects/webgis-starter/vite.config.js) 的 `/geoserver` 代理；生产环境对应 nginx `proxy_pass`。
- **最小示例（CORS 对比实验，三条命令逐条敲）**【浏览器 DevTools→Console，在 <http://127.0.0.1:5173> 页面里】：
  ```js
  // ① 开了 CORS 的源：能拿到
  const ok = await fetch('https://basemaps.cartocdn.com/light_all/12/3336/1777.png');
  ok.status; // 预期：200
  (await ok.blob()).size; // 预期：一个正整数（字节数）

  // ② 没开 CORS 的源：浏览器拦截
  await fetch('https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=12&TILEROW=1777&TILECOL=3336&tk=无效key');
  // 预期：红色报错（原文如下）
  // Access to fetch at '...' from origin 'http://127.0.0.1:5173' has been
  // blocked by CORS policy: No 'Access-Control-Allow-Origin' header is
  // present on the requested resource.

  // ③ mode:'no-cors'：请求照发，但响应是"不透明"的
  const op = await fetch('https://t0.tianditu.gov.cn/img_w/wmts?...', {mode: 'no-cors'});
  op.type;   // 预期：'opaque'
  op.status; // 预期：0
  await op.blob(); // 预期：空 blob（size 0）—— 读不到内容
  ```
  - **预期输出**：①成功拿到字节数；②Console 红字 CORS 报错；③能拿到响应对象但内容为空。
  - **失败时**：②如果不报错反而成功，说明你测的那个源其实开了 CORS（换坑表 P1 的例子再试）；③若连 `op.type` 都打不出来，检查是不是忘了 `await`。
- **常见误区**：① 以为"图能在 `<img>` 里显示"就等于"fetch 能读"——不是，`<img>` 不受 CORS 限制；② 以为前端改个配置能"绕过"CORS——不能，只能服务端开头或走代理；③ 把 `no-cors` 当解决方案——它只让请求发出去，**读不到内容**，等于没用。

### 1.4 瓦片金字塔与分级加载（0.5 h）

> **学完你能做什么**：能解释为什么 zoom+1 后 Network 里的瓦片请求大约变 4 倍，以及为什么不是精确 4 倍。

- **定义**：瓦片金字塔是把全世界地图按 zoom 级别逐级剖分成 2^z × 2^z 张 256×256 小图的体系；分级加载指浏览器只下载当前视野覆盖的那些瓦片。
- **类比**：世界地图是一幅巨型壁画，金字塔是把它预先复印成"远看一张小图、近看 4 张、再近看 16 张"的套娃；你站在哪个距离（zoom），就只取那一层、且只取你眼前那几块。
- W1 结论回收：`coord.mjs` 里打印过"每升一级瓦片总数 ×4"——本周练习 2 就是去 Network 面板**实测视野内瓦片数是不是也 ×4**（剧透：接近但不精确，原因你自己找）。
- 256×256 是事实标准；512 瓦片（Retina / `devicePixelRatio`）是什么；`maxZoom` 之后浏览器怎么办（overzoom，把 z 级瓦片放大顶上去）。
- 瓦片 y 方向三套约定：**slippy map**（y 向下，OSM/Google/Carto/天地图 w，你 W1 公式实现的就是它）、**TMS**（y 向上，转换 `y_tms = 2^z − 1 − y`）、ArcGIS REST 的 `{z}/{y}/{x}` 顺序（[basemaps.js](../projects/webgis-starter/src/basemaps.js) 注释第 1 条已提醒，写反就花屏/404）。
- **最小示例**【浏览器 DevTools→Console，在 <http://127.0.0.1:5173> 里】：
  ```js
  gis.map.getView().getZoom();        // 先看当前 zoom
  gis.map.getView().setZoom(12);      // 飞到 12 级，Network 立刻刷一批新请求
  ```
  预期输出：zoom 数字变化，Network 多出几十条 `png` 请求。**失败时**：若地图没动，确认你在 `webgis-starter` 页面且 Console 没打错对象名（是 `gis.map`，不是 `map`）。
- **常见误区**：① 以为 zoom 是连续的——瓦片服务只认整数级；② 以为 `maxZoom` 到顶就白屏——其实是把上一级瓦片放大顶着（overzoom），所以图会糊但不空。

### 1.5 WMS / WMTS / WFS / MVT 对照表（0.5 h，抄进笔记）

> **学完你能做什么**：给一个需求（"要点选查属性"/"要标准底图"/"要换配色不重渲染"），能说出该选哪种服务、为什么。

| 服务 | 给你什么 | 典型请求 | 缓存/CDN 友好度 | 前端职责 | 典型场景 |
| --- | --- | --- | --- | --- | --- |
| WMS | 按需渲染的一张图（PNG） | `GetMap?...&BBOX=...&WIDTH=...` | 差（bbox/尺寸参数连续，几乎命中不了缓存） | 只管贴 | 临时出图、样式复杂的专题图 |
| WMTS | 预切好的固定瓦片 | `GetTile&TileMatrix={z}&TileRow={y}&TileCol={x}` | 极好（URL 即缓存键） | 只管贴 | 标准底图 |
| WFS | 数据本身（GML/GeoJSON） | `GetFeature&typeNames=...&CQL_FILTER=...` | 中 | 自己渲染、自己交互、自己算 | 中小数据量的查询/编辑/点击弹窗 |
| MVT/PBF | 按瓦片裁剪压缩的矢量 | `.../{z}/{x}/{y}.pbf` | 极好 | 样式和渲染都在前端 | 大数据量 + 前端可换样式（W9 主场） |

- 一句话版（验收项 2）：**WMTS 给你一张"已经冲洗好的照片"，WFS 给你"底片和原材料"**——前者你只能看，后者你能改能算。
- 主计划文档验收标准里写的 "WTMS" 是笔误，应为 **WMTS**（已在 [WebGIS-12周学习计划.md](WebGIS-12周学习计划.md) 修正）。
- 眼见为实：`basemaps.js` 里的天地图地址就是 **WMTS 的 REST 风格当 XYZ 用**——`TILEMATRIX/TILEROW/TILECOL` 对应 `z/y/x`（练习 4 拆它）。

### 1.6 浏览器渲染：为什么地图是"一层层贴图"（0.5 h）

> **学完你能做什么**：拖动地图时，能说出浏览器此刻在做什么（平移已有瓦片 + 补边缘），而不是觉得"它在重新画整个世界"。

- **定义**：浏览器把每个图层渲染成独立的 canvas / DOM 层，按 z 序合成最终画面；拖动时只做平移变换和增量加载。
- **类比**：拼图板——你拖动的是已经拼好的整块板子，只有边缘新露出来的地方才需要补新拼图块。
- **最小示例**【浏览器 DevTools→Network，在 <http://127.0.0.1:5173> 里】：
  1. Network 筛 `png`，清空列表；
  2. 用鼠标把地图向左拖一小段（约半屏）；
  3. 观察新出现的请求：只有十几条，且全部集中在右侧边缘。
  - **预期输出**：新请求数量 ≈ 边缘露出的瓦片数，而不是整屏重拉。
- 每个图层（底图、矢量、标注）是独立的一层（DOM 元素 / canvas），按 z 序从下往上合成——这就是"贴出来的"。
- 拖动 = 已有瓦片网格整体平移 + 只补拉新露出的边缘瓦片；缩放 = 切换金字塔层级 + 用旧瓦片临时放大顶住空窗。
- 理解"一屏 50 张图 × 每秒 60 帧"为什么有压力 → 这是 W9 性能优化的问题来源，先埋个钩子。
- **常见误区**：① 以为拖动是"重新下载整屏"——其实 80% 是复用；② 以为缩放瞬间的模糊是 bug——那是旧瓦片放大顶窗的过渡态。

---

## 2. 练（本周主体，产出物进 `projects/tile-lab/`）

### 练习 1：纯 HTML 瓦片页面（周一~周二，核心交付）

要求：**不用任何框架和地图库**，一个 `index.html` + 一个 `main.js`（ES module），`npx serve` 打开即可（**双击 file:// 不行**，见坑 P8）。

**前置检查**（全部满足再动手）：
- [ ] `node --version` 能输出版本号（v18+）
- [ ] [coord.mjs](../projects/coordinate-lab/coord.mjs) 存在且你跑过 `node coord.mjs verify`（W1 已通关）
- [ ] 已建文件夹 `projects/tile-lab/`（【PowerShell】`mkdir projects\tile-lab`）
- [ ] 知道怎么开 DevTools（F12）

**步骤 1：HTML 骨架**（先让页面"有东西"）

新建 `projects/tile-lab/index.html`，原样敲入：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>tile-lab · 手写瓦片</title>
</head>
<body>
  <h1>手写瓦片 URL</h1>
  <label>经度 <input id="lon" type="number" step="0.0001" value="113.2644"></label>
  <label>纬度 <input id="lat" type="number" step="0.0001" value="23.1291"></label>
  <label>缩放
    <select id="zoom">
      <option>4</option><option>8</option>
      <option selected>12</option><option>15</option>
    </select>
  </label>
  <button id="go">取瓦片</button>
  <p id="status">还没取过瓦片</p>
  <img id="tile" alt="瓦片会出现在这里" width="256" height="256"
       style="border:1px dashed #999">
  <script type="module" src="./main.js"></script>
</body>
</html>
```

**本步完成后浏览器里应该看到**：一个朴素页面：标题、两个输入框（已填好广州坐标）、缩放下拉框、按钮、一行"还没取过瓦片"、一个虚线空框。
**启动方式**【PowerShell】：`npx serve projects/tile-lab`，浏览器开它给出的地址（通常 <http://localhost:3000>）。
**失败时**：页面全白且 Console 报 `ERR_FILE_NOT_FOUND` → 文件名或路径错了；报 CORS / module 加载失败 → 你是双击 file:// 打开的，回到坑 P8。

**步骤 2：引入 JS 并验证接线**

新建 `projects/tile-lab/main.js`：

```js
document.getElementById('go').addEventListener('click', () => {
  document.getElementById('status').textContent = '按钮通了！';
});
```

**本步完成后应该看到**：点"取瓦片"按钮，状态行变成"按钮通了！"。
**失败时**：点了没反应 → F12 看 Console，`addEventListener of null` 说明 id 拼错（HTML 里是 `go`，JS 里也要是 `'go'`）。

**步骤 3：复制 tileXY / tileBounds 两个纯函数**

打开 [coord.mjs](../projects/coordinate-lab/coord.mjs)，**只复制三段东西**到 main.js 顶部：
1. 常量 `MAX_LAT`（第 29 行）；
2. `tileXY()` 函数（第 83~94 行）；
3. `tileBounds()` 函数（第 97~107 行）。

⚠️ **别复制**文件尾部的 `parseArgs` / `process.argv` / switch 块——那是 Node CLI 专用，浏览器里没有 `process`，粘过去就报 `process is not defined`（坑 P6）。

**本步完成后应该看到**：页面行为不变（函数还没被调用）。在 Console 里验证函数可用是不行的（module 作用域不外露），直接进下一步。
**失败时**：刷新就报错 → 粘多了 CLI 代码，删掉重来。

**步骤 4：算编号 + 拼 URL + 状态行显示**

把按钮处理改成：

```js
document.getElementById('go').addEventListener('click', () => {
  const lon = Number(document.getElementById('lon').value);
  const lat = Number(document.getElementById('lat').value);
  const z = Number(document.getElementById('zoom').value);

  const {x, y} = tileXY(lon, lat, z);
  const b = tileBounds(x, y, z);
  const url = `https://basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;

  document.getElementById('status').textContent =
    `z=${z} x=${x} y=${y} ｜ 范围 ${b.west.toFixed(4)}~${b.east.toFixed(4)}E, ` +
    `${b.south.toFixed(4)}~${b.north.toFixed(4)}N`;
  window.__tileUrl = url; // 先存起来，下一步显示用
});
```

**本步完成后应该看到**：点按钮后状态行显示 `z=12 x=3336 y=1777 ｜ 范围 ...`。**数字必须是 3336/1777**——这就是 W1 基准值，对上了说明 W1→W3 闭环成功；对不上先检查经纬度输入框的值。
**失败时**：状态行出现 `NaN` → 输入框被清空了或填了非数字；x/y 是别的数 → 经纬度顺序填反了（第一个是**经度** 113.2644）。

**步骤 5：方式 A 显示——`img.src` 直接贴**

在上面代码末尾追加：

```js
  document.getElementById('tile').src = url;
```

**本步完成后应该看到**：虚线框里出现一张 Carto 浅色瓦片（广州城区），256×256。
**失败时**：框里还是空的 → F12 Network 找那条 cartocdn 请求，看状态码：404 = 编号拼错（检查 URL 模板里 `{z}/{x}/{y}` 顺序）；超时/失败 = 网络问题，见坑 P4（启动 Steam++）。

**步骤 6：方式 B 显示——fetch + blob（并加切换开关）**

HTML 里按钮旁加一个开关：

```html
<label><input id="useFetch" type="checkbox"> 用 fetch 方式（方式 B）</label>
```

JS 里把显示部分改成：

```js
  if (document.getElementById('useFetch').checked) {
    const res = await fetch(url);                 // 需要把处理函数改成 async
    const blob = await res.blob();
    document.getElementById('tile').src = URL.createObjectURL(blob);
    document.getElementById('status').textContent +=
      ` ｜ fetch: HTTP ${res.status}, ${blob.size} 字节`;
  } else {
    document.getElementById('tile').src = url;
  }
```

（记得把第 4 步的回调改成 `async () => {...}`。）

**本步完成后应该看到**：勾选开关再点按钮，瓦片照常显示，且状态行末尾多出 `fetch: HTTP 200, xxxxx 字节`。
**失败时**：CORS 红字报错 → 你换用了不开 CORS 的瓦片源（这正是坑 P1 的教学点）；`Failed to fetch` → 网络断或域名不通。

**步骤 7：对比实验——fetch vs img.src**【浏览器 DevTools→Console】

在页面上逐条执行，观察差异并记进 `notes/week03.md`：

```js
// ① img 方式能不能拿字节数？不能——img 元素不暴露响应体
const img = document.getElementById('tile');
img.naturalWidth;   // 预期：256（只能看到图，读不到数据）

// ② fetch 能不能拿？能
const r = await fetch(window.__tileUrl);
r.headers.get('content-type');   // 预期：'image/png'
r.headers.get('cache-control');  // 预期：类似 'public, max-age=...'
(await r.blob()).size;           // 预期：字节数

// ③ Network 面板证据：两种方式各点一次按钮，对比两条请求的 Initiator 列
//    img.src → 显示 "img"；fetch → 显示 "main.js:xx"
```

**预期输出**：① 只能拿到图片尺寸；② 能拿到响应头和字节数；③ Network 里两种方式的发起者不同。
**结论要写下来**：`img.src` 是"贴出去就完事"，`fetch` 是"先拿到手再决定干嘛"——后者能做进度条、缓存控制、错误重试，代价是受 CORS 管束。

**加练（选做）**：3×3 九宫格拼接——中心瓦片 `x±1 / y±1`，一次请求 9 张，用 CSS grid 或绝对定位贴成一张大图；再试试 z=4 的九宫格，你会看到半个地球。

**完成自查**（对应验收项 1）：
- [ ] 页面能显示广州 z=12 瓦片，状态行显示 `x=3336 y=1777`
- [ ] 方式 A 和方式 B 都能显示瓦片，方式 B 能打印 HTTP 状态和字节数
- [ ] 代码里只有 `tileXY` / `tileBounds` 两个函数来自 coord.mjs，没有 `process` 残留
- [ ] `notes/week03.md` 里记录了 fetch vs img.src 的三条对比结论

### 练习 2：Network 面板实测瓦片请求数规律（周三~周四）

**前置检查**：
- [ ] 练习 1 已完成（你知道 z/x/y 是怎么算出来的）
- [ ] `webgis-starter` 能跑起来（`npm run dev` 后 <http://127.0.0.1:5173> 有地图）

1. 跑起示例项目：`cd projects/webgis-starter` → `npm install` → `npm run dev`，打开 <http://127.0.0.1:5173>。
2. DevTools → Network → 过滤 `png` → **勾上 Disable cache**（不勾测出来的是缓存命中数，不是请求数——坑 P2）。
3. 把地图中心固定在广州，依次设 z = 4, 5, 6, 7, 8（控制台里 `gis.map.getView().setZoom(z)` 最快，starter 已挂 `window.gis`），每级**刷新页面**，记录瓦片请求条数，填进表格：

   | z | 瓦片请求数 | 请求数 ÷ 上一级 |
   | --- | --- | --- |
   | 4 | | — |
   | 5 | | |
   | 6 | | |
   | 7 | | |
   | 8 | | |

4. 回答三个问题（写进 `network-counts.md`）：
   - 比值接近 4 吗？**为什么不是精确的 4**？（提示：视野宽高比、边缘瓦片取整、`maxZoom`/minZoom 限制）
   - 取消 Disable cache 重做一遍，Size 列出现了什么？（`304` / `(disk cache)`——说清它们分别意味着什么）
   - 拖动地图时新请求的瓦片分布在哪？（只有新露出的边缘——这就是"分级加载"的直观证据）
5. 顺手把任意一张瓦片请求的 Response Headers 截图存档，标出 `Cache-Control` 和 `Access-Control-Allow-Origin`。

**完成自查**：
- [ ] 表格 5 行数字全是**勾了 Disable cache** 之后实测的
- [ ] 三个问题都写了回答，特别是"为什么不是精确 ×4"
- [ ] Headers 截图里两个响应头都标出来了

### 练习 3：链路图 + 服务对比笔记（周五）

**前置检查**：
- [ ] 练习 2 已完成（手里有 z=4~8 的实测表格——画链路图时"瓦片服务"那一环要用它当证据）
- [ ] 已通读 1.5 节服务对照表（本练习第 2 步是默写，先别翻回去看）
- [ ] `notes/week03.md` 已建立（笔记类产出物统一写这里）

1. 用文字/Mermaid 画一遍链路图（存 `pipeline.md`），每一环标注**它干什么**和**它坏了的症状**：

   ```
   浏览器(视野→瓦片编号→并发请求→贴图)
     → CDN/缓存(命中则不回源；症状：改了样式不生效=缓存没刷)
     → 瓦片服务(预切瓦片 WMTS/MVT 或实时渲染 WMS；症状：429 限流、5xx)
     → 数据源(PostGIS/文件；症状：服务起了但图层空白=数据或 CRS 问题)
   ```

2. 把 1.5 节的对照表**默写**一遍进笔记（默写不出来的地方就是没懂的地方）。
3. 写一张"CORS 处理卡片"：报错找谁 → 两种解法 → 本仓库里两个现成例子（`vite.config.js` 代理、GeoServer CORS 开关）。

**完成自查**：
- [ ] `pipeline.md` 里每一环都有"它坏了的症状"
- [ ] 对照表是默写的（写不出来的地方回 1.5 节重读）
- [ ] CORS 卡片能脱离手册复述

### 练习 4（加练，选做）：WMTS 也不过是 XYZ

**前置检查**：
- [ ] 练习 1 页面能正常出瓦片（本练习是"换 URL"，页面坏了先修练习 1）
- [ ] 已在[天地图控制台](https://console.tianditu.gov.cn/)注册并申请了浏览器端 key（没注册就跳过本练习，不阻塞通关）
- [ ] 打开坑表 P5（天地图 403 的 referer 白名单解法），先知道这个坑再动手

拆 [basemaps.js](../projects/webgis-starter/src/basemaps.js) 第 26~32 行的天地图 URL 模板：`SERVICE=WMTS&REQUEST=GetTile`、`TILEMATRIX={z}`、`TILEROW={y}`、`TILECOL={x}`——逐参数说明它和 `https://.../{z}/{x}/{y}.png` 的对应关系。然后到[天地图控制台](https://console.tianditu.gov.cn/)免费申请 key，把练习 1 页面的 URL 换成天地图（注意 referer 白名单要加 `127.0.0.1`，见坑 P5），确认同一张广州瓦片编号不变。**做完这个，"OGC 标准"对你的神秘感就消掉一半。**

**完成自查**：
- [ ] 能逐参数说出天地图 WMTS URL 与裸 XYZ 的对应关系（`TILEMATRIX=z`、`TILEROW=y`、`TILECOL=x`）
- [ ] 同一广州点在 z=12 下，天地图返回的瓦片与 Carto 是同一区域（编号仍是 3336/1777）
- [ ] 能说出 WMTS 比裸 XYZ 多出的"标准"好处（GetCapabilities 自描述、多种切片方案、URL 即缓存键）

---

## 3. 验收标准（全过才算 W3 通关）

- [ ] 能不用地图库，手写 URL 把指定位置的瓦片显示在页面上（`tile-lab` 页面截图 + 代码提交；广州 z=12 = 3336/1777 验证通过）
- [ ] 能解释 **WMTS** 与 WFS 的本质区别（一个给图，一个给数据），并各说一个选型场景
- [ ] 能说出 CORS 报错时该找谁（服务端/服务提供方，浏览器端绕不过）、有哪两种解法（服务端加 CORS 头 / 同源代理）
- [ ] 有自己实测的 z=4~8 瓦片请求数表格，并能解释"为什么接近 ×4 但不精确 ×4"
- [ ] 链路图已提交，每一环带"故障症状"
- [ ] 产出物已提交 Git：`projects/tile-lab/` + `notes/week03.md`（坑表延续 week01 第二节格式）

---

## 4. 坑预告（按你的环境定制，遇到就回来打勾）

| # | 预判的坑 | 症状 | 解法 |
| --- | --- | --- | --- |
| P1 | fetch 跨域瓦片 | Console 红字 `No 'Access-Control-Allow-Origin' header ...`，但同一 URL 贴进 `<img>` 能显示 | 这正是本周的教学点（1.3 节）：换 OSM/Carto 这类开了 CORS 的源，或理解 `no-cors` 的 opaque 拿不到内容 |
| P2 | 没勾 Disable cache 就数请求 | Network 一片 304 / 灰色 `(disk cache)`，统计的"请求数"严重偏小 | 数**真实请求**时勾上；做缓存对比实验时再取消 |
| P3 | OSM 瓦片 404 / 429 | z 超过 19，或脚本连续刷瓦片被限流 | 404 先核对编号（对照 W1 基准表）；429 停手，OSM 服务条款禁止滥用，学习用 Carto |
| P4 | 国外瓦片服务/`raw.githubusercontent.com` 时通时断 | 请求超时、连接重置 | W0 笔记第六节：Steam++ 的 hosts 加速没开，先启动它 |
| P5 | 天地图 403 | 有 key 仍拒绝 | key 绑 referer 白名单：控制台里把 `127.0.0.1` / `localhost` 加进白名单；`.env` 改完要重启 dev server |
| P6 | 复制 coord.mjs 到浏览器报错 | `process is not defined` / `Cannot read properties of undefined (reading 'slice')` | coord.mjs 尾部是 Node CLI 专用；只复制 `tileXY` / `tileBounds` 两个纯函数 |
| P7 | y 方向搞反（撞上 TMS） | 显示的瓦片在地球另一端/南半球海洋 | OSM/Carto/Google/天地图 w 都是 slippy（y 向下），W1 公式即此约定；遇到 TMS 用 `y' = 2^z − 1 − y` 翻转 |
| P8 | `type="module"` 页面双击 `file://` 打开 | Console 报 CORS 策略拒绝加载本地模块 | ES module 不能用 `file://` 加载，起个本地服务：`npx serve projects/tile-lab` |

---

## 5. 本周产出物结构（提交到 Git）

```
projects/tile-lab/
├─ index.html            # 练习 1：输入框 + 展示区 + A/B 方式开关（+选做九宫格）
├─ main.js               # 练习 1：tileXY/tileBounds（来自 coord.mjs）+ fetch 逻辑
├─ network-counts.md     # 练习 2：z=4~8 实测表格 + 三问回答 + Headers 截图
├─ pipeline.md           # 练习 3：链路图 + 服务对照表默写 + CORS 卡片
├─ tianditu-wmts.md      # 练习 4（选做）：WMTS 参数 ↔ XYZ 对应关系
└─ README.md             # 结论汇总：一张地图从点击到显示的完整旅程

notes/week03.md          # 学 + 练过程记录、坑表（延续 week01.md 格式）
```

---

## 6. W3 结束后的下一步预告（W4：OpenLayers 核心）

本周把"瓦片魔法"拆掉之后，W4 读 `map.js` / `draw.js` / `styles.js` 时你会知道每个 `TileLayer` 背后在发什么请求。W4 的三个功能（换自己的数据、侧边栏属性表、图层面板）直接消费 W2 的 `guangzhou_slim.geojson`——所以 W2 的坑别留到那时再补。

> 纪律不变：卡住 2 小时 → 记坑表 → 跳过。本周过程记录写进 `notes/week03.md`，通关后回来更新 README 进度表。
