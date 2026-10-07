# WebGIS Starter · Vite + OpenLayers

一个可以直接跑起来的 WebGIS 学习起步项目：**底图切换、矢量图层、要素弹窗、绘制/测量、GeoJSON 导入导出、坐标与投影换算**。
所有功能都拆成了独立小模块，方便对着代码学 OpenLayers。

---

## 快速开始

```powershell
cd webgis-starter
pnpm install          # 或 npm install / yarn
pnpm dev              # 打开 http://127.0.0.1:5173
```

生产构建与预览：

```powershell
pnpm build
pnpm preview          # 预览 dist 产物
```

> 本项目已在 Node 24 + pnpm 12 下验证通过。

---

## 目录结构

```
webgis-starter/
├─ index.html                    # 页面骨架：地图容器 + 控制面板 + 状态栏 + Overlay 元素
├─ vite.config.js                # 端口、base、GeoServer 代理
├─ .env.example                  # 天地图 key 模板（复制成 .env）
├─ public/data/                  # 静态示例数据，dev/build 都能直接 fetch
│  ├─ sample-points.geojson      # 10 个城市点
│  ├─ sample-lines.geojson       # 高铁 / 长江折线
│  └─ sample-polygons.geojson    # 面（含带洞 Polygon）
└─ src/
   ├─ main.js                    # 入口：把地图与面板 UI 接起来（先读这个）
   ├─ map.js                     # Map/View、底图与矢量图层、要素弹窗、状态栏、定位标记
   ├─ draw.js                    # Draw/Modify/Snap、测量、拖拽导入、导出 GeoJSON
   ├─ basemaps.js                # 各底图瓦片源配置（含天地图模板）
   ├─ styles.js                  # 点/线/面/绘制/测量样式
   └─ style.css                  # UI 与 OpenLayers 控件样式
```

推荐阅读顺序：`main.js` → `map.js` → `draw.js` → `styles.js` / `basemaps.js`。

---

## 功能 ↔ 知识点对照

| 功能 | 代码位置 | 学到的概念 |
|---|---|---|
| 底图切换 | `basemaps.js` + `main.js` | 瓦片金字塔、`{z}/{x}/{y}`、`{z}/{y}/{x}` 差异、XYZ 源 |
| 加载 GeoJSON | `map.js → loadGeoJSONFile` | `dataProjection` / `featureProjection` 双向投影 |
| 点/线/面样式 | `styles.js` | `Style` 函数式样式、`Text` 标注、白色描边防压盖 |
| 点击要素弹窗 | `map.js → singleclick` | `forEachFeatureAtPixel`、`layerFilter`、`Overlay` 锚定 DOM |
| 鼠标经纬度 | `map.js → pointermove` | `toLonLat` 反投影、状态栏联动 |
| 绘制 / 修改 / 捕捉 | `draw.js` | `Draw`、`Modify`、`Snap` 三种交互 |
| 测距 / 测面积 | `draw.js → measureLabel` | `ol/sphere` 球面长度与面积（墨卡托不能直接量算） |
| 拖拽加载文件 | `draw.js → DragAndDrop` | 本地文件解析、`addfeatures` 后 `view.fit` 自动定位 |
| 导出 GeoJSON | `draw.js → exportGeoJSON` | 要素投影回 WGS84、`Circle → Polygon`（`fromCircle`） |
| 定位与投影换算 | `main.js → updateProjInfo` | EPSG:4326 ↔ EPSG:3857 数值、XYZ 瓦片编号计算 |
| 比例尺 / 鹰眼 / 全屏 | `map.js → controls` | `ol/control` 内置控件 |

---

## 常用坐标系统（务必分清）

| 代号 | 名称 | 用途 |
|---|---|---|
| `EPSG:4326` | WGS84 经纬度 | 数据存储、接口交换、GeoJSON 默认 |
| `EPSG:3857` | Web 墨卡托（米） | 地图渲染、瓦片底图 |
| `EPSG:4490` | CGCS2000 | 国内测绘标准，与 WGS84 在本项目精度下视为一致 |

国内互联网底图额外注意：**高德/腾讯用 GCJ-02、百度用 BD-09**，与 WGS84 有几十到几百米偏移，
和 WGS84 矢量叠加会整体错位；要做合规项目请用天地图或自行申请正规底图服务。

---

## 用天地图底图（可选）

1. 到 <https://console.tianditu.gov.cn/> 免费申请浏览器端 key；
2. 复制 `.env.example` 为 `.env`，填入 `VITE_TIANDITU_KEY=你的key`；
3. 重启 `pnpm dev`，底图列表会多出「天地图·矢量 / 天地图·影像」。

---

## 下一步可以往上加的（进阶路线）

1. **接后端服务**：本地用 Docker 起 GeoServer，把 PostGIS 表发布成 WMS/WFS，前端用
   `ol/source/TileWMS` 或 `/geoserver` 代理（已在 `vite.config.js` 配好代理）。
2. **空间数据库**：`docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgis/postgis:16-3.4`，
   用 QGIS 往库里灌数据，再用 `ST_*` 函数做缓冲区、相交分析。
3. **矢量瓦片**：`ogrisel/tippecanoe` 切 `.mbtiles`，配 `maplibre-gl` 或 `ol/source/VectorTile` + `MVT` 格式。
4. **三维**：CesiumJS 加载倾斜摄影 / 3D Tiles。
5. **大数据量可视化**：deck.gl 的 `ScatterplotLayer` / `HexagonLayer`。
6. **前端空间分析**：`@turf/turf` 做缓冲区、最近点、面合并。
7. **Shapefile 支持**：`pnpm add shpjs`，在 DragAndDrop 前把 zip 解成 GeoJSON。

---

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 底图一片空白 / 404 | 瓦片服务被墙或 URL 顺序写错；Esri 是 `{z}/{y}/{x}`，务必别写成 `{z}/{x}/{y}` |
| 图层整体错位几十~几百米 | 底图是 GCJ-02/BD-09，数据是 WGS84，需要纠偏或换天地图 |
| 测量数值明显偏大 | 用了平面距离；本项目已用 `ol/sphere` 做球面计算，自定义时注意同样处理 |
| 导出的 GeoJSON 缺圆 | GeoJSON 不支持 `Circle`，`exportGeoJSON` 里已用 `fromCircle(g, 64)` 转多边形 |
| 拖入 shapefile 没反应 | `.shp` 需打包成 zip 并引入 `shpjs` 解析，浏览器不能直接读 `.shp` |
| `pnpm install` 很慢 | `pnpm config set registry https://registry.npmmirror.com` |
| 跨域请求 GeoServer 失败 | 用 `vite.config.js` 里的 `/geoserver` 代理，或在 GeoServer 里开 CORS |

---

## 调试小技巧

页面加载后控制台会挂一个 `window.gis`：

```js
gis.map.getView().setZoom(8);                  // 直接改视图
gis.tools.source.getFeatures().length;         // 看当前绘制了几个要素
gis.map.getLayers().getArray().map(l => l.get('name'));
```

浏览器 DevTools 里打开 **Network** 面板筛选 `png`/`pbf`，能直观看到瓦片是怎么按 `z/x/y` 请求回来的——
这是理解 WebGIS 渲染流程最快的方式。
