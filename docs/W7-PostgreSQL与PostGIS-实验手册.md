# W7 实验手册：PostgreSQL + PostGIS

> 对应《WebGIS 12 周学习计划》W7（见 [WebGIS-12周学习计划.md](WebGIS-12周学习计划.md)）。建议时间：2026-11-17 ~ 2026-11-23（每天 1.5~2 h）。
> 环境前提：**`pgis` 容器已在跑**（W0 搭好，验证：`docker ps` 能看到它，见 [week01 笔记](../notes/week01.md) 第五节备忘）；OSGeo4W Shell（ogr2ogr 在这，W2 已用熟，别在 conda 装 GDAL——坑 N6）；conda `webgis` 环境。
> 纪律提醒：W4~W6 未打勾先补。**本周直接消费 W2 的产出**：`projects/data-lab/guangzhou.gpkg`（或 `guangzhou_slim.geojson`）——就是你要"灌进数据库"的第一份数据。
> 承接 W1/W2：你量过 3857 的纬度膨胀（广州 +8.7%）、算过 geography 椭球距离 1065.85 km——本周这些经验全部变成 SQL 里的肌肉记忆。

---

## 0. 本周要建立的三个认知

| # | 认知 | 为什么重要 |
| --- | --- | --- |
| 1 | **数据库 = 一个能并发查询、能 JOIN、能加索引的 Excel 文件** | 数据从"文件"升级到"库"，才有 W8 的服务化和 W10 的多表分析；SQL 不是新语言，就是"筛选 + 选列 + 排序"的书面化 |
| 2 | **空间索引靠"先粗后精"两级过滤**：像查字典先看目录找大概页码，像消防站按辖区先排除不可能的区 | 没有 GiST 索引，每一条空间查询都是全表逐行扫描；W7 验收项"解释 EXPLAIN 差异"说的就是这件事 |
| 3 | **geometry 的距离/面积单位跟着坐标系走：4326 算出来是"度"，不是米** | 想要米：投影（`ST_Transform`）或挂 `::geography` 换椭球算法。把 0.0104"度"当 0.0104 米用，是新人空间 SQL 第一大事故 |

---

## 1. 学（约 4~5 小时，周一到周三分散进行）

### 1.1 SQL 最小必要集：用 Excel 的话讲（1 h）

> **学完你能做什么**：能在 psql 里写出 SELECT/WHERE/ORDER BY/GROUP BY/JOIN 五种语句；psql"卡住"时知道是分号还是分页器。

**概念四件套：SQL 语句**

- **定义**：SQL 是对数据库下指令的语言，一条语句 = 动词（SELECT）+ 对象（FROM 表）+ 条件（WHERE），以分号结尾。
- **类比**：**点菜**：`SELECT 菜名 FROM 菜单 WHERE 价格 < 30;`——你说要什么，厨房（数据库）决定怎么做。
- **最小示例**：【容器内 psql】

  ```sql
  SELECT 1 + 1;
  ```
  预期输出：

  ```text
   ?column?
  ----------
          2
  (1 row)
  ```
  失败时：提示符变成 `gislab-#` → 忘了分号，补一个 `;` 回车即可；底部显示 `END` → 分页器，按 `q`（坑 P1）。

- **常见误区**：① 字符串用双引号——双引号是包表名列名的，字符串必须单引号；② 以为 SQL 区分大小写——关键字不区分，但表名建的时候带大写就麻烦了（初学一律全小写+下划线）。

忘掉"编程"，SQL 你会的 Excel 操作它全有对应：

| 你想干什么 | Excel 里的动作 | SQL 写法 |
| --- | --- | --- |
| 看一张表 | 点开一个 sheet | `SELECT * FROM gz_districts;` |
| 选几列 | 只看某几列 | `SELECT name, adcode FROM gz_districts;` |
| 筛选行 | 列标题下拉 → 勾选条件 | `SELECT * FROM schools WHERE district = '天河区';` |
| 排序 | 点列头排序 | `SELECT * FROM schools ORDER BY id DESC LIMIT 10;` |
| 数一数/分组汇总 | 数据透视表 | `SELECT district, count(*) FROM schools GROUP BY district;` |
| 两张表按字段对上 | VLOOKUP | `SELECT ... FROM a JOIN b ON ST_Contains(b.geom, a.geom);` |

四条铁律，零基础的坑都在这：

- SQL **不区分大小写**，但关键字大写、表名列名小写是全社区习惯，照抄。
- 一条语句以**分号结尾**。psql 里只敲半句会显示 `gislab-#` 等你——不是卡住，是没写完（或忘了分号）。
- 字符串用**单引号** `'天河区'`；双引号 `"schools"` 是包表名的（防关键字冲突、防大小写）。
- 表名默认被转小写：建表时写 `CREATE TABLE Schools`，查时得用 `schools` 或 `"Schools"`。初学一律全小写+下划线。

**psql 交互备忘**（全部在【PowerShell】里敲，进去后是【容器内 psql】）：

```powershell
# 【PowerShell】先看容器活着没；Exited 就 docker start pgis（见坑 P2）
docker ps -a

# 【PowerShell】进数据库；-d gislab 指定库（库名见 1.2）
docker exec -it pgis psql -U postgres -d gislab
```

【容器内 psql】里的反斜杠命令（不是 SQL，是 psql 自带的"快捷菜单"）：

| 命令 | 干什么 |
| --- | --- |
| `\dt` | 列出当前库所有表 |
| `\d 表名` | 看表结构（列、类型、索引） |
| `\l` | 列出所有数据库 |
| `\pset pager off` | **关掉分页器**——输出多了不再卡在 `END`（W0 真实坑 #7，按 `q` 是临时退出） |
| `\i 文件.sql` | 执行一个 SQL 文件（练习阶段主力，见 2.0） |
| `\q` | 退出 psql（别按 Ctrl+C，那是中断当前语句） |

### 1.2 数据库里装"形状"：geometry 列与 SRID（1 h）

> **学完你能做什么**：能建一张带 `geometry(Point,4326)` 列的表；能解释 SRID=-1 意味着什么以及怎么救。

