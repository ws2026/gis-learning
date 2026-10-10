-- ============================================================================
-- coordinate.sql — 坐标系换算与瓦片编号（PostGIS 版）
-- ============================================================================
-- W1 练习 1 的 PostGIS 实现，与以下实现互相验证：
--   coord.mjs (Node.js) / w1_proj.py (Python/pyproj) / QGIS 3.44.15
--
-- 【运行方式】
--   1) 启动容器（未在运行时）：
--        docker start pgis
--   2) 整个文件执行：
--        docker exec -i pgis psql -U postgres -d postgres -f - < coordinate.sql
--      或在 Git Bash 里：
--        cat coordinate.sql | docker exec -i pgis psql -U postgres -d postgres
--      或进入交互式 psql：
--        docker exec -it pgis psql -U postgres
--        \i /path/to/coordinate.sql        -- 注意：这是容器内路径
--   3) 若提示函数 ST_Transform 不存在，先启用扩展：
--        CREATE EXTENSION IF NOT EXISTS postgis;
--
-- 【重要前提】空间参考字典
--   PostGIS 依赖 spatial_ref_sys 表里的坐标系定义。本文件仅使用 EPSG:4326 与
--   EPSG:3857，这两个在标准 postgis/postgis 镜像里都已存在。
--   若求"精确"的北京54/西安80 转换，需要额外安装投影网格（proj-data），
--   且 PROJ 版本会影响结果——本次未涉及。
--
-- 【未实测声明】
--   本文件编写时 Docker Desktop 未运行，未在真实库上执行过。
--   语法依据 PostGIS 手册，若某条报错请以报错信息为准。
--
-- 【基准值】广州 (113.2644, 23.1291)，四方实测一致：
--   x_3857 = 12608535.33    y_3857 = 2647638.58
--   z=12 瓦片 = (3336, 1777)
-- ============================================================================


-- ============================================================================
-- 第 0 节：环境自检
-- ============================================================================
SELECT PostGIS_Full_Version() AS postgis_version;

-- spatial_ref_sys 里有多少坐标系定义（标准镜像约 8500 条）
SELECT COUNT(*) AS srs_count FROM spatial_ref_sys;

-- 确认 4326 / 3857 都在
SELECT srid, auth_name, auth_srid, left(srtext, 40) AS srtext_head
FROM spatial_ref_sys
WHERE srid IN (4326, 3857)
ORDER BY srid;
-- 观察 srtext 首词：4326 是 GEOGCS（度），3857 是 PROJCS（米）


-- ============================================================================
-- 第 1 节：4326 -> 3857 换算（与 coord.mjs 的基准值对比）
-- ============================================================================
-- 注意：ST_Transform 的输入输出都用笛卡尔坐标，所以 4326 直接写成 POINT(lon lat)
WITH pts(name, lon, lat) AS (
    VALUES
        ('广州塔',        113.2644::float8, 23.1291::float8),
        ('北京天安门',    116.397428::float8, 39.90923::float8),
        ('上海人民广场',  121.4737::float8, 31.2304::float8)
)
SELECT
    name,
    lon,
    lat,
    round(ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 3857))::numeric, 2) AS x_3857,
    round(ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 3857))::numeric, 2) AS y_3857
FROM pts;
-- 预期：广州塔 x=12608535.33, y=2647638.58（与另三个实现逐位一致）


-- ============================================================================
-- 第 2 节：XYZ 瓦片编号
-- ============================================================================
-- 瓦片公式是纯数学，不需要空间扩展：
--   n  = 2^z
--   xt = floor( (lon + 180) / 360 * n )
--   yt = floor( (1 - ln(tan(pi/4 + lat*pi/360)) / pi) / 2 * n )
-- 注意：PostgreSQL 里整数除法会截断，所以所有除法都要有一边是浮点（::float8）。
WITH pts(name, lon, lat) AS (
    VALUES
        ('广州塔', 113.2644::float8, 23.1291::float8)
),
z AS (SELECT unnest(ARRAY[1, 2, 12, 15, 18]) AS z)
SELECT
    p.name,
    z.z,
    floor((p.lon + 180.0) / 360.0 * power(2, z.z))::int AS tile_x,
    floor(
        (1.0 - ln(tan(pi() / 4.0 + p.lat * pi() / 360.0)) / pi()) / 2.0 * power(2, z.z)
    )::int AS tile_y,
    power(2, z.z)::bigint * power(2, z.z)::bigint AS tile_count
FROM pts p
CROSS JOIN z
ORDER BY z.z;
-- 预期（广州塔）：
--   z=1  ->  1,     0
--   z=2  ->  3,     1
--   z=12 ->  3336,  1777
--   z=15 ->  26693, 14219
--   z=18 ->  213548, 113752


