#!/usr/bin/env node
/**
 * coord.mjs — 坐标系换算与瓦片编号（Node.js 版，零依赖）
 *
 * W1 练习 1 的 Node 实现，与以下实现互相验证：
 *   - w1_proj.py     Python / pyproj 3.8.0
 *   - QGIS 3.44.15   字段计算器 / 测量窗口
 *   - sql/coordinate.sql  PostGIS ST_Transform
 *
 * 运行（需 Node 18+，无需 npm install）：
 *   node coord.mjs                 # 全部
 *   node coord.mjs convert         # 只做 4326 -> 3857 换算
 *   node coord.mjs tile            # 只算 XYZ 瓦片编号
 *   node coord.mjs verify          # 与基准值对比（交叉验证）
 *   node coord.mjs lon=121.47 lat=31.23   # 自定义经纬度
 *
 * 基准值（广州 113.2644, 23.1291），四方实测一致：
 *   3857: x = 12608535.33, y = 2647638.58
 *   z=12 瓦片: x = 3336, y = 1777
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
/** WGS84 长半轴（Web 墨卡托把它当作正球体半径使用，这是变形的根源） */
const R = 6378137.0;

/** 墨卡托投影的纬度上限：atan(sinh(π)) 的度数，约 ±85.0511287798° */
const MAX_LAT = 85.05112877980659;

/** 用于交叉验证的基准点（广州塔） */
const BENCHMARK = {
  name: '广州塔',
  lon: 113.2644,
  lat: 23.1291,
  x3857: 12608535.33,
  y3857: 2647638.58,
  tiles: { 1: [1, 0], 2: [3, 1], 12: [3336, 1777], 15: [26693, 14219], 18: [213548, 113752] },
};

// ---------------------------------------------------------------------------
// 一、4326 -> 3857（Web 墨卡托正算，闭式解）
// ---------------------------------------------------------------------------
/**
 * 经纬度转 Web 墨卡托平面坐标（单位：米）。
 *
 *   x = R · λ               （λ 为弧度）
 *   y = R · ln(tan(π/4 + φ/2))
 *
 * 注意 y 的公式：等价于 R · asinh(tan φ)，用 asinh 形式可避免 φ 接近 ±90° 时 tan 溢出。
 * 因为把椭球当正球体（R 用长半轴），所以纬度高处会被系统性拉长 —— 系数为 1/cos(φ)。
 */
function lonLatToWebMercator(lon, lat) {
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const x = R * (lon * Math.PI) / 180;
  const y = R * Math.asinh(Math.tan((clampedLat * Math.PI) / 180));
  return { x, y };
}

/** 3857 -> 4326（反算，验证投影可逆） */
function webMercatorToLonLat(x, y) {
  const lon = (x / R) * (180 / Math.PI);
  const lat = (Math.atan(Math.sinh(y / R)) * 180) / Math.PI;
  return { lon, lat };
}

// ---------------------------------------------------------------------------
// 二、XYZ 瓦片编号（Web 墨卡托切片方案，Google/OSM/高德/天地图通用）
// ---------------------------------------------------------------------------
/**
 * 经纬度 -> XYZ 瓦片编号。
 *
 *   n  = 2^z
 *   xt = floor( (lon + 180) / 360 · n )
 *   yt = floor( (1 - asinh(tan φ) / π) / 2 · n )
 *
 * 每一项的含义：
 *   (lon+180)/360  把经度 -180~180 线性映射到 0~1
 *   ×n             映射到第 z 级的 n×n 网格
 *   asinh(tan φ)   墨卡托的纬度非线性变换
 *   1 - ...        因为瓦片 y 轴向下（北在上，编号 0 在顶部）
 */
function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const xt = Math.floor(((lon + 180) / 360) * n);
  const yt = Math.floor(
    ((1 - Math.asinh(Math.tan((clampedLat * Math.PI) / 180)) / Math.PI) / 2) * n
  );
  return {
    x: Math.min(Math.max(xt, 0), n - 1),
    y: Math.min(Math.max(yt, 0), n - 1),
  };
}