**概念四件套：geometry 列与 SRID**

- **定义**：PostGIS 给 PostgreSQL 增加的列类型，一条记录可以存一个几何体；`geometry(Point, 4326)` = 只能存点 + 坐标系焊死为 WGS84。SRID 是坐标系编号（4326=WGS84 经纬度，3857=Web 墨卡托）。
- **类比**：**快递单上的地址格式声明**。"省市县"格式（4326）和"网格编号"格式（3857）写的是同一个地方，但快递员（函数）必须知道单子是哪种格式才能送。SRID=-1 就是没填格式——没人敢送。
- **最小示例**：下面的建表语句。
- **常见误区**：① 以为建表后还能随便改 SRID——类型里的 4326 是约束，存别的 SRID 直接报错；② `ST_Transform` 一个不存在的 SRID=-1 的几何 → 报 `unknown SRS`（坑 P5）。

PostgreSQL 本身只会存数字和文字；**PostGIS 是它的扩展插件**，装上后多了一族"几何类型"：

```sql
-- 【容器内 psql】标准建表：geom 这一列只能存"SRID=4326 的点"
CREATE TABLE schools (
  id       serial PRIMARY KEY,          -- 自增编号
  name     text,                        -- 普通文字列
  geom     geometry(Point, 4326)        -- 类型列：点 + 坐标系，二选一都不能错
);
```

- `geometry(Point, 4326)` 里的 `4326` 就是 **SRID**（坐标系编号）。你在 W1 背过：4326 单位是度、3857 单位是"变形的米"、4490 是 CGCS2000。数据库把 SRID 焊死在列类型里，就是为了**不让数据"失忆"**——W2 讲过 .prj 丢失的灾难，库里靠这个字段防身。
- 类型全家福：`Point` / `LineString` / `Polygon` / `MultiPoint` / `MultiLineString` / `MultiPolygon`。**跨类型做运算大多要先对齐**（`ST_Multi(geom)` 把单面转成多多面）。
- 验证 SRID：`SELECT ST_SRID(geom) FROM schools LIMIT 1;` —— 返回 `-1` 意味着"这列不知道自己什么坐标系"，后面 `ST_Transform` 会直接报错（坑 P5）。
- 坐标系字典还在：`SELECT srtext FROM spatial_ref_sys WHERE srtext LIKE '%1984%';`（W1 结论 4 回收：`spatial_ref_sys` 就是 PostGIS 的坐标系字典，字典编号即 SRID）。

### 1.3 GiST 空间索引：为什么快（0.5 h）

> **学完你能做什么**：能用"字典目录/消防站"类比解释索引原理；看到 `ST_Distance < 500` 不走索引能说出为什么。

**概念四件套：GiST 空间索引**

- **定义**：一种按"空间上谁挨着谁"组织的索引。每个几何体用最小外接矩形（bounding box）入索引，查询先按盒子粗筛、再按真身精判。
- **类比**：**字典目录** + **消防站辖区**：先按目录锁定页码范围（粗筛），再细翻（精判）；着火先排除不可能的辖区。
- **最小示例**：`CREATE INDEX schools_geom_idx ON schools USING gist (geom);`——预期输出 `CREATE INDEX`；失败时：`column "geom" does not exist` → 几何列名不对，`\d schools` 查列名。
- **常见误区**：① 以为建了索引所有空间查询都快——只有能翻译成 `&&` 粗筛的写法（`ST_DWithin`/`ST_Intersects`）才吃索引；② 以为索引越多越快——索引拖慢写入，一张表一个空间索引通常就够。

先想没有索引时数据库怎么查"500 米内有哪些学校"：**一行一行**把 2 万个点都算一遍真实距离——这就是"全表顺序扫描"，跟 Excel 里逐行看 2 万条筛选一样笨。

**字典目录类比**：查字典你不会从第一页翻起，先看目录定位到大概页码范围，再细翻。GiST 索引干的就是"目录"：

1. **粗筛（按盒子）**：每个几何体用一个最小外接矩形（bounding box）代表——"这所学校大概在这个方块里"。索引按区域组织这些盒子，查询时先只找**盒子可能沾边的**候选行。这就是消防站类比：着火了不会全城逐个排查建筑，先按辖区锁定不可能的片区直接排除。
2. **精筛（按真身）**：对少数候选行再算精确几何关系（"真相交吗？真在 500 米内吗？"）。

关键推论（EXPLAIN 实验的理论依据）：

- 空间 SQL 里的 `&&` 运算符（bounding box 相交）就是"粗筛"这一步，GiST 索引**只认 `&&`**。
- `ST_DWithin` / `ST_Intersects` / `ST_Contains` 写法上会被数据库自动翻译成"先 `&&` 粗筛 + 再精判"，**所以它们能吃到索引**。
- 但 `ST_Distance(geom, x) < 500` 这种写法吃不到：索引没法先粗筛，只能全表逐行算距离。**同样的问题，换个写法差 100 倍**——练习 2 实测。
- 为什么不用 Excel 那种"按值排序"的 B-tree 索引？几何体是二维对象**没有全局先后顺序**（A 点在 B 点东北，但 C 呢？），排序索引无从排起，所以空间索引按"空间上谁挨着谁"组织——GiST 就是干这个的。

### 1.4 十个必会函数（1.5 h，每个 5 分钟敲一遍）

> **学完你能做什么**：能在不查资料的情况下说出这 10 个函数各自"输入什么、吐什么"，并能给一条业务需求（如"找 500 米内的学校"）选出正确函数组合。

以下 SQL 都在【容器内 psql】的 `gislab` 库里跑。每例都是不依赖任何表也能跑的"玩具版"（自造几何），后面练习建了表再换真表名。

#### ① ST_AsText —— 几何 → 人眼可读的文本

- **语法**：`ST_AsText(geom) → text`
- **最小示例**：

  ```sql
  SELECT ST_AsText(ST_SetSRID(ST_MakePoint(113.2644, 23.1291), 4326));
  ```
  预期输出：

  ```text
         st_astext
  ------------------------
   POINT(113.2644 23.1291)
  ```
