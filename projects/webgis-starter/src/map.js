/**
 * 地图核心模块：创建 Map / View、装入底图和示例矢量图层、
 * 处理要素点击弹窗、鼠标坐标与缩放级别显示、定位标记。
 *
 * 坐标系约定（必须记牢）：
 *   EPSG:4326 —— WGS84 经纬度，数据存储 / 接口交换用（GeoJSON 默认）
 *   EPSG:3857 —— Web 墨卡托米制坐标，地图渲染用
 * 两者之间用 ol/proj 的 fromLonLat / toLonLat / transform 互转。
 */
// ⚠️ 故意把 ol/Map.js 重命名为 OlMap：如果写成 `import Map from 'ol/Map.js'`，
// 就会遮蔽 JS 内置的 Map 构造函数，后面 `new Map()` 建出来的不是普通字典，
// 而是 OpenLayers 的地图对象——新手最容易踩、报错又最难懂的坑之一。
import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import Overlay from 'ol/Overlay.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import {defaults as defaultControls, FullScreen, OverviewMap, ScaleLine} from 'ol/control.js';
import {fromLonLat, toLonLat, transform} from 'ol/proj.js';

import {basemaps} from './basemaps.js';
import {lineStyle, markerStyle, pointStyle, polygonStyle} from './styles.js';

export const WGS84 = 'EPSG:4326';
export const WEB_MERCATOR = 'EPSG:3857';

/** 示例数据图层定义：id -> 文件与样式 */
const SAMPLE_LAYERS = [
  {id: 'points', label: '城市点位（点）', file: 'data/sample-points.geojson', style: pointStyle, visible: true},
  {id: 'lines', label: '高铁 / 长江（线）', file: 'data/sample-lines.geojson', style: lineStyle, visible: true},
  {id: 'polygons', label: '湖泊 / 管理区（面）', file: 'data/sample-polygons.geojson', style: polygonStyle, visible: true},
];

/** 读取 GeoJSON 文件并写入图层（注意同时声明数据投影和要素投影） */
async function loadGeoJSONFile(url, layer) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`加载 ${url} 失败：HTTP ${response.status}`);
  const json = await response.json();
  const features = new GeoJSON().readFeatures(json, {
    dataProjection: WGS84,
    featureProjection: WEB_MERCATOR,
  });
  layer.getSource().addFeatures(features);
  return features.length;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char],
  );
}

/** 渲染要素属性表；没有属性时退化为显示几何类型 */
function renderPopupContent(feature, layerName) {
  const entries = Object.entries(feature.getProperties()).filter(
    ([key, value]) =>
      key !== 'geometry' &&
      !key.startsWith('__') &&
      key !== 'measureType' &&
      value !== undefined &&
      value !== null &&
      typeof value !== 'object',
  );

  const title = feature.get('name') ?? feature.getGeometry()?.getType() ?? '要素';
  const rows = entries
    .filter(([key]) => key !== 'name')
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');

  return (
    `<h3>${escapeHtml(title)}</h3>` +
    `<dl><dt>图层</dt><dd>${escapeHtml(layerName)}</dd>` +
    `<dt>几何类型</dt><dd>${escapeHtml(feature.getGeometry()?.getType() ?? '-')}</dd>` +
    `${rows}</dl>`
  );
}

/**
 * 创建地图上下文
 * @param {string} target 地图容器 id
 * @param {{onToast?: (message: string) => void}} [options]
 */
