# W4 实验手册：OpenLayers 核心

> 对应《WebGIS 12 周学习计划》W4。建议时间：2026-10-27 ~ 2026-11-02（每天 1.5~2 h）。
> 环境前提：Node.js + **npm**（不用 pnpm——W0 坑 #1）、Chrome/Edge、`webgis-starter` 能跑起来、W2 产出 `projects/data-lab/guangzhou_slim.geojson` 已就位。
> 纪律提醒：[README 进度表](../README.md) 里 W2/W3 还没打勾。**先按 [W2 手册](W2-空间数据格式与转换-实验手册.md)、[W3 手册](W3-Web与瓦片渲染原理-实验手册.md) 通关再进本周**——W3 把"瓦片魔法"拆掉之后，本周你才知道 `TileLayer` 背后在发什么请求。
> 本周代码位置：起步项目 [src/main.js](../projects/webgis-starter/src/main.js)、[src/map.js](../projects/webgis-starter/src/map.js)、[src/draw.js](../projects/webgis-starter/src/draw.js)、[src/styles.js](../projects/webgis-starter/src/styles.js)、[src/basemaps.js](../projects/webgis-starter/src/basemaps.js)、[index.html](../projects/webgis-starter/index.html)。

---

## 0. 本周要建立的三个认知

| # | 认知 | 为什么重要 |
| --- | --- | --- |
| 1 | **OpenLayers 不是"一个地图"，是 7 个可拆零件的装配关系**：Map 是舞台、View 是摄像机、Layer 是透明胶片、Source 决定胶片上的画从哪来、Style 决定怎么画、Interaction 决定鼠标能干什么、Overlay 把 HTML 钉在地理位置上 | 以后所有报错（图层空白、点击没反应、地图不动）都能翻译成"哪个零件没接好"，不再靠猜和改玄学参数 |
| 2 | **屏幕上只有 3857，文件里只有 4326**，`dataProjection` 与 `featureProjection` 就是这条边界的两个门：一个管"进来的数据自称是什么坐标系"，一个管"内存里的要素要换算成什么坐标系" | 你 W1/W2 花两周建立的坐标系认知，只在跨过这道门时才真正开始省钱。国内数据大量是投影坐标系（CGCS2000 3 度带、3857 导出的 GeoJSON），默认值会静默错给你 |
| 3 | **前端过滤 = 隐藏，后端过滤 = 少要数据**；矢量图层的一切要素都在浏览器内存里，"看不见了"不等于"数据没了" | 决定 W8 之后哪些活交给数据库/服务，哪些活留在浏览器。也是"要素计数突然变少""筛选后点不中要素"这类怪现象的根因 |

---

## 1. 学（约 4 小时，周一到周三分散进行）

### 1.1 七个零件：一套剧场类比（1 h，边读 `map.js` 边看）

> **学完你能做什么**：看到 `map.js` 里任何一行代码，能说出它在装配哪个零件；地图出问题时能猜到是哪个零件没接好。

| 零件 | 代码位置（真实存在） | 类比 | 大白话 |
| --- | --- | --- | --- |
| `Map` | [map.js](../projects/webgis-starter/src/map.js) 第 117 行 `new OlMap({target, view, layers, controls})` | **舞台** | 一个把 DOM 容器、图层集合、控件装在一起的壳。它自己不知道"看哪里" |
| `View` | `new View({center, zoom, minZoom, maxZoom, constrainResolution})` | **摄像机** | 三个状态：中心点、缩放、旋转。拖动/滚轮本质上都是在改 View 的这三个值 |
| `Layer` | `TileLayer`（[basemaps.js](../projects/webgis-starter/src/basemaps.js)）、`VectorLayer`（map.js 第 95 行） | **透明胶片** | 一层可开关（`setVisible`）、可调明暗（`setOpacity`）、可换顺序（`setZIndex`）的膜。**数组顺序 = 叠图顺序**，索引大的盖在上面 |
| `Source` | `OSM` / `XYZ` / `VectorSource` | **胶片上的画从哪来** | 底图源=按 z/x/y 发请求贴图；矢量源=内存里一堆 Feature。**同一张胶片换源 = 换数据；同一路数据换源类型 = 换渲染策略**（W5、W9 的核心取舍） |
| `Style` | [styles.js](../projects/webgis-starter/src/styles.js) 的 `pointStyle` / `lineStyle` / `polygonStyle` | **怎么画** | 可以是**一个对象**（所有要素一样），也可以是**一个函数**（每个要素调用一次，按属性返回不同样式）。styles.js 第 77 行注释已经点明这点 |
| `Interaction` | [draw.js](../projects/webgis-starter/src/draw.js) 的 `Draw` / `Modify` / `Snap` / `DragAndDrop` | **鼠标键盘的解读规则** | `addInteraction` 就生效、`removeInteraction` 就退出。注意它们是**全局监听**的：`Draw` 没移除时，你的单击被它吃掉，点击弹窗就"失灵"（1.6 节细讲） |
| `Overlay` | map.js 第 145 行 `new Overlay({element, positioning, offset, autoPan})` | **钉在地理坐标上的 HTML** | 给一个 DOM 元素绑一个地图坐标，摄像机移动它就跟着走。弹窗（popup）、测量气泡（measure-tooltip）都是它 |