- **常见误用**：以为它顺便改了坐标系——它只显示**存储的原样**坐标，想看 3857 得先 `ST_Transform`。
- **业务场景**：导出坐标给人看、调接口时把几何序列化成 WKT 字符串。

#### ② ST_GeomFromText —— WKT 字符串 → 几何

- **语法**：`ST_GeomFromText(wkt, srid) → geometry`
- **最小示例**：

  ```sql
  SELECT ST_GeomFromText('POINT(113.2644 23.1291)', 4326);
  ```
  预期输出：一行十六进制串（`0101000020E6100000...`），这是几何的**内部二进制**，正常。
- **常见误用**：① 忘写第二参数 → SRID=-1（坑 P5）；② WKT 坐标用逗号 `POINT(113.2644, 23.1291)` → `parse error`，坐标间用**空格**（坑 P8）。
- **业务场景**：把前端/文本里的坐标批量灌进库（INSERT 时的标准写法）。

#### ③ ST_Transform —— 换坐标系

- **语法**：`ST_Transform(geom, 目标srid) → geometry`（返回新几何，不改原数据）
- **最小示例**：

  ```sql
  SELECT ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint(113.2644, 23.1291), 4326), 3857));
  ```
  预期输出：`POINT(12608535.33 2647638.58)`——与 [week01 笔记](../notes/week01.md) 第四节的广州实测值完全一致，可对表验算。
- **常见误用**：以为 `SELECT ST_Transform(...)` 改了表里的数据——SELECT 永远不改数据，要永久改得 `UPDATE t SET geom = ST_Transform(geom, 3857);`；源 SRID=-1 直接报错（坑 P5）。
- **业务场景**：库内存 4326，出图/量算前转投影坐标系。

#### ④ ST_Distance —— 最短距离

- **语法**：`ST_Distance(a, b) → 数值`，**单位跟类型走**：geometry=坐标系单位（4326 就是度），geography=米。
- **最小示例**：

  ```sql
  SELECT ST_Distance(
    ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography,
    ST_SetSRID(ST_MakePoint(1, 0), 4326)::geography
  );
  ```
  预期输出：`111319.49...`（赤道 1 度经度的真实米数）。
- **常见误用**：4326 geometry 直接算，把返回的"度"当米——新人空间 SQL 第一大事故（1.5 节专题）。
- **业务场景**："最近的小学有多远"、设施可达性分析。

#### ⑤ ST_DWithin —— "距离在阈值内吗"（首选）

- **语法**：`ST_DWithin(a, b, 距离阈值) → boolean`，**能吃索引**。
- **最小示例**：

  ```sql
  SELECT ST_DWithin(
    ST_SetSRID(ST_MakePoint(113.2644, 23.1291), 4326)::geography,
    ST_SetSRID(ST_MakePoint(113.2744, 23.1291), 4326)::geography,
    1500
  );
  ```
  预期输出：`t`（true，两点约 1 km）。
- **常见误用**：① 先 `ST_Buffer` 造圆再判相交——干两遍活还用不上索引；② 4326 裸写 500 那是 500 **度**。
- **业务场景**：所有"X 米内有什么"（外卖范围、学区摸排）永远首选它。

#### ⑥ ST_Intersects —— 有没有任何重叠

- **语法**：`ST_Intersects(a, b) → boolean`（相交/包含/擦边都算），内部"盒子粗筛+精判"，吃索引。
- **最小示例**：

  ```sql
  SELECT ST_Intersects(
    ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326),
    ST_GeomFromText('POINT(0.5 0.5)', 4326)
  );
  ```
  预期输出：`t`。
- **常见误用**：拿它当"距离近"——隔 3 公里不相交就是 false；也别说它"不准"：差 0.1 毫米没相交就是没相交，拓扑判定是严格的。
- **业务场景**：叠加分析的入口——"哪些地块与河道蓝线相交"。

#### ⑦ ST_Contains —— a 完整包住 b（有方向）

- **语法**：`ST_Contains(a, b) → boolean`，**第一个参数必须是"大的那个"**。
- **最小示例**：

  ```sql
  SELECT ST_Contains(
    ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326),
    ST_GeomFromText('POINT(0.5 0.5)', 4326)
  );
  ```
  预期输出：`t`。
- **常见误用**：a、b 写反 → 变成"点包含面"，**永远 false 且不报错**，统计结果静默归零——比报错更可怕（坑 P9）。口诀："谁包含谁"按大小写，大的在前。
- **业务场景**：空间版 GROUP BY——"每个行政区内有多少所学校"。

#### ⑧ ST_Buffer —— 缓冲区多边形

- **语法**：`ST_Buffer(geom, 半径) → Polygon`，半径单位同样跟类型走。
- **最小示例**：

  ```sql
  SELECT ST_AsText(ST_Buffer(ST_SetSRID(ST_MakePoint(113.2644, 23.1291), 4326)::geography, 500)::geometry);
  ```
  预期输出：一个 32 边形的 `POLYGON((...))` 长串（WKT 很长属正常）。
- **常见误用**：4326 上 `ST_Buffer(geom, 0.005)` 想当 500 米用：0.005 是度，东西/南北换算还不同（W1 实测），必须先 `::geography` 或转投影系。
- **业务场景**：W10 选址分析主力——"地铁站 800 米覆盖范围"。

#### ⑨ ST_Area —— 面的面积

- **语法**：`ST_Area(geom) → 数值`，单位跟类型走。
- **最小示例**：

  ```sql
  SELECT ST_Area(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326)::geography);
  ```
  预期输出：`12303000000` 上下的数值（一个"度格子"在赤道附近的真实平方米数）。
- **常见误用**：对 4326 geometry 直接拿结果当平方米——那是"平方度"，毫无意义。**这比 W1 的 QGIS 坑 N9（椭球没选）更隐蔽**，因为数值看着挺像面积。
- **业务场景**："各区面积 km²"、图斑占地统计。

