/**
 * 交互工具模块：绘制 / 修改 / 捕捉 / 测量 / 拖拽导入 / 导出 GeoJSON。
 *
 * 几个容易踩坑的点写在这里，方便对照代码看：
 *  1. Draw、Modify、Snap 都是"交互（Interaction）"，加到 map 上就生效；
 *     Snap 负责把节点吸附到已有要素，画相邻地块时非常有用。
 *  2. 测距 / 测面积不能只算平面距离：Web 墨卡托在高纬度会严重变形，
 *     必须用 ol/sphere 的 getLength / getArea 做球面计算。
 *  3. Circle 几何不是 GeoJSON 标准类型，导出前要用 fromCircle 转成 Polygon。
 *  4. 拖拽导入支持 GeoJSON / TopoJSON / KML / GPX；Shapefile(zip) 需自行引入 shpjs。
 */
import DragAndDrop from 'ol/interaction/DragAndDrop.js';
import {Draw, Modify, Snap} from 'ol/interaction.js';
import Overlay from 'ol/Overlay.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import {GPX, KML, TopoJSON} from 'ol/format.js';
import {fromCircle} from 'ol/geom/Polygon.js';
import {isEmpty} from 'ol/extent.js';
import {toLonLat} from 'ol/proj.js';
import {getArea, getDistance, getLength} from 'ol/sphere.js';

import {drawStyle, importedStyle, measureStyle} from './styles.js';
import {WGS84, WEB_MERCATOR} from './map.js';