-- ============================================================================
-- 第 3 节：瓦片编号 -> 经纬度范围（反算校验）
-- ============================================================================
-- 用来验证第 2 节算出的编号对不对：把编号还原成 bbox，看基准点是否落在里面。
--   lon(xt) = xt / n * 360 - 180
--   lat(yt) = atan(sinh(pi * (1 - 2*yt/n))) * 180 / pi
WITH t AS (
    SELECT 3336::int AS x, 1777::int AS y, 12 AS z, 113.2644::float8 AS lon, 23.1291::float8 AS lat
),
b AS (
    SELECT
        x, y, z, lon, lat,
        power(2, z) AS n,
        (x::float8 / power(2, z)) * 360.0 - 180.0                                        AS west,
        degrees(atan(sinh(pi() * (1.0 - 2.0 * (y + 1)::float8 / power(2, z)))))          AS south,
        ((x + 1)::float8 / power(2, z)) * 360.0 - 180.0                                  AS east,
        degrees(atan(sinh(pi() * (1.0 - 2.0 * y::float8 / power(2, z)))))                AS north
    FROM t
)
SELECT
    z,
    x AS tile_x,
    y AS tile_y,
    round(west::numeric, 4)  AS west,
    round(south::numeric, 4) AS south,
    round(east::numeric, 4)  AS east,
    round(north::numeric, 4) AS north,
    (lon BETWEEN west AND east AND lat BETWEEN south AND north) AS point_inside
FROM b;
-- 预期：点落在瓦片内（point_inside = t），bbox ≈ (113.2031, 23.0797, 113.2910, 23.1606)


-- ============================================================================
-- 第 4 节：同一份数据在 4326 / 3857 下的"长度"差异
-- ============================================================================
-- 这正是 W1 实验一在 QGIS 里量出来的结论，换成 SQL 复现。
-- 用 W1 的三条测试线（与 w1_test_features.geojson 一致）。
--
-- 三个距离函数要分清：
--   ST_Distance(geometry, geometry)                  平面距离（按 SRID 的单位）
--   ST_Distance(geography, geography, use_spheroid)  地理距离（米；true=椭球，false=球面）
--   ST_DistanceSphere(geometry, geometry)            球面距离（米）
WITH lines(name, a_lon, a_lat, b_lon, b_lat) AS (
    VALUES
        ('线A 广州东西向 1度经度', 113.0000::float8, 23.1291::float8, 114.0000::float8, 23.1291::float8),
        ('线B 广州南北向 1度纬度', 113.2644::float8, 23.0000::float8, 113.2644::float8, 24.0000::float8),
        ('线C 挪威南北向 1度纬度',  20.0000::float8, 60.0000::float8,  20.0000::float8, 61.0000::float8)
),
g AS (
    SELECT
        name,
        ST_SetSRID(ST_MakePoint(a_lon, a_lat), 4326) AS g4326_a,
        ST_SetSRID(ST_MakePoint(b_lon, b_lat), 4326) AS g4326_b
    FROM lines
)
SELECT
    name,
    -- 4326 平面距离：单位是"度"，没有物理意义，仅作对照
    round(ST_Distance(g4326_a, g4326_b)::numeric, 6) AS dist_deg_4326,
    -- 椭球真实距离（米）——与 QGIS 的 length_wgs84_m 对比
    round(ST_Distance(g4326_a::geography, g4326_b::geography, true)::numeric, 3)  AS dist_ellipsoid_m,
    -- 球面距离（米）——用于观察球面 vs 椭球的差异
    round(ST_DistanceSphere(g4326_a, g4326_b)::numeric, 3)                         AS dist_sphere_m,
    -- 3857 平面距离（米）——与 QGIS 的 length_3857_m 对比
    round(ST_Distance(
        ST_Transform(g4326_a, 3857),
        ST_Transform(g4326_b, 3857)
    )::numeric, 3)                                                                 AS dist_3857_m
FROM g;
-- 预期（对照 QGIS 实测值；椭球与 3857 两列已由 QGIS 独立验证）：
--   线A: 椭球 102424.576 ｜ 球面 102257.255 ｜ 3857 111319.491
--   线B: 椭球 110751.075 ｜ 球面 111195.080 ｜ 3857 121389.472
--   线C: 椭球 111420.728 ｜ 球面 111195.080 ｜ 3857 226085.310
--
-- 【核心结论 1】3857 列 ÷ 椭球列：
--   线A +8.68% ｜ 线B +9.61% ｜ 线C +102.9%
--   同样"1 个纬度"，广州误差 8.7%，挪威误差 103% —— 变形随纬度急剧恶化。
--
-- 【核心结论 2】注意球面列的"反常"：线B 和线C 的球面距离**完全相同**
--   （都是 111195.080 m），但椭球距离差了约 670 m
--   （线B 110751.075 ｜ 线C 111420.728）。
--   原因：正球体上任意 1 度子午线弧长恒为 R·π/180，与纬度无关；
--   而 WGS84 椭球因扁率导致子午线弧长随纬度变化（两极略长于赤道）。
--   这就是"球面 vs 椭球"的系统性差异 —— 用 ol/sphere 做量算时要注意。