**动手验证（15 分钟，别跳过）**：`npm run dev` 打开页面 → F12 Console 里逐条敲（starter 已挂 `window.gis`）：

```js
gis.ctx.map.getView().setZoom(8);                 // 摄像机变焦：底图立刻变
gis.ctx.map.getView().setCenter([12608535, 2647638]); // 广州的 3857 坐标：立刻飞过去
gis.ctx.dataLayers.get('polygons').layer.setOpacity(0.2);  // 抽掉一张胶片上的墨
gis.ctx.map.getLayers().getArray().map((l) => l.get('name')); // 看看叠图顺序
```

**控制台亲手摸一遍：Map / View / Layer / Source**（每条都敲，别复制粘贴一整段）【浏览器 DevTools→Console，在 <http://127.0.0.1:5173> 里】：

```js
// —— Map：舞台本身 ——
gis.ctx.map.getTarget();              // 预期：'map'（HTML 容器 id）
gis.ctx.map.getLayers().getLength();  // 预期：一个数字（底图+数据层+标记层）

// —— View：摄像机的三个状态 ——
const v = gis.ctx.map.getView();
v.getZoom();        // 预期：当前缩放数字
v.getCenter();      // 预期：[x, y] 两个大数字（3857 米制坐标）
v.getRotation();    // 预期：0（没旋转过）
v.setZoom(10);      // 地图立刻放大

// —— Layer：一张张胶片 ——
const layers = gis.ctx.map.getLayers().getArray();
layers.map(l => l.get('name'));  // 预期：名字数组，顺序 = 叠图顺序
const poly = gis.ctx.dataLayers.get('polygons').layer;
poly.getVisible();   // 预期：true
poly.setVisible(false);  // 页面上"湖泊/管理区"立刻消失
poly.setVisible(true);   // 再开回来

// —— Source：胶片上的画从哪来 ——
const src = poly.getSource();
src.getFeatures().length;                    // 预期：要素个数
src.getFeatures()[0].getGeometry().getType(); // 预期：'Polygon' 或 'MultiPolygon'
src.getFeatures()[0].getProperties();        // 预期：一个对象（含 geometry，别慌）
```

**预期输出**：每条都有返回值，地图随 `setZoom` / `setVisible` 实时变化。
**失败时**：`Cannot read properties of undefined` → 检查链式调用哪一环返回了 `undefined`（比如 `get('polygons')` 说明 id 拼错）；`getFeatures is not a function` → 你拿到的是 TileLayer（底图）而不是 VectorLayer，底图的源没有 `getFeatures`。

看到的现象 → 对应哪个零件的哪个状态，写进 `notes/week04.md`。这就是"祛魅"的过程。

### 1.2 dataProjection vs featureProjection：具体例子讲透（1 h，本周最难也最值钱）

> **学完你能做什么**：拿到一份陌生 GeoJSON，能判断该写什么 `dataProjection`，并预判写错后地图会出现什么现象。

**一句话**：`dataProjection` = "这份文件里的数字，是哪种坐标系的数字"；`featureProjection` = "换算成什么坐标系，好让我塞进这张地图"。

看 [map.js](../projects/webgis-starter/src/map.js) 第 40~43 行的 `loadGeoJSONFile`（这是整个项目最关键的 4 行）：

```js
const features = new GeoJSON().readFeatures(json, {
  dataProjection: WGS84,        // 声明：文件里的数字是经纬度（单位：度）
  featureProjection: WEB_MERCATOR, // 要求：内存里的要素存成米（View 用的就是它）
});
```

拿广州 `113.2644, 23.1291`（W1 四方交叉验证过的基准点）走四遍：

| 情况 | 文件里的数字 | 你写的 `dataProjection` | 内存里存成 | 现象 |
| --- | --- | --- | --- | --- |
| A 正确 | `113.2644, 23.1291` | `EPSG:4326` | `12608535.33, 2647638.58` | 落在广州 ✅ |
| B 数据其实是 3857 导出的，你却声明 4326 | `12608535.33, 2647638.58` | `EPSG:4326`（错） | 被墨卡托钳制到纬度上限附近，跑到 (180, ~85) | 图上找不到要素，或被甩到太平洋 ❌ |
| C 数据其实是 3857，如实声明 | `12608535.33, 2647638.58` | `EPSG:3857` | `12608535.33, 2647638.58`（不变） | 正确落位 ✅ |
| D 只改 `featureProjection` 为 `EPSG:4326` | `113.2644, 23.1291` | `EPSG:4326` | `113.2644, 23.1291` | 3857 地图上中心是"一百万级米"，要素缩在原点看不境；反过来把 View 换成 4326 才能看见 ⚠️ |

三条必须记住的推论：

1. **默认值会骗你**：`ol/format/GeoJSON` 的默认数据投影按 RFC 7946 是 4326，但**默认要素投影 = 当前 View 的投影**只有在传了 `featureProjection` 相关上下文时才可靠。所以像 starter 那样**两个都显式写出来**，是唯一不靠运气的写法。
2. **反过来也有一对**：导出时用 `writeFeatures(features, {dataProjection, featureProjection})`，语义翻转——`featureProjection` 说"我内存里是 3857"，`dataProjection` 说"请给我写成 4326"。见 [draw.js](../projects/webgis-starter/src/draw.js) 第 226~230 行 `exportGeoJSON`，方向与 `readFeatures` 正好相反。**这是验收项 2 的高分答法。**
3. **非内置坐标系要注册投影**：OpenLayers 只内置 4326 / 3857 / 经纬度网格等少数几个。要读 EPSG:4490 或 CGCS2000 3 度带（EPSG:4523…）的数据，得先 `npm install proj4` 并用 `ol/proj/proj4` 的 `register(proj4)` 把定义注册进去，否则 `readFeatures` 直接抛 `Unknown projection`。练习 1 会撞到它。