#### ⑩ ST_Intersection —— 公共几何（返回的是形状不是真假）

- **语法**：`ST_Intersection(a, b) → geometry`（两者的公共部分），可再套 `ST_Area`。
- **最小示例**：

  ```sql
  SELECT ST_AsText(ST_Intersection(
    ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))', 4326),
    ST_GeomFromText('POLYGON((1 1,3 1,3 3,1 3,1 1))', 4326)
  ));
  ```
  预期输出：`POLYGON((1 1,2 1,2 2,1 2,1 1))`——两个方块的公共部分。
- **常见误用**：① 多面 × 多面可能返回 `GEOMETRYCOLLECTION`，直接套 `ST_Area` 报错，需 `ST_CollectionExtract(x, 3)` 抽出面；② 完全不相交时返回**空集合而不是 NULL**，判空用 `ST_IsEmpty` 而不是 `IS NULL`。
- **业务场景**："这块地与基本农田的重叠面积"（练习 3 查询 3 就是它）。

### 1.5 专题：为什么 4326 直接 ST_Distance 不能当米用（0.5 h，验收项 3）

> **学完你能做什么**：能用一条 SQL 演示"4326 下 ST_Distance 返回的是度"，并写出两种正确写法（`::geography` 或 `ST_Transform` 到投影带）；面试被问这题能当场给出数字证据。

**跑给你自己看**（【容器内 psql】）：

```sql
-- 北京(116.407,39.904) 到 上海(121.474,31.230)：三种写法三种答案
SELECT
  ST_Distance(
    ST_SetSRID(ST_MakePoint(116.407, 39.904), 4326),
    ST_SetSRID(ST_MakePoint(121.474, 31.230), 4326)
  ) AS 裸geometry_度,          -- ≈ 10.05，这是"度"，别问多少米
  ST_Distance(
    ST_SetSRID(ST_MakePoint(116.407, 39.904), 4326)::geography,
    ST_SetSRID(ST_MakePoint(121.474, 31.230), 4326)::geography
  ) AS geography_米            -- ≈ 1065850，与 W1 实测 1065.85 km 吻合
;
```

三层理解：

1. **单位定义**：`ST_Distance(geometry)` 只做坐标数值间的算术，4326 的坐标是经纬度，结果自然是"度"。而 1 度 ≈ 111 km 只是**沿经线**的粗略值——纬线方向上 1 度的实际长度随纬度按 `cos(纬度)` 收缩（W1 实测：广州东西 1 度 102.4 km、南北 1 度 110.8 km，**两个方向都不等长**，度根本没有统一米数）。
2. **两条正路**：
   - **投影法**：`ST_Distance(ST_Transform(a, 4523), ST_Transform(b, 4523))`——转投影坐标系（如 CGCS2000 带号投影 4523，或局部小范围用 3857），单位是米，代价是投影本身有变形（W1 已量化：3857 下广州 +8.7%、挪威 +103%）。
   - **geography 法（本周主推）**：`ST_Distance(a::geography, b::geography)`——`::geography` 是**类型转换**（"把这份数据当作地球表面上的地理量来算"），PostGIS 改用椭球面公式，结果直接是米，精度最高。写熟了可以省成 `a::geography` 出现在任何函数参数位。
3. **性能与语义边界**：geography 版 `ST_DWithin` 依然先借 geometry 列上的 GiST 索引粗筛再精算，**不是慢的代名词**；但 geography 只支持点/线/面基础量算，复杂叠加运算还得回 geometry。选型口诀：**量距离面积用 geography 或投影，做拓扑叠加用 geometry，全程心里有 SRID**。

### 1.6 ogr2ogr 把文件灌进 PostGIS（0.5 h）

> **学完你能做什么**：能把 W2 产出的 GeoJSON 一条命令导入 `gislab` 库，导入后用 `ogrinfo` 和 `SELECT count(*)` 双重确认要素数一致；能说清宿主机用 `127.0.0.1`、容器内用 `host.docker.internal` 的区别。

命令在【OSGeo4W Shell】里跑（Windows 宿主机 → 容器：容器端口 5432 已映射到宿主机，所以宿主机上用 `127.0.0.1` 是对的；**只有在容器里的程序才需要 `host.docker.internal`**，见坑 P3，这是 W8 的关键伏笔）。

```bash
# 【OSGeo4W Shell】连串写法：驱动名 PostgreSQL + 冒号 + 双引号包裹的连接参数串
ogr2ogr -f "PostgreSQL" \
  PG:"host=127.0.0.1 port=5432 dbname=gislab user=postgres password=postgres" \
  /d/xx/GitProjects/gis-learning/projects/data-lab/guangzhou.gpkg \
  -nln gz_districts -t_srs EPSG:4326 -lco GEOMETRY_NAME=geom -overwrite
```

| 参数 | 干什么 | 不注意会怎样 |
| --- | --- | --- |
| `-f "PostgreSQL"` | 输出驱动 | 与后面 `PG:"..."` 配对，漏 `-f` 报格式错误 |
| `PG:"host=... password=..."` | **连接串**：`PG:` 是 PostgreSQL 驱动的连接串前缀，引号内空格分隔键值对 | 密码里的特殊字符要处理（坑 P7）；库必须已存在且装好 postgis 扩展（坑 P4） |
| `-nln gz_districts` | **新表名**（name of layer New）：不写就用源图层名（GPKG 里叫啥建出来就叫啥） | 表名带大写/中文，之后查询要 `"` 包，找麻烦 |
| `-t_srs EPSG:4326` | 导入时**重投影**到 4326（W2 学的：同时定义了简化容差的单位语境，这里定义存储坐标系） | 不写则原样存，源无 .prj 时落 SRID=-1（坑 P5） |
| `-lco GEOMETRY_NAME=geom` | 建表选项：几何列叫 `geom`（社区默认名，后面写 SQL 少打字） | 默认列名可能变成 `the_geom`/`msGeometry` 之类 |
| `-overwrite` | 表存在就先删重建 | 不加会报错退出；反复导入时用（也可换 `-append -upsert`） |