/** 瓦片编号 -> 该瓦片覆盖的经纬度范围（用来验证编号算得对不对） */
function tileBounds(x, y, z) {
  const n = 2 ** z;
  const lonAt = (xt) => (xt / n) * 360 - 180;
  const latAt = (yt) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yt) / n))) * 180) / Math.PI;
  return {
    west: lonAt(x),
    south: latAt(y + 1),
    east: lonAt(x + 1),
    north: latAt(y),
  };
}

// ---------------------------------------------------------------------------
// 三、Web 墨卡托的长度膨胀系数
// ---------------------------------------------------------------------------
/**
 * 某纬度处 Web 墨卡托的平面距离相对真实距离的放大系数 = 1/cos(φ)。
 *
 * 这是"3857 不能算距离"的量化表达：
 *   广州 23.13° -> 1.0874（+8.7%）
 *   挪威 60.5°  -> 2.0308（+103%）
 */
function mercatorInflation(lat) {
  return 1 / Math.cos((lat * Math.PI) / 180);
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const fmt = (n, d = 2) => n.toFixed(d);
const pad = (s, n) => String(s).padEnd(n, ' ');
const padStart = (s, n) => String(s).padStart(n, ' ');

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`【${title}】`);
  console.log('='.repeat(70));
}

function demoConvert(lon, lat, name) {
  section('1】4326 -> 3857 换算');
  console.log(`输入（WGS84 经纬度）: lon=${lon}, lat=${lat}${name ? `  (${name})` : ''}`);

  const { x, y } = lonLatToWebMercator(lon, lat);
  console.log(`→ EPSG:3857 Web 墨卡托 : x=${fmt(x)}, y=${fmt(y)}`);
  console.log(`   （3857 原点在几内亚湾，北半球 y 恒为正）`);

  const back = webMercatorToLonLat(x, y);
  const errM = Math.hypot(
    (back.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180),
    (back.lat - lat) * 110540
  );
  console.log(`→ 反算回 4326          : lon=${back.lon.toFixed(9)}, lat=${back.lat.toFixed(9)}`);
  console.log(`   往返误差 ≈ ${fmt(errM * 1000, 6)} 毫米（应接近 0，说明投影可逆）`);
}

function demoTile(lon, lat, name) {
  section('2】XYZ 瓦片编号');
  console.log(`示例点: lon=${lon}, lat=${lat}${name ? `  (${name})` : ''}\n`);
  console.log(
    `${padStart('z', 3)} | ${padStart('瓦片 x', 8)} | ${padStart('瓦片 y', 8)} | ` +
      `${padStart('该级瓦片总数', 14)} | 瓦片覆盖范围(西, 南, 东, 北)`
  );
  console.log('-'.repeat(102));
  for (const z of [1, 2, 12, 15, 18]) {
    const { x, y } = tileXY(lon, lat, z);
    const b = tileBounds(x, y, z);
    const total = (2 ** z) ** 2;
    console.log(
      `${padStart(z, 3)} | ${padStart(x, 8)} | ${padStart(y, 8)} | ${padStart(total.toLocaleString('en-US'), 14)} | ` +
        `(${fmt(b.west, 4)}, ${fmt(b.south, 4)}, ${fmt(b.east, 4)}, ${fmt(b.north, 4)})`
    );
  }

  console.log('\n★ 手算校验（W1 验收项：能手算 z=1、z=2 的瓦片编号）');
  console.log('-'.repeat(70));
  for (const z of [1, 2]) {
    const n = 2 ** z;
    const lonPart = ((lon + 180) / 360) * n;
    const latPart =
      ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    console.log(`  z=${z}: n=2^${z}=${n}`);
    console.log(`       x = (${lon} + 180) / 360 × ${n} = ${fmt(lonPart, 4)} → 取整 ${Math.floor(lonPart)}`);
    console.log(`       y = (1 - asinh(tan(${lat}°)) / π) / 2 × ${n} = ${fmt(latPart, 4)} → 取整 ${Math.floor(latPart)}`);
  }
  console.log('\n★ 瓦片总数规律：每升一级 ×4（z=1 有 4 张，z=2 有 16 张）');
  console.log('  这就是 W3 里 Network 面板看到请求数按 4 倍增长的根因。');
}