### 1.3 Style：从"固定样式"到"按属性变色"（0.5 h）

> **学完你能做什么**：能给图层换颜色，并写出"按某个字段的值返回不同颜色"的样式函数。

- 对象式：`new VectorLayer({style: pointStyle})`（styles.js 现有函数）。
- 函数式：`style: (feature, resolution) => ...`，可返回 `Style` 或 `Style[]`；**返回 `null`/`[]` 表示这个要素不画**——这是练习 2 过滤的可选实现之一。
- 按分辨率变化：`styles.js` 里 `Text` 有 `offsetY: -20`（固定像素偏移）；把样式按 `resolution` 分档，是小数据量版的"分级显示"（W5、W9 会讲更正规的做法）。
- 记住 W1 的结论：`radius`、`width` 单位是**像素**，不是米。像素单位意味着"不变形"，这也是矢量渲染优于图片瓦片的一个具体体现（W5 展开）。

### 1.4 点击命中：`forEachFeatureAtPixel` 与它的脾气（0.3 h）

> **学完你能做什么**：能实现"点地图上的要素弹出它的属性"，并知道点不中时该调哪个参数。

map.js 第 163~176 行的 `singleclick` 处理，拆开看：

- `map.forEachFeatureAtPixel(pixel, cb, {hitTolerance: 6, layerFilter})`：**返回最上层命中的第一个**，命中不到回调不执行；`hitTolerance` 是"容差像素"，细线不好点就调大它。
- `layerFilter` 用 `layer.get('kind')` 过滤（`data` / `draw` / `import` 三类可点，底图不可点）——`properties` 是 OL 图层上很好用的"自定义标签袋"。
- `event.dragging` 判断：拖完地图松手也算一次 click，不挡住就会"拖动后莫名弹出属性"。
- **重叠要素**怎么拿全：回调返回非 `undefined` 时 OL 会用它做候选继续往下找，或直接把返回值收集成数组（练习 2 让你实现"点选列表"）。

### 1.5 事件与生命周期（0.2 h）

> **学完你能做什么**：能给地图挂事件，并且能**干净地摘掉**（不留残留监听）。

`map.on('singleclick' | 'pointermove' | 'moveend')`、`source.on('addfeature' | 'remfeature' | 'change')`、`view.on('change:resolution')`（map.js 第 202 行 `syncZoom`）、`layer.on('change:visible')`。**所有 `on` 都返回一个 listener key，`un` 时才取得掉**——练习 4 就练这个。

### 1.6 Interaction 与事件的冲突（0.4 h，"点不动"的标准答案）

> **学完你能做什么**：遇到"点了没反应"，能按清单排查是不是 `Draw` 没退出、事件被吃掉。

`Draw` 一旦 `addInteraction` 就接管鼠标：map.js 里的 `singleclick` 处理器**仍然在跑**，只是画点时点两下会同时触发弹窗。starter 的做法是"退出绘制再点"（[main.js](../projects/webgis-starter/src/main.js) 第 88~107 行按钮切换 + `deactivate`）。更正规的做法有两种，练习 4 都要体验：

1. **状态守卫**：在 click 处理器开头 `if (tools.getTool().tool) return;`（简单、够用）。
2. **临时摘除默认交互**：`map.getInteractions().getArray().find(i => i.constructor.name === 'DragBox')` → `map.removeInteraction(that)`（`Shift+拖框` 缩放本来是 `DragBox` 干的，会和拖图/绘制的按下-拖动-释放抢事件）。

---

## 2. 练（本周主体，产出物进 `projects/ol-lab/`）

> **本周不要改动 `webgis-starter` 的源码**，把它当"参考实现"读。做法：`cp -r projects/webgis-starter projects/ol-lab` → 删掉 `node_modules` → `npm install` → 自由改 `src/`。这样 W5/W6 还能拿原始 starter 对照。

### 练习 1：把示例数据全换成自己的数据（周一，约 2 h）

**为什么做**：这是"我拥有这个项目"的第一次证明。`map.js` 里的 `SAMPLE_LAYERS` 数组就是数据清单，改它 = 改项目的世界观。

**前置检查**：
- [ ] `projects/data-lab/guangzhou_slim.geojson` 存在（W2 产出）
- [ ] `cp -r projects/webgis-starter projects/ol-lab` 已做，且 `ol-lab` 里 `npm install` + `npm run dev` 能跑、地图能打开
- [ ] 完成过 1.1 节的"控制台亲手摸一遍"（知道 `window.gis` 是什么）

**分步骤**：