- 只导一部分：加 `-where "adcode=440100"`（和 W2 的参数复用，看到它眼熟吧）。
- 备选 `shp2pgsql`【容器内 bash】：`shp2pgsql -s 4326 -I -d 输入.shp gz_districts | psql -U postgres -d gislab`。`-I` 顺手建 GiST 索引、`-d` 先清表；但它是 **shp 专用**，且要进容器操作。两条都会，面试问到能接上即可；日常用 ogr2ogr 通吃。
- PowerShell 里引号嵌套规则和 Git Bash 不同，整串换成：`ogr2ogr -f PostgreSQL '"host=127.0.0.1 dbname=gislab user=postgres password=postgres"' ...`（外层单引包住内层双引号，坑 P7）。

### 1.7 EXPLAIN ANALYZE：让数据库把"查法"演给你看（0.5 h）

> **学完你能做什么**：能看懂执行计划里的 Seq Scan / Bitmap Index Scan / Rows Removed by Filter / Execution Time 四要素，并用它证明"索引生效了"（这是 W7 验收项 1 的硬证据）。

`EXPLAIN` 打印执行计划（数据库打算怎么查），前面加不上、后面加 `ANALYZE` 才**真执行并附实测耗时**。逐行解读示例——3 万点的学校表查"CBD 500 米内的学校"，**无索引时**：

```text
Seq Scan on schools  (cost=0.00..6312.42 rows=1 width=36)
                     (actual time=52.3..58.7 rows=214 loops=1)
  Filter: (geom && ...) AND st_dwithin(geom::geography, ...::geography, 500)
  Rows Removed by Filter: 29786
Execution Time: 58.9 ms
```

- 第一行 `Seq Scan`：**顺序扫描 = 全表逐行**，2 万行一个不放过。`cost=0.00..6312.42` 是数据库的"预估工分"（前值=启动成本，后值=总成本，单位是相对页读写代价，不是毫秒）。
- `rows=1` 是**预估**行数，`actual ... rows=214` 是**实际**行数——预估和实际差很多说明统计信息旧了（`ANALYZE schools;` 可刷新，这是分号 SQL，别和反斜杠命令混）。
- `Rows Removed by Filter: 29786`：**被筛掉的行数**——"逐行看了 3 万、扔掉 2.98 万"，这就是没索引的自证。
- `Execution Time`：真实总耗时，这才是你做对比实验记录的那个数。

**建了 GiST 索引之后**（`CREATE INDEX schools_geom_idx ON schools USING gist (geom);`）：

```text
Bitmap Heap Scan on schools  (cost=8.50..1024.30 rows=230 width=36)
                             (actual time=3.1..5.4 rows=214 loops=1)
  Recheck Cond: (geom && ...)
  ->  Bitmap Index Scan on schools_geom_idx  (cost=0.00..8.44 rows=230)
                                            (actual time=2.9..2.9 rows=310 loops=1)
        Index Cond: (geom && st_expand(..., 500))
Execution Time: 5.6 ms
```

- `Bitmap Index Scan`：走**索引粗筛**——用盒子把 310 个候选圈出来（这就是 1.3 的"目录/消防站"第一步）。
- 上层 `Bitmap Heap Scan` + `Recheck Cond`：回表对这 310 行做**精判**（`st_dwithin` 真实距离），扔掉 96 个"盒子沾边但实际超出"的。
- 前后对比一句话（验收项 1 的标准答案）：**Seq Scan + Rows Removed by Filter ≈ 全表** → 全表扫描无索引；`Bitmap Index Scan` → 先吃索引粗筛；执行时间 58.9 → 5.6 ms，数据量越大差距越悬殊。

> **判断口诀框（抄进笔记）**
>
> | 计划里看到 | 结论 | 怎么办 |
> | --- | --- | --- |
> | `Seq Scan` + `Rows Removed by Filter` 很大 | **没走索引**，逐行筛 | 查索引是否建（`\d 表名`）；查条件写法是否可粗筛（`ST_DWithin` ✓ / `ST_Distance < x` ✗）；跑 `ANALYZE 表名;` 刷新统计 |
> | `Bitmap Index Scan` + `Recheck Cond` | **走了索引**，粗筛+精判 | 正常态；候选多时仍会慢，属精判成本 |
> | `Index Scan`（无 Bitmap） | 索引+回表逐行 | 小结果集时数据库主动选择，不用干预 |
> | 有索引却还是 Seq Scan | 表太小 / 统计旧 / 写法不可粗筛 | 小表不用管；大表先 `ANALYZE`，再回头改写法 |

### 1.8 psql 把多行 SQL 文件跑起来（0.5 h，含 W0 坑 #9 的教训）

> **学完你能做什么**：能把本周所有查询沉淀成 `sql/*.sql` 文件、一条命令整文件执行；能避开 BOM/编码两个隐形杀手（保存前看 VS Code 右下角是不是 UTF-8）。

把练习 SQL 存成 `.sql` 文件是本周的正规姿势（可复现、可提交 Git）。**别在记事本里裸写**：W0 坑 #9 的教训是编码/格式问题能把成果悄悄毁掉——本条对应的是**UTF-8 无 BOM**。

- VS Code 右下角编码确认 `UTF-8`；中文注释保存前用 `状态栏 → Save with Encoding → UTF-8`（不要 UTF-8 with BOM，psql 会把 BOM 当怪字符报错）。
- 中文写进库前确认 psql 客户端编码：`\encoding` 查看，一般容器内默认 UTF8，不用动；乱码先查文件编码再查终端（PowerShell 显示乱码 ≠ 库里是乱的，W1 坑 N3 的老教训——先证明数据没问题）。
- 执行：【容器内 psql】`\i /path/01_setup.sql`（注意容器内路径是 Linux 风格）；或 PowerShell 一行流：

```powershell
# 【PowerShell】把宿主机文件塞进容器执行（挂载的 projects 目录两边都可见时用）
Get-Content sql/01_setup.sql -Raw -Encoding UTF8 | docker exec -i pgis psql -U postgres -d gislab
```

---

