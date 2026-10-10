#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
W1 坐标系与投影 —— 投影换算 / 瓦片编号 / 高德偏移量测算

对应学习计划 W1 的练习：
  1. 输入经纬度，输出 3857 坐标 + 该点在 z=12/15/18 下的瓦片编号
  2. （QGIS 部分）同一份数据用 4326 和 3857 打开，量同一条线的长度，对比差异
  3. 找一份高德坐标的点和一份 WGS84 的点叠加，量出偏移量

运行：
  conda activate webgis
  python w1_proj.py            # 跑全部
  python w1_proj.py tile       # 只跑瓦片编号
  python w1_proj.py offset     # 只跑高德偏移量

W1 验收标准（来自学习计划）：
  [ ] 能手算 z=1、z=2 的瓦片编号，并能解释公式每一项
  [ ] 能说清"同一份数据在 QGIS 里对不上底图"的 3 种可能原因
  [ ] 投影换算脚本能跑，结果和 QGIS 一致（误差 < 1 米）
"""

import math
import sys

from pyproj import Transformer

# ---------------------------------------------------------------------------
# 一、坐标基准常量
# ---------------------------------------------------------------------------
WGS84 = 4326   # 经纬度（GPS 原始、OpenStreetMap、GeoJSON 标准）
WEBMERCATOR = 3857   # Web 墨卡托（所有 XYZ 瓦片底图、OpenLayers 默认视图投影）
CGCS2000 = 4490   # 中国 2000 国家大地坐标系（国内政务数据常用）

# 广州塔，用来做示例点
GZ_LON, GZ_LAT = 113.2644, 23.1291


def demo_project():
    """4326 / 4490 -> 3857 换算，并检查 4490 与 4326 的差异量级。"""
    print("=" * 68)
    print("【1】投影换算")
    print("=" * 68)
    print(f"输入（WGS84 经纬度）: lon={GZ_LON}, lat={GZ_LAT}")
    print()

    # always_xy=True: 强制按 (x=经度, y=纬度) 顺序，避免传统 GIS 的 (lat, lon) 混淆
    t_4326_3857 = Transformer.from_crs(WGS84, WEBMERCATOR, always_xy=True)
    x, y = t_4326_3857.transform(GZ_LON, GZ_LAT)
    print(f"→ EPSG:3857 Web 墨卡托 : x={x:.2f}, y={y:.2f}")

    # 3857 的原点在本初子午线与赤道交点，所以 y 一定为正（北半球）
    print(f"   （3857 原点在几内亚湾，北半球 y 恒为正，当前 y={y:.0f} 米）")

    # 反算验证：投影必须可逆，误差应在浮点精度内
    t_3857_4326 = Transformer.from_crs(WEBMERCATOR, WGS84, always_xy=True)
    lon_back, lat_back = t_3857_4326.transform(x, y)
    err_m = math.hypot(
        (lon_back - GZ_LON) * 111320 * math.cos(math.radians(GZ_LAT)),
        (lat_back - GZ_LAT) * 110540,
    )
    print(f"→ 反算回 4326          : lon={lon_back:.9f}, lat={lat_back:.9f}")
    print(f"   往返误差 ≈ {err_m * 1000:.6f} 毫米（应接近 0，说明投影可逆）")

    # CGCS2000 与 WGS84 在工程精度上可视为等价，但 EPSG 编码不同
    t_4490_3857 = Transformer.from_crs(CGCS2000, WEBMERCATOR, always_xy=True)
    x2, y2 = t_4490_3857.transform(GZ_LON, GZ_LAT)
    print(f"→ EPSG:4490 当同样值处理 : x={x2:.2f}, y={y2:.2f}")
    print(f"   与 4326 结果差 {math.hypot(x2 - x, y2 - y):.6f} 米 "
          f"（CGCS2000 与 WGS84 的椭球差异在厘米级，工程上常互通）")
    print()


# ---------------------------------------------------------------------------
# 二、XYZ 瓦片编号
# ---------------------------------------------------------------------------
def tile_xy(lon, lat, z):
    """
    经纬度 -> XYZ 瓦片编号（Web 墨卡托切片方案，Google/OSM/高德/天地图通用）。

    推导（把这两行彻底弄懂，W1 第一个验收项就过了）：

      n = 2^z                      第 z 级有 n×n 张瓦片
      xt = (lon + 180) / 360 * n   经度 -180~180 线性映射到 0~n
      yt = (1 - asinh(tan(lat_rad)) / pi) / 2 * n
                                  纬度非线性（墨卡托），且 y 轴向下

    为什么纬度是 asinh(tan())：Web 墨卡托的正向公式是
      y_merc = R * ln(tan(pi/4 + lat/2))
    而 ln(tan(pi/4 + lat/2)) == asinh(tan(lat))，用 asinh 形式可以避免
    lat 接近 ±90° 时 tan 溢出。这就是为什么高纬地区会被"拉长"。
    """
    n = 2 ** z
    xt = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    yt = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)

    # 边界保护：经度 180 会算出 n，越界；纬度超出墨卡托有效范围也要夹住
    xt = min(max(xt, 0), n - 1)
    yt = min(max(yt, 0), n - 1)
    return xt, yt


def tile_bounds(x, y, z):
    """反算某张瓦片覆盖的经纬度范围（bbox），用来验证编号算得对不对。"""
    n = 2 ** z

    def lon_at(xt):
        return xt / n * 360.0 - 180.0

    def lat_at(yt):
        # asinh 的逆函数是 sinh
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yt / n))))

    return lon_at(x), lat_at(y + 1), lon_at(x + 1), lat_at(y)


def demo_tiles():
    print("=" * 68)
    print("【2】XYZ 瓦片编号")
    print("=" * 68)
    print(f"示例点: lon={GZ_LON}, lat={GZ_LAT}")
    print()
    print(f"{'z':>3} | {'瓦片 x':>8} | {'瓦片 y':>8} | {'该级瓦片总数':>12} | 瓦片覆盖范围(西,南,东,北)")
    print("-" * 100)
    for z in (1, 2, 12, 15, 18):
        x, y = tile_xy(GZ_LON, GZ_LAT, z)
        west, south, east, north = tile_bounds(x, y, z)
        total = (2 ** z) ** 2
        print(f"{z:>3} | {x:>8} | {y:>8} | {total:>12,} | "
              f"({west:.4f}, {south:.4f}, {east:.4f}, {north:.4f})")

    print()
    print("★ 手算校验（W1 验收项：能手算 z=1、z=2 的瓦片编号）")
    print("-" * 68)
    for z in (1, 2):
        n = 2 ** z
        lon_part = (GZ_LON + 180.0) / 360.0 * n
        lat_rad = math.radians(GZ_LAT)
        lat_part = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
        print(f"  z={z}: n=2^{z}={n}")
        print(f"       x = ({GZ_LON} + 180) / 360 × {n} = {lon_part:.4f} → 取整 {int(lon_part)}")
        print(f"       y = (1 - asinh(tan({GZ_LAT}°)) / π) / 2 × {n} = {lat_part:.4f} → 取整 {int(lat_part)}")

    print()
    print("★ 瓦片总数规律：每升一级，瓦片数 ×4（z=1 有 4 张，z=2 有 16 张）")
    print("  这就是 W3 里 Network 面板看到请求数按 4 倍增长的根因。")
    print()


# ---------------------------------------------------------------------------
# 三、GCJ-02（高德/腾讯）偏移量测算
# ---------------------------------------------------------------------------
def wgs84_to_gcj02(lon, lat):
    """
    WGS84 -> GCJ-02（火星坐标）标准实现。

    为什么需要它：中国大陆的公开地图服务（高德、腾讯）依法必须对坐标做非线性
    偏移，偏移量随位置变化，最大可达数百米。所以：
      - 拿 GPS 原始点直接叠到高德底图上 → 会整体偏移
      - 拿高德取的点直接存成 WGS84 → 同样错位
    这是 W1 第三个练习要量出来的东西。
    """
    a = 6378245.0                      # 克拉索夫斯基椭球长半轴
    ee = 0.00669342162296594323        # 偏心率平方

    def _transform_lat(x, y):
        ret = (-100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
               + 0.2 * math.sqrt(abs(x)))
        ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
        ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
        ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
        return ret

    def _transform_lon(x, y):
        ret = (300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y
               + 0.1 * math.sqrt(abs(x)))
        ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
        ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
        ret += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
        return ret

    d_lat = _transform_lat(lon - 105.0, lat - 35.0)
    d_lon = _transform_lon(lon - 105.0, lat - 35.0)
    rad_lat = lat / 180.0 * math.pi
    magic = math.sin(rad_lat)
    magic = 1 - ee * magic * magic
    sqrt_magic = math.sqrt(magic)

    d_lat = (d_lat * 180.0) / ((a * (1 - ee)) / (magic * sqrt_magic) * math.pi)
    d_lon = (d_lon * 180.0) / (a / sqrt_magic * math.cos(rad_lat) * math.pi)
    return lon + d_lon, lat + d_lat


def gcj02_to_wgs84(lon, lat):
    """GCJ-02 -> WGS84，用一次迭代逼近（精度约 1e-6 度，足够）。"""
    m_lon, m_lat = wgs84_to_gcj02(lon, lat)
    return lon * 2 - m_lon, lat * 2 - m_lat


def demo_offset():
    print("=" * 68)
    print("【3】GCJ-02（高德/腾讯火星坐标）偏移量")
    print("=" * 68)

    samples = [
        ("北京天安门", 116.397428, 39.90923),
        ("上海人民广场", 121.4737, 31.2304),
        ("广州塔", GZ_LON, GZ_LAT),
        ("乌鲁木齐", 87.6168, 43.8256),
        ("三亚", 109.5082, 18.2478),
    ]

    t = Transformer.from_crs(WGS84, WEBMERCATOR, always_xy=True)

    print(f"{'地点':<12} | {'偏移(度)':>18} | {'偏移(米)':>9} | {'偏移方向'}")
    print("-" * 78)
    for name, lon, lat in samples:
        g_lon, g_lat = wgs84_to_gcj02(lon, lat)
        # 用 3857 平面距离近似米数（小范围内足够准）
        x1, y1 = t.transform(lon, lat)
        x2, y2 = t.transform(g_lon, g_lat)
        dx, dy = x2 - x1, y2 - y1
        dist = math.hypot(dx, dy)
        d_lon, d_lat = g_lon - lon, g_lat - lat
        direction = f"东{abs(dx):.0f}m 北{abs(dy):.0f}m" if dx >= 0 and dy >= 0 else \
                    f"{'东' if dx >= 0 else '西'}{abs(dx):.0f}m {'北' if dy >= 0 else '南'}{abs(dy):.0f}m"
        print(f"{name:<12} | ({d_lon:+.8f}, {d_lat:+.8f}) | {dist:>9.1f} | {direction}")

    print()
    print("★ 关键结论（写进你的学习笔记）：")
    print("  1. 偏移量随位置变化，不是固定值 —— 所以不能用一个常量去减")
    print("  2. 量级在 100~700 米 —— 在 z=18 的底图上肉眼非常明显")
    print("  3. 偏移是非线性的 —— 所以必须用算法转换，不能线性平移")
    print()

    # 往返验证
    g_lon, g_lat = wgs84_to_gcj02(GZ_LON, GZ_LAT)
    b_lon, b_lat = gcj02_to_wgs84(g_lon, g_lat)
    err = math.hypot((b_lon - GZ_LON) * 111320 * math.cos(math.radians(GZ_LAT)),
                     (b_lat - GZ_LAT) * 110540)
    print(f"  GCJ-02 往返误差: {err:.6f} 米（迭代法精度验证）")
    print()


# ---------------------------------------------------------------------------
# 四、给 QGIS 实验用的对照点
# ---------------------------------------------------------------------------
def demo_qgis_points():
    """打印两组点，供 QGIS 叠加实验使用（W1 练习 3）。"""
    print("=" * 68)
    print("【4】QGIS 叠加实验用点（复制到 CSV 里）")
    print("=" * 68)
    g_lon, g_lat = wgs84_to_gcj02(GZ_LON, GZ_LAT)
    print("新建 points_wgs84.csv，内容：")
    print("name,lon,lat")
    print(f"广州塔_WGS84,{GZ_LON},{GZ_LAT}")
    print()
    print("新建 points_gcj02.csv，内容：")
    print("name,lon,lat")
    print(f"广州塔_GCJ02,{g_lon:.8f},{g_lat:.8f}")
    print()
    print("在 QGIS 里分别用「添加分隔文本图层」导入（分隔符选逗号，")
    print("X 字段选 lon、Y 字段选 lat、CRS 都选 EPSG:4326），就能看到两个点错开。")
    print()


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    banner = {
        'tile': demo_tiles,
        'offset': demo_offset,
        'project': demo_project,
        'points': demo_qgis_points,
    }
    if which == 'all':
        demo_project()
        demo_tiles()
        demo_offset()
        demo_qgis_points()
        print("=" * 68)
        print("W1 验收自检：")
        print("  [ ] 能手算 z=1、z=2 的瓦片编号，并能解释公式每一项")
        print("  [ ] 能说清「同一份数据在 QGIS 里对不上底图」的 3 种可能原因")
        print("  [ ] 投影换算脚本能跑，结果和 QGIS 一致（误差 < 1 米）")
        print("=" * 68)
    elif which in banner:
        banner[which]()
    else:
        print(f"未知参数: {which}")
        print("可用: all / project / tile / offset / points")
        sys.exit(1)


if __name__ == '__main__':
    main()
