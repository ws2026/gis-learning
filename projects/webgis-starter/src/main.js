/**
 * 入口文件：把"地图"和"面板 UI"接起来。
 * 学习顺序建议：main.js（看整体流程） -> map.js（地图与图层） -> draw.js（交互） -> styles.js / basemaps.js
 */
import 'ol/ol.css';
import './style.css';

import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import {fromLonLat} from 'ol/proj.js';

import {createMap} from './map.js';
import {setupDrawTools} from './draw.js';

const TOOL_LABELS = {Point: '点', LineString: '线', Polygon: '面', Circle: '圆'};

let toastTimer = 0;
function showToast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/** 经纬度 -> XYZ 瓦片编号（Web 墨卡托切片规则），理解瓦片金字塔的最直观方式 */
function lonLatToTile(lon, lat, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {x, y, zoom};
}

async function bootstrap() {
  const ctx = await createMap('map', {onToast: showToast});
  const tools = setupDrawTools(ctx.map, ctx.view);

  /* ---------------- 底图切换 ---------------- */
  const basemapList = document.getElementById('basemap-list');
  ctx.basemaps.forEach((item, index) => {
    const label = document.createElement('label');
    label.className = 'row';
    label.innerHTML = `<input type="radio" name="basemap" ${index === 0 ? 'checked' : ''} /><span>${item.label}</span>`;
    label.querySelector('input').addEventListener('change', () => {
      ctx.setBasemap(item.id);
      showToast(`底图：${item.label}`);
    });
    basemapList.append(label);
  });

  /* ---------------- 示例图层开关 + 透明度 ---------------- */
  const layerList = document.getElementById('layer-list');
  ctx.dataLayers.forEach((item) => {
    const label = document.createElement('label');
    label.className = 'row';
    label.innerHTML =
      `<input type="checkbox" ${item.layer.getVisible() ? 'checked' : ''} />` +
      `<span>${item.label}</span>`;
    label.querySelector('input').addEventListener('change', (event) => {
      item.layer.setVisible(event.target.checked);
    });
    layerList.append(label);
  });

  const opacity = document.getElementById('layer-opacity');
  opacity.addEventListener('input', () => {
    const value = Number(opacity.value) / 100;
    ctx.dataLayers.forEach((item) => item.layer.setOpacity(value));
    tools.importLayer.setOpacity(value);
  });

  /* ---------------- 绘制 / 测量 ---------------- */
  const toolButtons = [...document.querySelectorAll('[data-tool]')];
  const activeLabel = document.getElementById('status-active');

  function setActiveButton(button) {
    toolButtons.forEach((item) => item.classList.toggle('active', item === button));
    const state = tools.getTool();
    if (activeLabel) {
      activeLabel.textContent = state.tool
        ? `当前工具：${TOOL_LABELS[state.tool]}${state.measure ? '（测量）' : '（绘制）'}`
        : '当前工具：浏览';
    }
  }

  toolButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tool = button.dataset.tool;
      const measure = button.dataset.measure === '1';
      const state = tools.getTool();

      // 再点一次同一个按钮 = 退出该工具
      if (state.tool === tool && state.measure === measure) {
        tools.deactivate();
        setActiveButton(null);
        showToast('已退出绘制模式');
        return;
      }

      tools.activate(tool, {measure});
      setActiveButton(button);
      const endHint = tool === 'Point' ? '单击落点' : '双击结束，Esc 退出';
      showToast(`${measure ? '测量' : '绘制'}${TOOL_LABELS[tool]}：${endHint}`);
    });
  });

  document.getElementById('btn-stop').addEventListener('click', () => {
    tools.deactivate();
    setActiveButton(null);
    showToast('已退出绘制模式');
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    tools.clear();
    refreshCounts();
  });

  document.getElementById('btn-clear-import').addEventListener('click', () => {
    tools.clearImported();
    refreshCounts();
    showToast('已清空拖入的数据');
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const text = tools.exportGeoJSON();
    if (!text) {
      showToast('还没有可导出的要素，先画一个试试');
      return;
    }
    const blob = new Blob([text], {type: 'application/geo+json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `draw-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('已导出 WGS84（EPSG:4326）GeoJSON');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && tools.getTool().tool) {
      tools.deactivate();
      setActiveButton(null);
    }
  });

  /* ---------------- 定位与投影演示 ---------------- */
  const inputLon = document.getElementById('input-lon');
  const inputLat = document.getElementById('input-lat');
  const projInfo = document.getElementById('proj-info');

  function currentLonLat() {
    const lon = Number(inputLon.value);
    const lat = Number(inputLat.value);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      return null;
    }
    return {lon, lat};
  }

  function updateProjInfo() {
    const value = currentLonLat();
    if (!value) {
      projInfo.textContent = '请输入合法经纬度：经度 -180 ~ 180，纬度 -90 ~ 90';
      return;
    }
    const {lon, lat} = value;
    // 注意：fromLonLat 返回的是【数组】[x, y]，所以要用数组解构 const [x, y]，
    // 写成对象解构 const {x, y} 会得到两个 undefined（数组没有 x/y 属性）。
    const [x, y] = fromLonLat([lon, lat]);
    const tile = lonLatToTile(lon, lat, 12);
    projInfo.textContent = [
      `EPSG:4326  WGS84   经度 ${lon.toFixed(5)}  纬度 ${lat.toFixed(5)}`,
      `EPSG:3857  墨卡托  x ${x.toFixed(2)}  y ${y.toFixed(2)}（单位：米）`,
      `EPSG:4490  CGCS2000 在本例精度下与 WGS84 视为一致`,
      `XYZ 瓦片   z=12  x=${tile.x}  y=${tile.y}  → .../12/${tile.x}/${tile.y}.png`,
    ].join('\n');
  }

  inputLon.addEventListener('input', updateProjInfo);
  inputLat.addEventListener('input', updateProjInfo);

  document.getElementById('btn-locate').addEventListener('click', () => {
    const value = currentLonLat();
    if (!value) {
      showToast('经纬度不合法，请检查输入');
      return;
    }
    const coordinate = fromLonLat([value.lon, value.lat]);
    ctx.markerSource.clear();
    ctx.markerSource.addFeature(new Feature({geometry: new Point(coordinate)}));
    ctx.view.animate({
      center: coordinate,
      zoom: Math.max(ctx.view.getZoom() ?? 4, 12),
      duration: 600,
    });
    showToast(`已定位到 ${value.lon.toFixed(4)}, ${value.lat.toFixed(4)}`);
  });

  /* ---------------- 面板折叠（移动端） ---------------- */
  document.getElementById('panel-toggle').addEventListener('click', () => {
    document.getElementById('panel').classList.toggle('collapsed');
  });

  /* ---------------- 要素统计 ---------------- */
  function refreshCounts() {
    const total = tools.source.getFeatures().length + tools.importSource.getFeatures().length;
    ctx.updateCounts(total);
  }
  tools.source.on('change', refreshCounts);
  tools.importSource.on('change', refreshCounts);
  refreshCounts();
  updateProjInfo();
  setActiveButton(null);

  // 方便在浏览器控制台里调试：window.gis.map / window.gis.tools
  window.gis = {ctx, tools, showToast};
  console.info('[webgis-starter] 就绪：window.gis 可访问 map / tools');
}

bootstrap().catch((error) => {
  console.error(error);
  showToast(`初始化失败：${error.message}`);

  // ⚠️ 这里绝对不能用 `#map.innerHTML = ...` 显示错误：
  // #map 里装着 OpenLayers 渲染出来的画布，覆盖 innerHTML 会把地图整个抹掉
  // （地图会变成一片黑）。所以改成往 #app 里追加一块独立提示。
  if (document.getElementById('boot-error')) return;
  const app = document.getElementById('app');
  if (!app) return;
  const box = document.createElement('div');
  box.id = 'boot-error';
  box.style.cssText =
    'position:absolute;left:340px;top:78px;z-index:40;max-width:520px;padding:14px 16px;' +
    'border:1px solid rgba(248,113,113,.5);border-radius:12px;background:rgba(69,10,10,.92);' +
    'color:#fca5a5;font:13px/1.7 system-ui,"Microsoft YaHei",sans-serif;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.45)';
  box.innerHTML =
    '<b style="color:#fecaca">启动时出错</b><br/>' +
    `${error.message}<br/>` +
    '<span style="color:#fecaca">按 F12 打开 Console 看完整报错，并检查 src/ 下的语法。</span>';
  app.append(box);
});