## 2. 练（本周主体，产出物进 `projects/postgis-lab/`）

> 0.5 倍建议：以下 SQL 全部边敲边看结果，抄进 `sql/` 目录存档。预期现象都写了，对不上就是踩坑了，回第 4 节查。

### 练习 1：建库建表 + 导入 W2 数据（周一，主计划练 1）

**为什么做**：跑通"文件 → 数据库"这条路，W8 的 GeoServer 就吃这里的库。这是阶段二闭环的第一块砖。

**前置检查**：

- [ ] `docker ps` 能看到 `pgis` 状态 Up（Exited → `docker start pgis`，坑 P2）
- [ ] `projects/data-lab/guangzhou.gpkg` 存在（W2 产出）
- [ ] 已进过 psql 并执行过 `\pset pager off`（坑 P1）

**步骤**：

1. 建库并启用 PostGIS（【PowerShell】）：
   ```powershell
   docker exec -it pgis psql -U postgres -c "CREATE DATABASE gislab;"
   docker exec -it pgis psql -U postgres -d gislab -c "CREATE EXTENSION postgis;"
   ```
   **预期现象**：两条各回一个 `CREATE DATABASE` / `CREATE EXTENSION`。再 `SELECT postgis_full_version();` 能看到 `POSTGIS="3.4.3"`——与 W0 笔记第四节的版本基线对上。
   **失败分支**：报 `database "gislab" already exists` → 已建过，直接下一步；报 `type "geometry" does not exist`（后面建表时）→ 这个库没装扩展 → 坑 P4。
2. 用 1.6 的 ogr2ogr 命令导入 `guangzhou.gpkg`（在【OSGeo4W Shell】，路径改你的实际路径）。
   **预期现象**：命令无任何输出即成功（GDAL 的沉默是金）。
   **失败分支**：`Unable to open datasource` → 连接串引号问题 → 坑 P7；`connection refused` → pgis 没跑 → 坑 P2。
3. 验货（【容器内 psql】）：
   ```sql
   \dt                              -- 预期：出现 public.gz_districts
   SELECT count(*), ST_SRID(geom) FROM gz_districts GROUP BY 2;   -- 预期：11 行（或你 W2 的区数）、SRID=4326
   SELECT name, ST_AsText(geom) FROM gz_districts LIMIT 3;        -- 预期：WKT 是 POLYGON((113.xx 23.xx, ...)) 形态
   ```
   若数量对不上或 SRID=-1 → 坑 P5，重导并检查 `-t_srs`。

**完成自查**：

- [ ] `\dt` 能看到 `gz_districts`
- [ ] 行数与 W2 源数据一致，SRID=4326
- [ ] 导入命令已存进 `projects/postgis-lab/03_import.sh`（或 .ps1），含逐参数注释

### 练习 2：造三张业务表 + 索引对比实验（周二~周三，主计划练 2）

**为什么做**：真实数据（行政区）当"底"，业务数据（学校/地铁/图斑）用 PostGIS **自己造**——学会 `ST_GeneratePoints` 既省去找数据的功夫，又天然练习本周函数。索引实验需要一张几千行以上的点表，现造正合适。

**前置检查**：

- [ ] 练习 1 完成，`gz_districts` 有 11 行且 SRID=4326
- [ ] 已建 `projects/postgis-lab/sql/` 目录，VS Code 编码确认 UTF-8 无 BOM（1.8 节）

**步骤**：

1. 建表灌数（存为 `sql/02_synth_data.sql`，【容器内 psql】`\i` 执行）：
   ```sql
   CREATE TABLE schools (id serial PRIMARY KEY, district text, geom geometry(Point, 4326));
   -- 每个区撒 3000 个点当"学校"：ST_GeneratePoints 生成多多面点集，ST_Dump 拆成单点
   INSERT INTO schools (district, geom)
   SELECT d.name, ST_SetSRID((ST_Dump(ST_GeneratePoints(d.geom, 3000))).geom, 4326)::geometry(Point,4326)
   FROM gz_districts d;
   CREATE TABLE subway_lines (id serial PRIMARY KEY, name text, geom geometry(LineString, 4326));
   INSERT INTO subway_lines (name, geom) VALUES
     ('3号线', ST_SetSRID(ST_GeomFromText('LINESTRING(113.32 23.16,113.34 23.13,113.36 23.08)'), 4326)),
     ('5号线', ST_SetSRID(ST_GeomFromText('LINESTRING(113.20 23.14,113.28 23.125,113.38 23.12)'), 4326));
   CREATE TABLE landuse (id serial PRIMARY KEY, class text, geom geometry(Polygon, 4326));
   -- 每区 40 个半径 600 米的圆当"地块图斑"（geography 缓冲保证米数是真的，1.5 节知识复用）
   INSERT INTO landuse (class, geom)
   SELECT '住宅', ST_Buffer(ST_SetSRID((ST_Dump(ST_GeneratePoints(d.geom, 40))).geom, 4326)::geography, 600)::geometry
   FROM gz_districts d;
   SELECT count(*) FROM schools; SELECT count(*) FROM landuse;   -- 预期：约 3.3 万 / 约 440
   ```
2. **无索引基线**（记下耗时）：
   ```sql
   EXPLAIN ANALYZE
   SELECT count(*) FROM schools
   WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(113.2644,23.1291),4326)::geography, 500);
   ```
   **预期现象**：计划里是 `Seq Scan`，`Rows Removed by Filter` 三万左右，`Execution Time` 几十毫秒。
3. 建索引再跑同一句：
   ```sql
   CREATE INDEX schools_geom_idx ON schools USING gist (geom);
   EXPLAIN ANALYZE SELECT count(*) FROM schools WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(113.2644,23.1291),4326)::geography, 500);
   ```
   **预期现象**：变成 `Bitmap Index Scan on schools_geom_idx` + `Bitmap Heap Scan`，耗时降一个量级。**截图/粘贴两份计划存进 `notes.md`，标出 1.7 节讲过的每一行。**