/** 米 -> 可读长度 */
export function formatLengthMeters(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`;
}

/** 平方米 -> 可读面积 */
export function formatAreaSquareMeters(sqm) {
  if (sqm >= 1e6) return `${(sqm / 1e6).toFixed(3)} km²`;
  if (sqm >= 1e4) return `${(sqm / 1e4).toFixed(2)} 公顷`;
  return `${sqm.toFixed(0)} m²`;
}

/** 圆的真实球面半径（3857 平面半径在非赤道区域不等于地面距离） */
function circleRadiusMeters(circle) {
  const center = circle.getCenter();
  const edge = [center[0] + circle.getRadius(), center[1]];
  return getDistance(toLonLat(center), toLonLat(edge));
}

/** 计算测量要素的文字说明 */
function measureLabel(feature) {
  const geometry = feature.getGeometry();
  if (!geometry) return '';
  const type = geometry.getType();
  const tool = feature.get('measureType');

  if (tool === 'LineString' && (type === 'LineString' || type === 'MultiLineString')) {
    return `长度 ${formatLengthMeters(getLength(geometry))}`;
  }
  if (type === 'Circle') {
    const radius = circleRadiusMeters(geometry);
    return `半径 ${formatLengthMeters(radius)} · 面积 ${formatAreaSquareMeters(Math.PI * radius * radius)}`;
  }
  if (type === 'Polygon' || type === 'MultiPolygon') {
    return `面积 ${formatAreaSquareMeters(getArea(geometry))}`;
  }
  return '';
}

/**
 * 装配绘制工具
 * @param {import('ol/Map.js').default} map
 * @param {import('ol/View.js').default} view
 */
export function setupDrawTools(map, view) {
  // 绘制结果图层
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    properties: {name: '绘制 / 测量', kind: 'draw'},
    style: (feature) => (feature.get('measureType') ? measureStyle(feature) : drawStyle(feature)),
  });
  map.addLayer(layer);

  // 捕捉 + 修改：绘制完可以继续拖动节点
  map.addInteraction(new Snap({source}));
  const modify = new Modify({source});
  map.addInteraction(modify);

  // 拖拽导入图层
  const importSource = new VectorSource();
  const importLayer = new VectorLayer({
    source: importSource,
    style: importedStyle,
    properties: {name: '拖拽导入', kind: 'import'},
  });
  map.addLayer(importLayer);

  map.addInteraction(
    new DragAndDrop({
      source: importSource,
      formatConstructors: [GeoJSON, KML, GPX, TopoJSON],
    }),
  );

  // 测量提示气泡
  const tooltipElement = document.getElementById('measure-tooltip');
  const tooltip = new Overlay({
    element: tooltipElement,
    offset: [0, -14],
    positioning: 'bottom-center',
    stopEvent: false,
  });
  map.addOverlay(tooltip);

  let draw = null;
  let currentTool = null; // 'Point' | 'LineString' | 'Polygon' | 'Circle' | null
  let currentMeasure = false;
  let tracking = null; // 正在绘制的 {feature, geometry}

  function refreshTooltip() {
    if (!tracking) return;
    const text = measureLabel(tracking.feature);
    tooltipElement.textContent = text;
    const geometry = tracking.geometry;
    const anchor = geometry.getType() === 'Circle' ? geometry.getCenter() : geometry.getLastCoordinate();
    if (anchor) tooltip.setPosition(anchor);
  }

  function deactivate() {
    if (draw) {
      map.removeInteraction(draw);
      draw = null;
    }
    tracking = null;
    currentTool = null;
    currentMeasure = false;
    tooltipElement.textContent = '';
    tooltip.setPosition(undefined);
  }

  function activate(type, {measure = false} = {}) {
    deactivate();
    currentTool = type;
    currentMeasure = measure;

    draw = new Draw({
      source,
      type,
      style: (feature) => (measure ? measureStyle(feature) : drawStyle(feature)),
    });

    draw.on('drawstart', (event) => {
      const feature = event.feature;
      if (measure) feature.set('measureType', type);
      tracking = {feature, geometry: feature.getGeometry()};
      tracking.geometry.on('change', refreshTooltip);
      refreshTooltip();
    });

    draw.on('drawend', (event) => {
      const feature = event.feature;
      if (measure) feature.set('__label', measureLabel(feature));
      tracking = null;
      tooltipElement.textContent = '';
      tooltip.setPosition(undefined);
      feature.setId(`draw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    });

    map.addInteraction(draw);
    return currentTool;
  }

  // 拖动节点后重新计算测量文字
  modify.on('modifyend', (event) => {
    event.features.forEach((feature) => {
      if (feature.get('measureType')) {
        feature.set('__label', measureLabel(feature), true);
        feature.changed();
      }
    });
  });

  // 拖入数据后自动定位到数据范围
  importSource.on('addfeatures', (event) => {
    if (!event.features?.length) return;
    const extent = importSource.getExtent();
    if (!isEmpty(extent)) {
      view.fit(extent, {padding: [90, 90, 90, 90], maxZoom: 15, duration: 500});
    }
  });

  return {
    layer,
    source,
    importLayer,
    importSource,

    activate,
    deactivate,

    /** 当前工具名，用于面板高亮 */
    getTool: () => ({tool: currentTool, measure: currentMeasure}),

    /** 清空绘制 / 测量结果 */
    clear() {
      source.clear();
      tooltipElement.textContent = '';
      tooltip.setPosition(undefined);
    },

    /** 清空拖拽导入的数据 */
    clearImported() {
      importSource.clear();
    },

    /** 导出绘制结果为 WGS84 的 GeoJSON 文本（圆会转成 64 边形） */
    exportGeoJSON() {
      const features = source.getFeatures().map((feature) => {
        const geometry = feature.getGeometry();
        if (geometry?.getType() === 'Circle') {
          const clone = feature.clone();
          clone.setGeometry(fromCircle(geometry, 64));
          return clone;
        }
        return feature;
      });
      if (!features.length) return null;

      const text = new GeoJSON().writeFeatures(features, {
        dataProjection: WGS84,
        featureProjection: WEB_MERCATOR,
        decimals: 6,
      });
      return JSON.stringify(JSON.parse(text), null, 2);
    },
  };
}