1. 把 W2 产物复制进来：`projects/data-lab/guangzhou_slim.geojson` → `projects/ol-lab/public/data/`（`public/` 下的文件 dev/build 都能被 `fetch('/data/xxx')` 拿到，这是 [README.md](../projects/webgis-starter/README.md) 目录结构那节说的）。
2. 打开 `src/map.js` 第 29~33 行，把 `SAMPLE_LAYERS` 换成你的（骨架，`// TODO` 自己填）：

   ```js
   const SAMPLE_LAYERS = [
     {
       id: 'districts',
       label: '广州区县（面）',
       file: 'data/guangzhou_slim.geojson',
       style: /* TODO: 换成你在 styles.js 里新写的 polygonStyleMyTheme */,
       visible: true,
     },
     // TODO: 再加 1~2 个你自己的图层（点/线）
   ];
   ```

3. 加一个"地图自动定位到数据"的收尾（现有代码不会自动 fit，数据范围小就看不见）：

   ```js
   // 在 Promise.all 加载完成之后
   const extent = /* TODO: 合并各图层的 source.getExtent()，用 ol/extent 的 extend() */;
   view.fit(extent, {padding: [90, 90, 90, 90], maxZoom: 12, duration: 600});
   ```

   提示：`draw.js` 第 181~187 行的 `addfeatures` 里已经有一份现成的 `view.fit` 写法可以抄。

4. **改配色和标注**（主计划明确要求）：在 `src/styles.js` 里新写一组样式函数，注意三点——
   - 面填充用带 alpha 的 rgba（参考现有 `rgba(245, 158, 11, 0.25)`，透明度别超过 0.35，否则压不住底图文字）；
   - 标注文字保留**白色描边**（`whiteHalo()`，styles.js 第 18 行），这是"字压在底图上还看得清"的关键；
   - 名字字段不一定是 `name`：先 `ogrinfo -so -al` 或浏览器里 `console.log(json.features[0].properties)` 看你数据真实字段名，再改 `feature.get('...')`。
5. 坐标系联动实验（把 1.2 变成你的经验）：临时把 `loadGeoJSONFile` 里的 `dataProjection: WGS84` 改成 `WEB_MERCATOR`，**先预测现象再刷新页面**，记录实际现象与解释。然后改回来。
6. 挑战（选做）：拿一份 QGIS 导出成 **EPSG:3857 或 4523** 的数据塞进来，走通 `proj4` 注册：

   ```js
   import proj4 from 'proj4';
   import {register} from 'ol/proj/proj4.js';
   import {get as getProjection} from 'ol/proj.js';
   proj4.defs('EPSG:4523', '+proj=tmerc +lat_0=0 +lon_0=114 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs');
   register(proj4);
   // 然后 dataProjection 就可以写 'EPSG:4523' 了
   ```

**预期现象**：加载后地图飞到你的数据范围、区县面按你的新配色显示、名称标注清晰可读、点击有属性弹窗。

**完成自查**：
- [ ] 地图自动飞到数据范围（不是手动拖过去的）
- [ ] 要素落在广州（用基准值 `12608535.33, 2647638.58` 交叉验证过，不是目测）
- [ ] 步骤 5 的坐标系联动实验做过，且预测现象与实际一致、能解释
- [ ] 标注文字有白色描边、在深色底图上也看得清

**做对了的标志**：对应验收项 1——**关掉教程，从 `new VectorSource()` 到 `map.addLayer()` 手写一遍能加载本地 GeoJSON**，且要素出现在正确位置（拿广州 z=12 瓦片编号 3336/1777 或 3857 基准值 `12608535.33, 2647638.58` 交叉对一次，别目测）。

### 练习 2：侧边栏属性表 + 按属性过滤（周二~周四，约 5 h，本周核心交付）

**为什么做**：这是第一个"你自己设计的功能"，会同时用到 Map 事件、Source 查询、Overlay 语义取舍、以及 DOM 操作四件事。也是面试最爱问的"点击要素显示属性怎么做"。

**前置检查**：
- [ ] 练习 1 完成，你的数据能在 `ol-lab` 里显示
- [ ] 读过 `map.js` 第 163~176 行的 `singleclick` 处理（知道弹窗是怎么来的）
- [ ] 知道 `feature.getProperties()` 返回什么（1.1 节控制台实验里看过）

**先做一个架构决定（写进 README，这是本题的真正考点）**：
弹窗（Popup）= 一次看一个要素、位置跟图；**侧边栏（Side panel）= 一次看多个要素、可对比可筛选、位置在屏外**。所以侧边栏**不该**用 `Overlay`，而是普通 DOM 面板。这个区别要能说清。

**步骤 A：点击要素 → 侧边栏表格**

A1. **HTML 面板骨架**：在 `index.html` 里 `<aside id="panel">` 之后加一个右侧面板：

```html
<aside id="sidebar">
  <h2>要素属性</h2>
  <p id="sidebar-hint">点击地图上的要素</p>
  <table id="attr-table"></table>
  <button id="sidebar-clear" type="button">清空</button>
</aside>
```

**预期现象**：页面右侧出现一个新面板（可能没样式、很难看，没关系）。失败时：看不到 → 检查 `<aside>` 是不是写在了 `#app` 里面。

A2. **CSS 布局**：在 `style.css` 末尾追加：

```css
#sidebar { position: absolute; right: 0; top: 48px; width: 320px; bottom: 32px;
  background: #fff; overflow: auto; padding: 12px; box-shadow: -2px 0 8px rgba(0,0,0,.15); }
#attr-table { border-collapse: collapse; width: 100%; font-size: 13px; }
#attr-table td, #attr-table th { border: 1px solid #ddd; padding: 4px 6px; }
```