4. 反面对照（写进笔记，这是面试答案）：把查询改成
   ```sql
   EXPLAIN ANALYZE SELECT count(*) FROM schools
   WHERE ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(113.2644,23.1291),4326)::geography) < 500;
   ```
   **预期现象**：索引失效，退回 `Seq Scan`——距离条件写在比较里，索引无法粗筛。**同义两句 SQL，快慢差数倍**，这就是"会写"和"写对"的区别。

**完成自查**：
- [ ] 两份 EXPLAIN 计划（无索引 / 有索引）已粘贴进 `notes.md`，并标出 `Seq Scan`、`Rows Removed by Filter`、`Bitmap Index Scan`、`Recheck Cond` 各在哪一行
- [ ] 能说出 `ST_DWithin` 走索引、`ST_Distance(...) < 500` 不走的根本原因（索引只做"盒子粗筛"，逐行距离精判无法粗筛）
- [ ] 记录了三组 Execution Time 数字（无索引 / 有索引 / 反例写法），并说明数据量越大差距为何越悬殊

### 练习 3：五条有业务意义的查询 + 导出 GeoJSON（周四，主计划练 3）

**前置检查**：
- [ ] 练习 1/2 已建好表并灌了数据：`SELECT count(*) FROM schools;` 和 `FROM gz_districts;` 都返回非 0
- [ ] 学校表已建 GiST 索引（练习 2 的产物；没建索引也能跑，但第 2 条查询会慢到让你怀疑人生——正好当对照组）
- [ ] `sql/04_business_queries.sql` 已在 VS Code 建好且右下角编码为 UTF-8（避开 1.8 节的 BOM 坑）

**为什么做**：验收项 2 要求"5 条写对且能导出 GeoJSON"。五条全部贴着主计划的例子做，写进 `sql/04_business_queries.sql`。前两条就是计划原文点名的：

1. **每个行政区内学校数并排序**（`ST_Contains` 有方向的教训别忘）：
   ```sql
   SELECT d.name, count(s.id) AS n_schools
   FROM gz_districts d LEFT JOIN schools s ON ST_Contains(d.geom, s.geom)
   GROUP BY d.name ORDER BY n_schools DESC;
   ```
   为什么 `LEFT JOIN`：某区一所学校没有时也要出现在结果里显示 0。
2. **距离 3 号线 500 米内的所有地块**（`ST_DWithin` + geography）：
   ```sql
   SELECT l.id, l.class, ST_AsText(l.geom)
   FROM landuse l
   WHERE ST_DWithin(l.geom::geography, (SELECT geom FROM subway_lines WHERE name = '3号线')::geography, 500);
   ```
3. **两图层相交面积大于 1 平方公里的图斑**（`ST_Intersection` + `ST_Area::geography`，误用 10 回收）：
   ```sql
   SELECT r.id, d.name, ST_Area(ST_CollectionExtract(ST_Intersection(r.geom, d.geom), 3)::geography)/1e6 AS inter_km2
   FROM landuse r JOIN gz_districts d ON ST_Intersects(r.geom, d.geom)
   WHERE ST_Area(ST_CollectionExtract(ST_Intersection(r.geom, d.geom), 3)::geography) > 1000000;
   ```
4. **离广州塔最近的 3 所学校及距离**（`<->` 索引加速的"最近邻"排序——1.3 的延伸，写进笔记）：
   ```sql
   SELECT id, district, ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(113.3178,23.1063),4326)::geography) AS dist_m
   FROM schools ORDER BY geom <-> ST_SetSRID(ST_MakePoint(113.3178,23.1063),4326) LIMIT 3;
   ```
5. **各区面积（km²）+ 学校密度（所/百km²）**（`ST_Area` 正确姿势 + 聚合）：
   ```sql
   SELECT d.name, ST_Area(d.geom::geography)/1e6 AS km2,
          count(s.id) AS n, round(count(s.id)*100.0/(ST_Area(d.geom::geography)/1e6), 1) AS schools_per_100km2
   FROM gz_districts d LEFT JOIN schools s ON ST_Contains(d.geom, s.geom)
   GROUP BY d.id, d.name ORDER BY schools_per_100km2 DESC;
   ```

**导出 GeoJSON**（验收项 2 后半），两条路都走一遍：

```bash
# 【OSGeo4W Shell】整层导出
ogr2ogr -f GeoJSON schools_gz.geojson PG:"host=127.0.0.1 dbname=gislab user=postgres password=postgres" -nln schools
# 【OSGeo4W Shell】查询结果导出：-dim 2 只取点
ogr2ogr -f GeoJSON near_3line.geojson PG:"host=127.0.0.1 dbname=gislab user=postgres password=postgres" \
  -sql "SELECT id, class FROM landuse WHERE ST_DWithin(geom::geography, (SELECT geom FROM subway_lines WHERE name='3号线')::geography, 500)"
```

```sql
-- 【容器内 psql】纯 SQL 版：单条转 GeoJSON 文本，拼 FeatureCollection
SELECT json_build_object('type','FeatureCollection','features', json_agg(ST_AsGeoJSON(t)::json))
FROM (SELECT id, district, geom FROM schools LIMIT 100) t;   -- ST_AsGeoJSON(record) 自动把 id/district 当属性
```
**做对了的标志**：导出的 `.geojson` 拖回 `webgis-starter` 能显示（W2 的拖拽导入还在），属性弹窗里字段齐全——文件→库→文件闭环，顺便证明数据没在导入时坏掉。

**完成自查**：
- [ ] 5 条查询全部跑通，结果合理（区数 = 行政区数、密度非负、计数无异常 0）
- [ ] 至少一条结果用两种方式导出成 GeoJSON（`ogr2ogr` + 纯 SQL `ST_AsGeoJSON`），并拖回前端验证显示与属性齐全
- [ ] `sql/04_business_queries.sql` 能用一条 `\i` 或管道命令整体重放（可复现 = 可交付）

---

## 3. 验收标准（全过才算 W7 通关）

