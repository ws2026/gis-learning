/**
 * 底图配置。
 *
 * 关键知识点：
 * 1. 所有 Web 底图都是"瓦片金字塔"，URL 里的 {z}/{x}/{y} 由 OpenLayers 的 XYZ 源自动替换；
 *    ArcGIS 的 REST 切片顺序是 {z}/{y}/{x}（行列颠倒），写错就会花屏或 404。
 * 2. 底图投影固定为 EPSG:3857（Web 墨卡托），经纬度数据由 OpenLayers 在渲染时实时投影转换。
 * 3. 高德 / 腾讯 / 百度等国内底图使用 GCJ-02 / BD-09 加密坐标，与 WGS84 存在几十到几百米偏移，
 *    和 WGS84 矢量数据叠加会"图层对不上"，需要纠偏或用天地图（CGCS2000，接近 WGS84）。
 * 4. 生产环境务必按各家的服务条款申请 key、控制并发，不要直接爬别人的瓦片。
 */
import TileLayer from 'ol/layer/Tile.js';
import OSM from 'ol/source/OSM.js';
import XYZ from 'ol/source/XYZ.js';

const tiandituKey = import.meta.env.VITE_TIANDITU_KEY ?? '';

function xyzLayer({url, attributions, maxZoom = 19, crossOrigin = 'anonymous'}) {
  return new TileLayer({
    source: new XYZ({url, attributions, maxZoom, crossOrigin}),
    visible: false,
  });
}

/** 天地图 WMTS 的 REST 风格地址，可以当普通 XYZ 用 */
function tiandituLayer(layer, attributions) {
  const url =
    `https://t0.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
    `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles` +
    `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${tiandituKey}`;
  return xyzLayer({url, attributions, maxZoom: 18});
}

export const basemaps = [
  {
    id: 'osm',
    label: 'OpenStreetMap（默认）',
    create: () =>
      new TileLayer({
        source: new OSM({crossOrigin: 'anonymous'}),
        visible: true,
      }),
  },
  {
    id: 'carto-light',
    label: 'Carto 浅色（适合叠加数据）',
    create: () =>
      xyzLayer({
        url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap contributors © CARTO',
        maxZoom: 19,
      }),
  },
  {
    id: 'carto-dark',
    label: 'Carto 深色',
    create: () =>
      xyzLayer({
        url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap contributors © CARTO',
        maxZoom: 19,
      }),
  },
  {
    id: 'esri-imagery',
    label: 'Esri 卫星影像',
    create: () =>
      xyzLayer({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: '© Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      }),
  },
  {
    id: 'opentopomap',
    label: 'OpenTopoMap 地形',
    create: () =>
      xyzLayer({
        url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
        attributions: '© OpenTopoMap (CC-BY-SA) © OpenStreetMap contributors',
        maxZoom: 17,
      }),
  },
];

if (tiandituKey) {
  basemaps.push(
    {
      id: 'tianditu-vec',
      label: '天地图·矢量（CGCS2000）',
      create: () =>
        tiandituLayer('vec', '© 天地图 GS(2023)336号'),
    },
    {
      id: 'tianditu-img',
      label: '天地图·影像（CGCS2000）',
      create: () => tiandituLayer('img', '© 天地图 GS(2023)336号'),
    },
  );
} else {
  // 友好提示：申请到 key 后填进 .env 就会自动出现
  // eslint-disable-next-line no-console
  console.info('[webgis-starter] 未配置 VITE_TIANDITU_KEY，天地图底图已跳过。');
}