**预期现象**：面板有了白底、边框、固定宽度，不再和地图挤在一起。

A3. **JS 事件接线**（新建 `src/sidebar.js`，骨架如下）：

```js
// src/sidebar.js（新建）
export function setupSidebar(map, view, source, {tableId, clearId}) {
  const layerKind = /* TODO: 你想支持哪些图层？用 layer.get('kind') 做 layerFilter */;
  const hitOptions = {hitTolerance: 6 /* TODO: layerFilter */};

  function handleClick(event) {
    if (event.dragging) return; // 拖图后松手不算点击（照抄 map.js 的做法）
    // 需求 1：收集该像素下的【全部】候选要素（forEachFeatureAtPixel 的回调返回收集数组）
    const candidates = [];
    map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
      candidates.push({feature, layer});
      return candidates; // 返回非 undefined：OL 继续找下层，最后把返回值给你
    }, hitOptions);
    if (!candidates.length) {
      // TODO: 显示"这里没有要素"
      return;
    }
    // 需求 2：候选 > 1 时先列出来让用户选（点重叠要素的场景）
    // 需求 3：渲染成 <table>：表头是字段名，表体是一行一个候选要素
    // 需求 4：行 hover → 高亮该要素 + view.center 平移过去；行 click → view.fit(单要素 extent, {maxZoom: 16})
    // 提示：过滤掉 geometry 与值为 object 的属性，参考 map.js renderPopupContent 的 filter 写法
    // TODO
  }

  map.on('singleclick', handleClick); // TODO: 返回 listener key 并提供 teardown
  // TODO: 高亮图层（一个专用 VectorLayer + 缓存 Feature 克隆，注意别污染原图层）
}
```

**预期现象（A3 完成时）**：在 `main.js` 里 `import {setupSidebar} from './sidebar.js'` 并调用后，点地图上的区县，Console 里能打出候选要素数组（先 `console.log(candidates)` 验证接线，再写渲染）。
**失败时**：点了没反应 → ① `layerFilter` 把图层全过滤掉了（先去掉 filter 试）；② `Draw` 工具没退出（坑 P5）；③ Console 有报错先读报错。

A4. **表格渲染**：把 `candidates` 渲染成 `<table>`——表头是字段名的并集，每行一个要素；过滤掉 `geometry` 和值为 object 的属性（参考 `map.js` 里 `renderPopupContent` 第 57~65 行的 filter 写法）。

**预期现象**：点要素后右侧面板出现整齐的属性表格；点空白处显示"这里没有要素"。

A5. **行交互**：行 hover → 高亮该要素；行 click → `view.fit(单要素 extent, {maxZoom: 16})` 飞过去。

高亮两种实现都要知道取舍（在 README 里写 200 字）：① `feature.setStyle(tmp)` 直接改要素、`feature.setStyle(undefined)` 还原；但会被**图层样式函数**盖掉（styles.js 里样式挂在 layer 上，要素自身 setStyle 优先级更高，一般可行，但图层用 `Style[]`/`rule` 时容易打架）。② 专用高亮图层 + `feature.clone()`：干净、可控、代价是多一个图层。**推荐 ②**。

**步骤 B：按属性过滤显示**

B1. **过滤下拉框 HTML**：在 `#sidebar` 里加：

```html
<label>按类型过滤
  <select id="filter-field"><option value="">（全部）</option></select>
</label>
```

B2. **填充选项**：从数据里收集某字段的全部去重取值填进 `<select>`（骨架里 `values` 那段）。
**预期现象**：下拉框里出现你数据里真实存在的取值（如各区县名）。失败时：下拉是空的 → 字段名拼错，先 `console.log(features[0].getProperties())` 看真实字段。

B3. **过滤逻辑**（三选一实现，骨架如下）：

```js
// src/filter.js（新建）：不重新 fetch，只在内存里"让某些要素不存在"
export function setupAttributeFilter(sources /* VectorSource[] */) {
  // 1) 从数据里收集"某字段的全部去重取值"，填进 <select>
  const values = new Set();
  // TODO: sources.forEach((s) => s.forEachFeature((f) => values.add(f.get('district_type'))));

  // 2) 三选一实现，README 里说明你选了哪个、为什么
  //    a) Style 函数返回 null：最轻，数据仍在内存，只是不画
  //    b) layer.setVisible(false)：整个图层开关，粗粒度
  //    c) source.removeFeature(不匹配的) + 缓存：真正"没了"
  //       ⚠️ 副作用必须写清：要素计数变小（main.js refreshCounts 会反映出来）、
  //          选中/高亮可能失效、导出会缺要素（draw.js exportGeoJSON）、
  //          撤销恢复需要保留原始 Feature 数组
  const hiddenCache = [];
  function applyFilter(predicate) {
    // TODO: 遍历 source，匹配的放回（addFeature）、不匹配的移出并 push 进 hiddenCache
  }

  // 3) 加一个"命中范围"提示：过滤后用 ol/extent 的 createEmpty + extend 累加可见要素，
  //    统计"可见要素在当前视野内的有几个"，显示在面板上（用 view.calculateExtent(map.getSize())）
  //    TODO
}
```