- [ ] 能解释索引前后 `EXPLAIN` 输出的差异：能指认 `Seq Scan`/`Rows Removed by Filter`/`Bitmap Index Scan`/`Recheck Cond` 各是什么，并说出 `ST_Distance(...) < 500` 写法为何不走索引（截图两份计划存笔记）
- [ ] 5 条业务查询全部写对（结果合理：区数=行政区数、密度非负），且至少一条用两种方式导出成 GeoJSON 并拖回前端验证过
- [ ] 能说清"为什么不能把 4326 的数据直接 `ST_Distance` 当米用"：单位是度 + 度没有统一米数 + 两条正路（投影/geography cast），并能当堂默写北京–上海两种写法
- [ ] ogr2ogr 导入命令能逐参数解释（`-nln`/`-t_srs`/`PG:"..."`/`-overwrite`）
- [ ] 三个认知表能不看笔记复述；十个函数的常见误用至少能各举一例
- [ ] 产出物已提交 Git：`projects/postgis-lab/`（含 `sql/` 全套，能一键 `\i` 重放）

---

## 4. 坑预告（按你的环境定制，遇到就回来打勾）

| # | 预判的坑 | 症状 | 解法 |
| --- | --- | --- | --- |
| P1 | psql 分页器又卡住 | 查询结果多了底部显示 `END`，敲什么都没反应 | 按 `q` 退出分页；进去先 `\pset pager off`（W0 真实坑 #7 的续集，本周长输出多了十倍） |
| P2 | 电脑重启后容器停了 | `ogr2ogr` 报 `connection to server at "127.0.0.1", port 5432 failed`；`docker ps` 里没有 pgis | **数据不会丢**（在容器可写层/卷里），只是容器停了：`docker ps -a` 确认是 `Exited` → `docker start pgis`（week01 第五节备忘）。本周天天连库，先养成"连不上先看容器"的反射 |
| P3 | `localhost` 在容器里指谁想当然 | 在容器里/别的容器里连 `localhost:5432` 报 `connection refused`，明明宿主机能连 | **谁运行命令，localhost 就是谁的机器**：容器里 `localhost` = 容器自己；其他容器连宿主机上的 pgis 用 `host.docker.internal:5432`（Docker Desktop 专属）。这是 W8 GeoServer 连库的头号坑，今天先认识 |
| P4 | 新库没装 PostGIS | ogr2ogr 报 `no postgis found in any database` 或建表报 `type "geometry" does not exist` | 每个库要单独 `CREATE EXTENSION postgis;`。`CREATE DATABASE` 只建壳 |
| P5 | SRID 丢失 | `ST_Transform` 报 `transform: Could not convert point from unknown SRS`；`ST_SRID(geom)` 返回 -1 | 导入时 `-t_srs` 没给或源数据没带坐标系（W2 .prj 丢失的库内版）。临时救：`UPDATE t SET geom = ST_SetSRID(geom, 4326);`——**先确认数据真是 4326 再设**，设错比没设更毒 |
| P6 | 把 4326 距离当米 | 查询"500 米内"返回一堆不相干结果，或结果恒空 | 结果值 0.0045 这种量级就是度。用 `::geography` 或先投影（1.5 节）。这不是 bug 是认知 bug，写进笔记反复自查 |
| P7 | PowerShell 里连接串引号打架 | `ogr2ogr ... PG:"host=..." ` 报 `Unable to open datasource` 或参数被拆碎 | PS 和 Git Bash 转义规则不同：PowerShell 外层用单引号 `'"host=127.0.0.1 dbname=gislab ..."'`；密码含特殊字符先换简单密码学习期用。顺便回忆 W0 坑 #8：Git Bash 里路径 `\` 是转义符 |
| P8 | WKT 里用逗号分隔坐标 | `ST_GeomFromText('POINT(113.2644, 23.1291)', 4326)` 报 `parse error - invalid geometry` | WKT 坐标间用**空格**：`POINT(113.2644 23.1291)`。GeoJSON 用逗号、WKT 用空格，两套语法别串门 |
| P9 | `ST_Contains` 方向反了不报错 | 分组统计结果全 0 | 返回 false 不是 error，静默出错最难查。口诀：**"谁包含谁"按大小写，大的在前**（1.4 #7） |

---

## 5. 本周产出物结构（提交到 Git）

```
projects/postgis-lab/
├─ README.md                  # 结论汇总：三认知、单位口诀、函数误用清单
├─ notes.md                   # 实验记录：两份 EXPLAIN 计划对比截图、耗时表
├─ sql/
│  ├─ 01_setup.sql            # 建库说明 + 建表（schools/subway_lines/landuse）
│  ├─ 02_synth_data.sql       # 练习 2：造数据 + 索引实验（注释标出 EXPLAIN 前后）
│  ├─ 04_business_queries.sql # 练习 3：5 条业务查询（每条带注释说明选型原因）
│  └─ 05_export.sql           # 导出实验（ST_AsGeoJSON 版；ogr2ogr 版在 06_export.sh）
├─ 03_import.sh               # 练习 1 的 ogr2ogr 导入命令（含注释）或 .ps1
├─ schools_gz.geojson         # 导出验证产物（小样本即可，别把 3 万点全推上库）
└─ near_3line.geojson         # 查询 2 的导出
```

> 大文件（完整导出）进 `.gitignore`，仓库里留生成命令——"可复现比结果文件重要"，这条原则从 W2 一直沿用。

---

## 6. W7 结束后的下一步预告（W8：GeoServer 发布服务）

W8 要把本周的 `gislab` 库变成标准 OGC 服务：GeoServer 容器将作为"翻译官"连上 `pgis`——**届时它连接宿主机上的数据库用的就是今天坑 P3 里埋的 `host.docker.internal`**，这个坑今天提前撞过，W8 就不会懵。另外把本周的表整理出"给谁看"的直觉：WMS 出图、WFS 给数据，你在 W3 背过的那张选型表下周落地。

> 纪律不变：卡住 2 小时 → 记坑表 → 跳过。本周过程记录写进 `notes/week07.md`（格式延续 [week01.md](../notes/week01.md) 第二节），通关后回来更新 README 进度表。
