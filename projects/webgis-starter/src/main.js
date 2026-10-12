import 'ol/ol.css';
import './style.css';

import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat } from 'ol/proj';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';

// ==========================================
// ⚠️ 修改点 1：数据路径
// 这里必须写 '/data/' 开头，不要写 D:\ 开头的本地路径！
// ==========================================
const geojsonUrl = '/data/gx_fixed.geojson'; 

const vectorLayer = new VectorLayer({
  source: new VectorSource({
    url: geojsonUrl,
    format: new GeoJSON({
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    })
  }),
  style: new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: '#e74c3c' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 })
    }),
    stroke: new Stroke({ color: '#e74c3c', width: 2 }),
    fill: new Fill({ color: 'rgba(231, 76, 60, 0.2)' })
  })
});

new Map({
  target: 'map',
  layers: [
    new TileLayer({ source: new OSM() }),
    vectorLayer
  ],
  view: new View({
    // ==========================================
    // ⚠️ 修改点 2：中心点坐标
    // 改成你家乡的经纬度，我这里写了大概的默认值
    // ==========================================
    center: fromLonLat([108.625, 23.5]), 
    zoom: 9
  })
});