-- ============================================================================
-- 第 5 节：Web 墨卡托膨胀系数的理论验证
-- ============================================================================
-- 验证第 4 节的实测膨胀率是否等于 1/cos(纬度)
WITH pts(name, lat, measured_ratio) AS (
    VALUES
        ('线A 广州', 23.1291::float8, 111319.491 / 102424.576),
        ('线B 广州', 23.5::float8,     121389.472 / 110751.075),
        ('线C 挪威', 60.5::float8,     226085.310 / 111420.728)
)
SELECT
    name,
    lat,
    round(measured_ratio::numeric, 5)                    AS measured_ratio,
    round((1.0 / cos(radians(lat)))::numeric, 5)         AS theory_1_cos_lat,
    round((abs(measured_ratio - 1.0 / cos(radians(lat))))::numeric, 5) AS diff
FROM pts;
-- 预期：measured_ratio 与 theory_1_cos_lat 非常接近（差异来自椭球 vs 正球的模型不同）
--   线A: 实测 1.08684 ｜ 理论 1.08737
--   线B: 实测 1.09606 ｜ 理论 1.09042
--   线C: 实测 2.02911 ｜ 理论 2.03080
-- 线B 偏差稍大（0.5%）是因为它是南北向、跨了 1 个纬度，
-- 而 1/cos 是按中点纬度算的近似值 —— 跨度越大偏差越明显。


-- ============================================================================
-- 第 6 节：为什么 GCJ-02 偏移量不能用 SQL 简单算
-- ============================================================================
-- GCJ-02（火星坐标）是保密的非线性偏移，PostGIS 的 spatial_ref_sys 里没有它，
-- 所以不能用 ST_Transform 转换。必须在应用层用算法实现（见 w1_proj.py 的
-- wgs84_to_gcj02），或使用带该插件的商业库。
--
-- 这里只做一件事：确认它是"没有定义"的，而不是我们写错了 SRID。
SELECT COUNT(*) AS gcj02_like_defs
FROM spatial_ref_sys
WHERE srtext ILIKE '%GCJ%' OR srtext ILIKE '%mars%';
-- 预期：0（确认 PostGIS 内置不含 GCJ-02）


-- ============================================================================
-- 第 7 节：坐标系定义查询（排查"对不上"的第一步）
-- ============================================================================
-- W1 验收项"能说清对不上底图的 3 种原因"的辅助工具：
-- 查任意 SRID 的定义，看它是地理坐标系（度）还是投影坐标系（米）。
SELECT
    srid,
    auth_name || ':' || auth_srid AS authority,
    CASE
        WHEN srtext LIKE 'GEOGCS%' OR srtext LIKE 'GEOGCRS%' THEN '地理坐标系（度）'
        WHEN srtext LIKE 'PROJCS%' OR srtext LIKE 'PROJCRS%' THEN '投影坐标系（米）'
        ELSE '其他'
    END AS crs_type,
    -- 从 WKT 里粗取单位名，便于确认
    substring(srtext FROM 'UNIT\["([^"]+)"') AS first_unit
FROM spatial_ref_sys
WHERE srid IN (4326, 4490, 3857, 4547)   -- WGS84 / CGCS2000 / 伪墨卡托 / CGCS2000 3度带
ORDER BY srid;
-- 注意：WKT 里第一个 UNIT 不一定是水平单位（可能是角度单位），
-- 所以这里的 first_unit 仅作参考，权威判断看 crs_type。


-- ============================================================================
-- 第 8 节：几何有效性检查（W2 的前置，顺带演示）
-- ============================================================================
-- PostGIS 的 ST_IsValid 与 QGIS「检查有效性」工具用的是同一个 GEOS 引擎。
-- 本文件只用简单线段，应该都有效；换成真实数据时这条会发现自相交等问题。
WITH lines(name, wkt) AS (
    VALUES
        ('线A', 'LINESTRING(113 23.1291, 114 23.1291)'),
        ('线B', 'LINESTRING(113.2644 23, 113.2644 24)'),
        ('线C', 'LINESTRING(20 60, 20 61)')
)
SELECT
    name,
    ST_IsValid(ST_GeomFromText(wkt, 4326)) AS is_valid,
    ST_IsSimple(ST_GeomFromText(wkt, 4326)) AS is_simple,
    ST_NPoints(ST_GeomFromText(wkt, 4326)) AS npoints
FROM lines;
-- 预期：全部 is_valid = t
