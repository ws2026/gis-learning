/**
 * 样式集中管理：OpenLayers 的 Style 是按"要素 + 分辨率"计算的，
 * 这里用颜色常量 + 工厂函数，方便对照学习。
 */
import {Circle as CircleStyle, Fill, Stroke, Style, Text} from 'ol/style.js';

export const theme = {
  point: '#2563eb',
  line: '#16a34a',
  polygon: '#f59e0b',
  draw: '#e11d48',
  measure: '#7c3aed',
  imported: '#0ea5e9',
  marker: '#dc2626',
  label: '#0f172a',
};

const whiteHalo = () => new Stroke({color: 'rgba(255,255,255,0.9)', width: 3});

/** 点样式：圆点 + 名称标注（label 带白色描边，避免压在底图上看不清） */
export function pointStyle(feature) {
  const name = feature.get('name');
  return new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({color: theme.point}),
      stroke: new Stroke({color: '#ffffff', width: 2}),
    }),
    text: name
      ? new Text({
          text: String(name),
          offsetY: -20,
          font: '12px "Microsoft YaHei", system-ui, sans-serif',
          fill: new Fill({color: theme.label}),
          stroke: whiteHalo(),
        })
      : undefined,
  });
}

/** 线样式 */
export function lineStyle(feature) {
  return new Style({
    stroke: new Stroke({color: theme.line, width: 3, lineCap: 'round', lineJoin: 'round'}),
    text: feature.get('name')
      ? new Text({
          text: String(feature.get('name')),
          font: '12px "Microsoft YaHei", system-ui, sans-serif',
          fill: new Fill({color: theme.line}),
          stroke: whiteHalo(),
        })
      : undefined,
  });
}

/** 面样式 */
export function polygonStyle(feature) {
  return new Style({
    stroke: new Stroke({color: theme.polygon, width: 2}),
    fill: new Fill({color: 'rgba(245, 158, 11, 0.25)'}),
    text: feature.get('name')
      ? new Text({
          text: String(feature.get('name')),
          font: '12px "Microsoft YaHei", system-ui, sans-serif',
          fill: new Fill({color: theme.label}),
          stroke: whiteHalo(),
        })
      : undefined,
  });
}

/**
 * 自己绘制的要素样式
 * style 支持传函数：OpenLayers 会为每个要素调用一次，可以按属性返回不同样式。
 */
export function drawStyle() {
  return new Style({
    fill: new Fill({color: 'rgba(225, 29, 72, 0.18)'}),
    stroke: new Stroke({color: theme.draw, width: 3, lineDash: [8, 6]}),
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({color: theme.draw}),
      stroke: new Stroke({color: '#fff', width: 2}),
    }),
  });
}

/**
 * 测距 / 测面积要素样式（紫色，和普通绘制区分开）
 * 绘制结束后把测量结果写进 __label 属性，这里渲染成常驻标注。
 */
export function measureStyle(feature) {
  const label = feature?.get?.('__label');
  return new Style({
    fill: new Fill({color: 'rgba(124, 58, 237, 0.15)'}),
    stroke: new Stroke({color: theme.measure, width: 3}),
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({color: theme.measure}),
      stroke: new Stroke({color: '#fff', width: 2}),
    }),
    text: label
      ? new Text({
          text: String(label),
          font: '600 12px "Microsoft YaHei", system-ui, sans-serif',
          fill: new Fill({color: theme.measure}),
          stroke: new Stroke({color: 'rgba(255,255,255,0.95)', width: 4}),
          overflow: true,
        })
      : undefined,
  });
}

/** 拖拽导入的要素样式 */
export function importedStyle() {
  return new Style({
    fill: new Fill({color: 'rgba(14, 165, 233, 0.2)'}),
    stroke: new Stroke({color: theme.imported, width: 2}),
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({color: theme.imported}),
      stroke: new Stroke({color: '#fff', width: 2}),
    }),
  });
}

/** 定位标记样式 */
export function markerStyle() {
  return new Style({
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({color: 'rgba(220, 38, 38, 0.75)'}),
      stroke: new Stroke({color: '#ffffff', width: 3}),
    }),
  });
}