export async function createMap(target = 'map', options = {}) {
  const toast = options.onToast ?? (() => {});

  // 1) 底图图层：一次全部创建，靠 visible 切换（切底图不用重建图层）
  const basemapLayers = basemaps.map((item) => item.create());

  // 2) 示例矢量图层
  const dataLayers = new Map();
  for (const def of SAMPLE_LAYERS) {
    const layer = new VectorLayer({
      source: new VectorSource(),
      style: def.style,
      visible: def.visible,
      properties: {name: def.label, kind: 'data'},
    });
    dataLayers.set(def.id, {...def, layer});
  }

  // 3) 定位标记图层
  const markerSource = new VectorSource();
  const markerLayer = new VectorLayer({source: markerSource, style: markerStyle, properties: {kind: 'marker'}});

  const view = new View({
    center: fromLonLat([109.5, 33.5]),
    zoom: 4.2,
    minZoom: 2,
    maxZoom: 19,
    constrainResolution: false,
  });

  // 这里用 OlMap（OpenLayers 的地图）；上面的 dataLayers 用的是内置 Map（普通字典）
  const map = new OlMap({
    target,
    view,
    layers: [...basemapLayers, ...[...dataLayers.values()].map((item) => item.layer), markerLayer],
    controls: defaultControls({attributionOptions: {collapsible: true}}).extend([
      new ScaleLine({bar: false, steps: 2, text: true, minWidth: 80}),
      new FullScreen(),
      // 鹰眼图：不传 layers 时 OpenLayers 默认用一层 OSM 作为缩略底图
      new OverviewMap({collapsed: true}),
    ]),
  });

  // 4) 加载示例数据（失败不影响地图可用）
  await Promise.all(
    [...dataLayers.values()].map(async (item) => {
      try {
        const count = await loadGeoJSONFile(item.file, item.layer);
        item.count = count;
      } catch (error) {
        item.count = 0;
        // eslint-disable-next-line no-console
        console.error(error);
        toast(`示例数据 ${item.file} 加载失败，请检查 public/ 目录`);
      }
    }),
  );

  // 5) 要素弹窗（Overlay：把 DOM 元素锚定到地图坐标上）
  const popup = new Overlay({
    element: document.getElementById('popup'),
    positioning: 'bottom-center',
    offset: [0, -14],
    autoPan: {animation: {duration: 200}},
  });
  map.addOverlay(popup);

  const popupContent = document.getElementById('popup-content');
  document.getElementById('popup-closer')?.addEventListener('click', (event) => {
    event.preventDefault();
    popup.setPosition(undefined);
  });

  const pickableKinds = new Set(['data', 'draw', 'import']);
  const layerFilter = (layer) => pickableKinds.has(layer.get('kind'));
  const hitOptions = {hitTolerance: 6, layerFilter};

  map.on('singleclick', (event) => {
    if (event.dragging) return;
    const feature = map.forEachFeatureAtPixel(event.pixel, (item) => item, hitOptions);
    if (!feature) {
      popup.setPosition(undefined);
      return;
    }
    const layer = map
      .getLayers()
      .getArray()
      .find((item) => item.getSource?.()?.hasFeature?.(feature));
    popupContent.innerHTML = renderPopupContent(feature, layer?.get('name') ?? '未知图层');
    popup.setPosition(event.coordinate);
  });

  // 6) 鼠标样式：悬停到要素上变成手型
  map.on('pointermove', (event) => {
    if (event.dragging) return;
    const hit = map.hasFeatureAtPixel(event.pixel, hitOptions);
    const element = map.getTargetElement();
    if (element) element.style.cursor = hit ? 'pointer' : '';
  });

  // 7) 状态栏：经纬度 / 墨卡托坐标 / 缩放级别
  const coordEl = document.getElementById('status-coord');
  const mercatorEl = document.getElementById('status-mercator');
  const zoomEl = document.getElementById('status-zoom');

  map.on('pointermove', (event) => {
    const [lon, lat] = toLonLat(event.coordinate);
    if (coordEl) coordEl.textContent = `经度 ${lon.toFixed(5)} · 纬度 ${lat.toFixed(5)}`;
    if (mercatorEl) {
      mercatorEl.textContent = `EPSG:3857 x ${event.coordinate[0].toFixed(0)} y ${event.coordinate[1].toFixed(0)}`;
    }
  });

  const syncZoom = () => {
    if (zoomEl) zoomEl.textContent = `缩放 ${(view.getZoom() ?? 0).toFixed(2)}`;
  };
  view.on('change:resolution', syncZoom);
  syncZoom();

  return {
    map,
    view,
    basemaps,
    basemapLayers,
    dataLayers,
    markerSource,
    markerLayer,
    popup,
    popupContent,
    WGS84,
    WEB_MERCATOR,

    /** 切换底图 */
    setBasemap(id) {
      basemaps.forEach((item, index) => {
        basemapLayers[index].setVisible(item.id === id);
      });
    },

    /** 更新面板底部的要素统计 */
    updateCounts(totalElements) {
      const dataCount = [...dataLayers.values()].reduce(
        (sum, item) => sum + item.layer.getSource().getFeatures().length,
        0,
      );
      const el = document.getElementById('status-count');
      if (el) el.textContent = `要素 ${dataCount}（示例） + 绘制/拖入 ${totalElements}`;
    },
  };
}

/** 经纬度 -> 墨卡托，供面板做投影换算演示 */
export function lonLatToMercator(lon, lat) {
  const [x, y] = transform([Number(lon), Number(lat)], WGS84, WEB_MERCATOR);
  return {x, y};
}

/** 墨卡托 -> 经纬度 */
export function mercatorToLonLat(x, y) {
  return toLonLat([Number(x), Number(y)]);
}