**预期现象**：点区县 → 右侧出现表格，adcode/name/自加字段一行行列出；下拉选某个值 → 地图上只留下对应要素；面板显示"可见 5 / 共 11 个要素，视野内 3 个"。

**完成自查**：
- [ ] 点要素出表格、点空白有提示、重叠要素能列出候选
- [ ] 下拉过滤生效，且能选回"（全部）"恢复
- [ ] 高亮方案二选一实现并在 README 写了 ≥200 字取舍
- [ ] VS Code 全项目走查：无未使用变量（`hiddenCache`、`layerKind` 之类）

**做对了的标志**：对应验收项 3——过滤功能可用；且 `npm run dev` 后打开 VS Code，**删掉任何你写了但没被引用的变量/函数**（练习里最容易留一手的是 `hiddenCache`、`layerKind`、`clearId` 这类"本来要用后来没用"的东西）。**代码里不得有未使用变量**是硬要求。

### 练习 3：图层透明度 + 顺序调整面板（周五，约 2.5 h）

**前置检查**：
- [ ] `npm run dev` 跑着，页面上已有底图 + 至少 2 个矢量图层（练习 1 的产物）
- [ ] 已读 [main.js](../projects/webgis-starter/src/main.js) 第 54~72 行，看懂现有"图层开关 + 全局透明度滑条"是怎么写的（本练习是升级它，不是替换它）
- [ ] 控制台里 `gis.map.getLayers().getArray().length` 返回的数字与页面上图层数一致（确认拿得到图层集合）

**为什么做**：把 `map.getLayers()` 这个集合从"黑盒"变成"你能操控的东西"，顺带搞清"数组顺序 = 叠图顺序"和 `zIndex` 的关系。

现有底子（先读再改，别推倒）：[main.js](../projects/webgis-starter/src/main.js) 第 54~72 行已经做了"图层开关 + 一根**全局**透明度滑条"。本周要升级成**每个图层独立**的透明度，再加顺序调整。

```js
// src/layer-panel.js（新建）
export function setupLayerPanel(map, items /* [{label, layer}] */) {
  // 1) 每项：label + 上下移按钮 + 一个 range（0~100）
  items.forEach(({label, layer}) => {
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `/* TODO: checkbox + 名称 + ↑ ↓ + <input type="range" min="0" max="100"> */`;
    // TODO: range 的 input 事件 → layer.setOpacity(Number(v) / 100)
    // TODO: checkbox → layer.setVisible(...)
    row.querySelector('input[type="range"]').addEventListener('input', (e) => {
      layer.setOpacity(Number(e.target.value) / 100); // 注意：0~1，别传 100
    });
  });

  // 2) 顺序：优先用数组顺序（getLayers().getArray().indexOf(layer) + Collection.insertAt）
  function move(layer, dir /* +1 上移 / -1 下移 */) {
    const collection = map.getLayers();
    const arr = collection.getArray();
    const i = arr.indexOf(layer);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return; // 越界别动
    // TODO: collection.remove(layer); collection.insertAt(j, layer);
    // TODO: 面板列表同步重排（DOM 顺序必须和图层顺序一致，否则用户会以为没生效）
    // TODO: 透明度/开关状态从 layer.getOpacity()/getVisible() 回读，别从 DOM 猜
  }
  // 3) 备选：layer.setZIndex(n) —— 只在"不想真的重排数组"时用。
  //    ⚠️ 底图与标注分层：底图 z 序 0，数据 1，高亮 2，提示层 3，避免数据被底图盖住
}
```

**预期现象**：滑条拉某个图层，**只有**那层变淡；↑↓ 能把"面"层放到"点"层下面，标注被盖住的顺序问题肉眼可见地解决。

**完成自查**：
- [ ] 透明度每层独立（拉 A 层 B 层不变）
- [ ] ↑↓ 后 DOM 列表顺序与 Console 里 `getLayers()` 顺序一致
- [ ] 刷新页面后状态能从 layer 回读（不是从 DOM 猜）

**做对了的标志**：刷新页面后把面板状态与 `map.getLayers().getArray().map(l => l.get('name'))` 逐一对上；`console.log(layer.getOpacity())` 与滑条数值一致。

### 练习 4：`ol/sphere` 复现测距（周六，约 2 h，把"看懂"变成"能重写"）

**前置检查**：
- [ ] 已读 [draw.js](../projects/webgis-starter/src/draw.js) 第 22 行的 import 与第 47~64 行 `measureLabel`（知道现成实现在哪、长什么样）
- [ ] 页面上原测距工具能正常用（先确认"标准答案"能跑，再写你的复现版）
- [ ] 准备一条已知长度的线做基准：W1 实测广州东西向 1° 经度 = 102,424.576 m（week01.md 第十四节），你的实现算出来应和它同量级

**为什么做**：`draw.js` 第 22 行 `import {getArea, getDistance, getLength} from 'ol/sphere.js'` 与第 47~64 行 `measureLabel` 是现成实现。本周要求你自己实现一遍并**验证结果一致**——这一遍的价值是让你把 W1 的"墨卡托不能直接量"变成肌肉记忆，同时练事件的添加与移除。