function demoInflation() {
  section('3】Web 墨卡托的长度膨胀系数 1/cos(纬度)');
  console.log(`${pad('纬度', 22)} | ${padStart('系数', 8)} | 说明`);
  console.log('-'.repeat(60));
  const rows = [
    [0, '赤道，准确'],
    [23.1291, '广州（W1 实测 +8.68%）'],
    [23.5, '广州至北（W1 实测 +9.61%）'],
    [39.90923, '北京'],
    [45, '哈尔滨'],
    [60.5, '挪威（W1 实测 +102.9%）'],
    [85, '墨卡托上限附近'],
  ];
  for (const [lat, note] of rows) {
    console.log(`${pad(`${lat}°`, 22)} | ${padStart(fmt(mercatorInflation(lat), 4), 8)} | ${note}`);
  }
  console.log('\n★ 结论：系数随纬度急剧增大，所以 3857 只能用来"显示"，不能用来"算距离和面积"。');
}

function demoVerify(lon, lat) {
  section('4】交叉验证（与四方基准值对比）');
  const { x, y } = lonLatToWebMercator(BENCHMARK.lon, BENCHMARK.lat);
  const dy = Math.abs(y - BENCHMARK.y3857);

  console.log(`基准点: ${BENCHMARK.name} (${BENCHMARK.lon}, ${BENCHMARK.lat})\n`);
  console.log(`${pad('项目', 14)} | ${padStart('本脚本', 16)} | ${padStart('基准值', 16)} | 结果`);
  console.log('-'.repeat(72));
  console.log(
    `${pad('x_3857', 14)} | ${padStart(fmt(x), 16)} | ${padStart(fmt(BENCHMARK.x3857), 16)} | ` +
      `${Math.abs(x - BENCHMARK.x3857) < 0.01 ? '✅ 一致' : '❌ 不一致'}`
  );
  console.log(
    `${pad('y_3857', 14)} | ${padStart(fmt(y), 16)} | ${padStart(fmt(BENCHMARK.y3857), 16)} | ` +
      `${dy < 0.01 ? '✅ 一致' : '❌ 不一致'}`
  );
  console.log();
  for (const [z, [ex, ey]] of Object.entries(BENCHMARK.tiles)) {
    const t = tileXY(BENCHMARK.lon, BENCHMARK.lat, Number(z));
    const ok = t.x === ex && t.y === ey;
    console.log(
      `${pad(`z=${z} 瓦片`, 14)} | ${padStart(`${t.x}, ${t.y}`, 16)} | ${padStart(`${ex}, ${ey}`, 16)} | ${ok ? '✅ 一致' : '❌ 不一致'}`
    );
  }
  console.log('\n基准来源：QGIS 3.44.15 / PostGIS ST_Transform / 前端 ol-proj / pyproj 3.8.0，四方实测一致。');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { cmd: 'all', lon: BENCHMARK.lon, lat: BENCHMARK.lat, name: BENCHMARK.name };
  for (const a of argv.slice(2)) {
    const [k, v] = a.split('=');
    if (k === 'lon') out.lon = Number(v);
    else if (k === 'lat') out.lat = Number(v);
    else if (k === 'name') out.name = v;
    else if (['all', 'convert', 'tile', 'inflation', 'verify'].includes(a)) out.cmd = a;
    else {
      console.error(`未知参数: ${a}`);
      console.error('可用: all | convert | tile | inflation | verify | lon=<v> | lat=<v> | name=<v>');
      process.exit(1);
    }
  }
  if (Number.isNaN(out.lon) || Number.isNaN(out.lat)) {
    console.error('lon / lat 必须是数字');
    process.exit(1);
  }
  return out;
}

const { cmd, lon, lat, name } = parseArgs(process.argv);

switch (cmd) {
  case 'convert':
    demoConvert(lon, lat, name);
    break;
  case 'tile':
    demoTile(lon, lat, name);
    break;
  case 'inflation':
    demoInflation();
    break;
  case 'verify':
    demoVerify();
    break;
  default:
    demoConvert(lon, lat, name);
    demoTile(lon, lat, name);
    demoInflation();
    demoVerify();
    section('W1 验收自检');
    console.log('  [ ] 能手算 z=1、z=2 的瓦片编号，并能解释公式每一项');
    console.log('  [ ] 能说清「同一份数据在 QGIS 里对不上底图」的 3 种可能原因');
    console.log('  [ ] 投影换算脚本能跑，结果和 QGIS 一致（误差 < 1 米）');
    console.log('='.repeat(70));
}