```js
// src/my-measure.js（新建）
import {getDistance, getArea} from 'ol/sphere.js';
import {toLonLat} from 'ol/proj.js';

/** 折线长度：逐段大圆距离累加 */
export function myGetLength(geometry) {
  let total = 0;
  // TODO: LineString -> geometry.getCoordinates()；MultiLineString -> 包一层再套
  // TODO: for (let i = 1; i < coords.length; i++) total += getDistance(coords[i-1], coords[i]);
  return total;
}

/** 面面积：鞋带公式算出【平面】面积后，交给 getArea 做球面面积 */
export function myRingArea(ring) {
  let sum = 0;
  // TODO: 闭合环求和 sum += (p[i].x * p[i+1].y) - (p[i+1].x * p[i].y)；Math.abs(sum/2)
  return sum;
}
// 然后 getArea(geometry) 直接用（它内部就是这个思路 + 球面半径）
export function myPolygonArea(geometry) {
  // TODO: 外环面积 - 内环（洞）面积；用 myRingArea 算环，用 getArea 校准
}

export function installMyMeasure(map, view, source) {
  // 方案：先临时摘除 DragBox 交互，再自己拼 click / pointermove
  const interactions = map.getInteractions();
  const dragBox = /* TODO: 遍历找到 'DragBox' */;
  if (dragBox) map.removeInteraction(dragBox);
  const keys = [];
  // TODO: keys.push(map.on('singleclick', ...))  累加点击点到 source 的 sketch 要素
  // TODO: keys.push(map.on('pointermove', ...))  实时把最后一点 + 鼠标点算进长度，更新 Overlay 文本
  return function uninstall() {
    if (dragBox) map.addInteraction(dragBox);
    keys.forEach((key) => map.un(key.type, key.listener)); // 关键：成对，不留残留监听
  };
}
```

**必做对照组（这是"复现"两字的含义）**：

1. 画同一条线（建议用广州塔 → 白云山，约 10+ km）：你的 `myGetLength` vs `gis.tools` 里测距结果（同一个几何）——**误差应 < 1 m**。
2. 把两个 3857 坐标直接 `Math.hypot(dx, dy)` 算一遍，与球面值对比，记录百分比差异；对照 W1 结论（广州纬度膨胀约 8.7%、挪威约 103%）验证"膨胀率 = 1/cos(纬度)"在实测里成立。
3. 面：对一个区县多边形，`myRingArea`（平面）vs `getArea`（球面）vs QGIS 字段计算器 `$area`（椭球，记得把工程椭球设成 WGS 84，否则你会撞上周 W1 的坑 N9），三者差异写进笔记并解释来源（球 vs 椭球 vs 平面）。

**做对了的标志**：三个数都能说清"为什么不一样"；切走测距工具后，点击弹窗功能立刻恢复正常（证明事件没留残留）。

**完成自查**：
- [ ] 同一几何：`myGetLength` vs starter 测距结果误差 < 1 m
- [ ] 平面 `Math.hypot` vs 球面值对比，百分比与 `1/cos(纬度)` 理论吻合
- [ ] `uninstall()` 后弹窗恢复、Console 无重复触发

---

## 3. 验收标准（全过才算 W4 通关）

**主计划三条，一条不能少：**

- [ ] 能**从零**新建一个图层并加载本地 GeoJSON，**不看教程**（现场重写一遍 15 行以内的代码，含 `VectorLayer` + `VectorSource` + `GeoJSON().readFeatures` + `addFeatures`）
- [ ] 能解释 `dataProjection` 与 `featureProjection` 分别在什么时候起作用（用 1.2 的 A/B/C/D 四种情况举例，并说出 `readFeatures` 与 `writeFeatures` 里方向相反这点）
- [ ] 侧边栏过滤功能可用，**代码里没有留下未使用的变量**（VS Code 逐个文件走查一遍，把截图或走查清单贴进 `notes/week04.md`）

**本周加严项：**

- [ ] 示例数据已全换成 W2 你自己的数据，配色和标注是改过的（截图对比 W3 时期的界面）
- [ ] 图层面板的透明度是**每层独立**的，↑↓ 顺序调整后 DOM 列表与 `getLayers()` 顺序一致
- [ ] `ol/sphere` 自实现测距与项目结果误差 < 1 m，且有平面 vs 球面 vs 椭球三值对比表
- [ ] 高亮方案写了取舍说明（≥200 字），并说清侧边栏为什么不该用 `Overlay`
- [ ] 产出物已提交 Git：`projects/ol-lab/` + `notes/week04.md`（坑表延续 [week01.md](../notes/week01.md) 第二节格式）

---

## 4. 坑预告（按你的环境定制，遇到就回来打勾）

| # | 预判的坑 | 症状 | 解法 |
| --- | --- | --- | --- |
| P1 | `import Map from 'ol/Map.js'` 遮蔽内置 `Map` | `dataLayers.values is not a function`（W0 坑 #2 复刻：你 `cp` 出来的新包里如果动了 map.js 导入名就会复发） | 一律 `import OlMap from 'ol/Map.js'`，照抄 [map.js](../projects/webgis-starter/src/map.js) 第 10~13 行的注释做法 |
| P2 | 数据真实坐标系不是 4326 | 图层跑到太平洋 / 缩在原点 / 一片空白但 Console 无报错 | 别目测：`ogrinfo -so -al` 看源 CRS；或浏览器里 `json.features[0].geometry.coordinates` 看数值量级（度级 ≈ 两位/三位数字，米级 ≈ 七位数字）。再按 1.2 的表选 `dataProjection` |
| P3 | EPSG:4490 / 4523 未注册 | `Unknown projection: EPSG:4523`、`readFeatures` 抛错 | `npm install proj4` → `register(proj4)` → `proj4.defs('EPSG:4523', '…')`，见练习 1 步骤 6 |
| P4 | 数组/对象解构搞混 | `Cannot read properties of undefined (reading 'toFixed')`（W0 坑 #3 复刻） | `fromLonLat/toLonLat/transform` 返回**数组**：`const [x, y] = fromLonLat([...])`。`feature.getGeometry()` 返回几何对象，别解构 |
| P5 | 绘制工具没退出，弹窗"失灵" | 点要素没反应，或画点时同时弹出属性 | `Draw`/`Select` 会抢事件；处理函数开头加 `if (tools.getTool().tool) return;`，或退出绘制再点（见 1.6） |
| P6 | 过滤用 `removeFeature` 后"数据没了" | 状态栏要素计数变少（main.js `refreshCounts` 会诚实反映）、导出 GeoJSON 缺要素、撤销失效 | 这是**特性不是 bug**；要"可逆"就缓存原始 Feature 数组，恢复时 `addFeature` 放回去。想省事就改用 Style 函数返回 `null` |
| P7 | 高亮把原图层搞乱 | `feature.setStyle(tmp)` 后取消高亮，要素变成默认蓝点或消失 | `feature.setStyle(undefined)`（不是 `null`）才回到图层样式；或者干脆用专用高亮图层 + `clone()`，见练习 2 |
| P8 | `setOpacity` 传了 0~100 | 图层完全不可见或毫无变化 | OL 要 0~1：`layer.setOpacity(v / 100)`，main.js 第 68~71 行就是这么写的 |
| P9 | `getLayers().push()` 报错 | `collection.push is not a function` | `map.getLayers()` 是 OL `Collection`，用 `insertAt(index, layer)` / `remove(layer)`，`getArray()` 只读 |
| P10 | 事件没成对移除 | 切走测距工具后，普通点击仍触发残留逻辑，或重复弹窗（一个 click 弹 N 次 = 加了 N 个 listener） | `map.on(...)` 的返回值全部存进数组，`uninstall()` 里 `map.un(key.type, key.listener)`；`DragBox` 也要 `addInteraction` 回去 |
| P11 | 拖入/复制文件后路径不对 | 404：`加载 data/xxx.geojson 失败：HTTP 404` | 文件必须在 `public/data/` 下，`fetch` 用 `/data/xxx.geojson`（`public` 前缀不写）。`cd` 用 `/d/xx/...`（W0 坑 #8） |
| P12 | 国外底图 / raw.githubusercontent.com 时通时断 | 请求超时、连接重置、示例数据下不下来 | W0 笔记第六节：Steam++ 的 hosts 加速没开，先启动它（`github.com`、`raw.githubusercontent.com` 都在它托管的 hosts 里） |

---

## 5. 本周产出物结构（提交到 Git）

```
projects/ol-lab/                  # 从 webgis-starter 复制后改造，保留原始 starter 作对照
├─ index.html                     # 新增 <aside id="sidebar"> 面板与图层面板容器
├─ src/
│  ├─ main.js                     # 接线：侧边栏、过滤器、图层面板、自实现测距
│  ├─ map.js                      # SAMPLE_LAYERS 换成你的数据；loadGeoJSONFile 保持双投影显式声明
│  ├─ sidebar.js                  # 练习 2A：点击 → 候选要素列表 → 属性表格
│  ├─ filter.js                   # 练习 2B：按属性过滤 + 命中范围提示
│  ├─ layer-panel.js              # 练习 3：每层透明度 + ↑↓ 顺序（Collection.insertAt）
│  ├─ my-measure.js               # 练习 4：自实现 getLength / ringArea + 安装/卸载
│  ├─ styles.js                   # 你的新配色与标注（保留 whiteHalo）
│  └─ basemaps.js                 # 基本不动；天地图 key 走 .env（W6 主题）
└─ public/data/
   └─ guangzhou_slim.geojson      # W2 产物，本周主角

notes/week04.md                   # 七个零件的 Console 实验记录 + 四投影坑表 + 验收自检
projects/ol-lab/README.md         # 高亮方案取舍（≥200 字）+ 侧边栏 vs 弹窗的差异说明
```

---

## 6. W4 结束后的下一步预告（W5：可视化与矢量瓦片）

W4 你只做了"一种样式一种数据"。W5 要解决两个新问题：**同一个字段，用什么分级方法/什么色带，会让读者得出不同结论**（分级设色 + 图例三件套）；**当点太多时，`Cluster` 和 `Heatmap` 各自会怎么"骗人"**。同时接住 W3 埋的伏笔：矢量瓦片（MVT/PBF）到底把"切片"和"样式"怎么分开——这决定了 W9 的性能路线。另外你本周写的侧边栏属性表，W5 会逼你换成矢量瓦片图层再实现一次，你会发现"拿不到全部要素"，那时候你会真正理解 MVT 的代价。

> 纪律不变：卡住 2 小时 → 记坑表 → 跳过。过程记录写进 `notes/week04.md`，通关后回来更新 [README 进度表](../README.md)。
