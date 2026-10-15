# W8 实验手册：GeoServer 发布服务

> 对应《WebGIS 12 周学习计划》W8（见 [WebGIS-12周学习计划.md](WebGIS-12周学习计划.md)）。建议时间：2026-11-24 ~ 2026-11-30（每天 1.5~2 h）。
> 环境前提：**`pgis` 容器在跑且 `gislab` 库里有 W7 的表**（`docker exec -it pgis psql -U postgres -d gislab -c "\dt"` 能看到 `schools / gz_districts / subway_lines / landuse`）；Docker Desktop + 已配镜像加速（W0 坑 #5）；`webgis-starter` 可跑（npm，不用 pnpm——W0 坑 #1）；QGIS（用来当"第三方客户端"验证服务）。
> 承接 W3：WMS/WMTS/WFS/MVT 那张选型表你背过——本周把它从"纸上"变成"手里"。承接 W7 坑 P3：`host.docker.internal` 今天正式登场，这是本周头号关键知识。
> 交互动线：浏览器 → `http://127.0.0.1:8080/geoserver`（管理界面）；命令行全部在【PowerShell】，SQL 在【psql】（= 容器内），前端代码在 VS Code + <http://127.0.0.1:5173>。
> **本文命令前缀约定**（照抄前先看清在哪儿敲）：【PowerShell】宿主机终端｜【psql】容器内数据库（`docker exec -it pgis psql -U postgres -d gislab`）｜【GeoServer 后台→数据→工作区】登录后的网页点菜单路径｜【浏览器地址栏】贴 URL｜【浏览器 DevTools→Network】F12 打开后切到 Network 面板｜【QGIS】桌面软件。每条命令下面都写"预期输出"与"失败时"，对不上就查第 4 节坑表。

---

## 0. 本周要建立的三个认知

| # | 认知 | 为什么重要 |
| --- | --- | --- |
| 1 | **GeoServer 是"数据中介 / 翻译官"，不是数据仓库**：数据一直待在 PostGIS 里，GeoServer 只做两头翻译——把浏览器的 OGC 方言（WMS/WFS 请求）翻译成 SQL，把查询结果翻译回 PNG 图片或 GeoJSON | 理解它，才知道"后端改一条数据、前端刷新就变"是必然（数据源只有一个）；也才知道 GeoServer 挂了底图变灰但数据库无恙——排错时不会怀疑错地方 |
| 2 | **发布 = 四级流水线：工作区 → 数据存储 → 图层 → 样式**，缺一级都不算"发出去" | 新手在 GeoServer 里迷路（"我明明连上库了怎么图层没有？"）九成是跳了级。层级想清楚，每个界面该填什么自然就知道 |
| 3 | **同一份数据可以同时是"图"和"数据"：WMS 给像素、WFS 给要素**，选哪个是把"渲染/过滤/交互"的责任放到前端还是后端的取舍 | 验收项 2 的原题。取舍还有第三个隐藏代价：WFS 让前端 fetch 数据 → 撞上 CORS；WMS 只贴图 → 跨域压力小（W3 的 1.3 结论在此兑现） |

---

## 1. 学（约 4 小时，周一到周二）

### 1.1 翻译官模型 + 四级层级关系图（1 h）

> **学完你能做什么**：能不看笔记默画"工作区→存储→图层→样式"四级图，说出每一级在 GeoServer 后台对应哪个菜单；能解释"连上库但图层列表是空的"最可能跳了哪一级；能说清图层属性里 Native CRS / Declared CRS / bbox 三者各管什么。

先立人设。你手里已经有的：PostGIS 库（数据）、浏览器/前端（客户）。中间缺的就是翻译：

- 客户说："给我看天河区附近那层政区的**图片**。" → GeoServer 把这句话翻译成 `SELECT geom ... && ...`，问 PostGIS 要数据，渲染成 PNG 递回去。**（WMS）**
- 客户说："别给我图，把这些范围内的**要素本身**给我，我自己画、自己点。" → GeoServer 把表里的行翻译成 GeoJSON 递回去。**（WFS）**

四级层级（文字关系图，抄进笔记）：

```
工作区 Workspace ──「命名空间/部门」，如 gis，URI 如 http://gislab
 │     作用：隔离一组服务；URL 里的 /geoserver/{工作区}/wms 就是它
 └─ 数据存储 DataStore ──「仓库地址」：一个 PostGIS 库连接（host/db/user）或一个文件目录
       │    作用：告诉 GeoServer 去哪儿取数；一个库 = 一个存储
       └─ 图层 Layer ──「具体上架的那张表/那张图」：如 gis:schools
       │      作用 = 服务开关：勾 WMS 就能被出图、勾 WFS 就能被下载数据；
       │      还管坐标系声明（原生 CRS / 声明 CRS / 可发布的 CRS 列表）
       └─ 样式 Style ──「装帧规范」：一个 SLD 文件（XML），规定颜色、线宽、标注
              作用：与图层解耦——同一个图层可挂多个样式，请求时 ?STYLES=xxx 换装
```

**概念四件套：四级层级**

- **定义**：Workspace = 服务命名空间（URL 的一段）；DataStore = 一个外部数据源连接参数集；Layer = 数据源里某张表/某张图 + 它的服务开关与坐标系声明；Style = 一个 SLD，只管"怎么画"。
- **类比**：**工作区=部门，存储=材料库地址，图层=借阅的某柜材料，样式=装订标准**。部门下多个库、一个库多张表、一张表可多种装订。
- **最小示例**：【GeoServer 后台→左上角 "About this GeoServer" 下方或右上角 Admin→Diagnostics→Configuration Summary】打开能看到一棵树，从 `WorkspaceInfo[gis]` 往下依次是 `DataStoreInfo[pgis_gislab]`、`FeatureTypeInfo[gis:gz_districts]`——四级层级在真实配置里就长这样，一眼验证你发布到了哪一级。**预期输出**：四个节点名与你的填写一一对应。**失败时**：只看到 Workspace 没有 Layer → 你停在第二级，去 `Layers→Add new Layer`。
- **常见误区**：① 以为"建了存储就等于发布了图层"——存储只是地址，图层才上架；② 以为样式属于图层——样式是独立资源，可被多个图层复用（练习 4 就靠这点做 `STYLES=` 切换）；③ 一个库重复建两个存储，图层列表出现两套同名表，QGIS 里选错那个改不动——**一个库只留一个存储**。
- 一个常见误解先打掉：GeoServer 管理界面"图层预览"出的那张图，也是 WMS `GetMap`——预览只是帮你把 URL 拼好的按钮，不是独立机制。

**图层坐标系三件套（发布时最容易点错的地方，练习 2 会逐字段做）**：

| 东西 | 是什么 | 类比 | 填错的后果 |
| --- | --- | --- | --- |
| Native CRS | 数据**实际**存的坐标系（读自库内 SRID，别手改） | **实际住址**：你就住在那个门牌号上 | 改成数据不是的 CRS，几何被"重新解释"，图层跑到非洲/索马里（坑 P9） |
| Declared CRS | 你**对外声明**要用的坐标系（可选"Reproject to"让服务转换） | **身份证地址**：写在证件上给人看，可以不同 | 声明了 3857 但没勾 Reproject，前端按 3857 请求 → 空白 |
| Native bbox | 数据的**真实外接矩形**（必须点 Compute from data 才算出来） | 房产证上量的实际四至 | **不点 → 预览整张灰图**（坑 P6，本手册最高频） |
| Declared bbox | 对外承诺的覆盖范围（Reproject 后要重新算；勾选 "Omit bbox nav" 之类不折腾） | 身份证上写的辖区 | 与 Native 不一致又开了 "use declared for downloads"，下载/请求范围被裁掉，看着"少了一半图" |

> 记一句：**bbox 是"我只在这个范围里给你出图"**——GeoServer 先拿请求 bbox 与图层 bbox 求交，交集为空就返回空白 PNG，不报错。这就是"发布成功但看不到东西"的第一现场。

### 1.2 WMS vs WFS：复习 W3 + 落到真实 URL（1 h）

> **学完你能做什么**：能手写出一条 WMS GetMap 和一条 WFS GetFeature 并贴进地址栏跑出结果；能从 URL 参数判断"这次是服务器在干活还是前端在干活"；能解释"改库一条数据刷新就变"的原理。

[W3 手册](W3-Web与瓦片渲染原理-实验手册.md) 1.5 节的结论回收：**WMS 给"冲洗好的照片"，WFS 给"底片"**。本周把它变成两条贴进【浏览器地址栏】的 URL（图层名以你实际发布的为准，先做完练习 2 再回来试）：

```text
# WMS GetMap —— 让服务器渲染一张 800×600 的 PNG 图给你（浏览器直接显示为图片）
http://127.0.0.1:8080/geoserver/gis/wms?service=WMS&version=1.1.1&request=GetMap
  &layers=gis:gz_districts&styles=&bbox=112.9,22.9,113.6,23.9
  &width=800&height=600&srs=EPSG:4326&format=image/png

# WFS GetFeature —— 把要素本身给你（outputFormat=application/json 时浏览器显示 JSON）
http://127.0.0.1:8080/geoserver/gis/wfs?service=WFS&version=2.0.0&request=GetFeature
  &typeNames=gis:gz_districts&count=2&outputFormat=application/json
```

（贴进浏览器前把换行删掉拼成一行；URL 里空格实际要编码成 `%20`，浏览器会自动处理。）

**概念四件套：一次请求的"最小可跑示例"**

- **定义**：WMS 出图三必填 = `layers` + `bbox` + `width/height` + `srs` + `format`；WFS 取数三必填 = `typeNames` + `request=GetFeature` + `outputFormat`。
- **类比**：WMS = **让餐厅拍照发给你**（你能看见菜，拿不到食材）；WFS = **让餐厅把食材快递给你**（自己做菜，但运费=CORS 与流量）。
- **最小示例**：【浏览器地址栏】贴上面两条。**预期输出**：第一条浏览器显示一张带颜色的政区 PNG（右键"复制图片地址"能看到完整参数）；第二条显示 `{"type":"FeatureCollection",...`。**失败时**：返回 `Service Exception` XML → 逐字段核对 `layers=` 的名字是否带工作区前缀（`gis:`），以及该图层是否勾了对应服务（回 1.1 第四级检查）。
- **常见误区**：① 以为 WMS 返回的 PNG 里有"属性"（其实只能靠 `GetFeatureInfo` 凑合）；② 以为 `bbox` 和图层 bbox 不符会报错（不报错，返回空白图）；③ WFS 忘加 `count` 一次拖全表 3.3 万点，前端假死。

对比着看，差异就出来了：

| 对比点 | WMS（上面那条） | WFS（下面那条） |
| --- | --- | --- |
| 响应 Content-Type | `image/png` —— 像素 | `application/json` —— 属性 + 几何 |
| 参数里谁在干活 | `bbox` + `width/height`：服务器按你的视野**现渲染**，缩放窗口尺寸图就变 | `typeNames` + `count`/`bbox`/`CQL_FILTER`：服务器只**取数**，怎么画是前端的事 |
| 点击弹窗能不能做 | 不能（图上没有"要素"概念，只能靠 GetFeatureInfo 凑合） | 天然能（属性都在手边） |
| 数据改动静敏度 | 每次请求现渲染，刷新即变 | 每次请求现查询，刷新即变 |
| 适合场景 | 样式复杂、数据不想外泄、量大的背景层 | 中小数据量、要前端交互/过滤/编辑 |

**"后端改一条数据，前端刷新能看到"（验收项 1）的原理**就在这里：两条服务都是**请求时现查库**，中间不存副本。所以练习 3 里你在 psql 里 `UPDATE` 一个学校名字，前端图层一刷新就该变——不改才说明中间有缓存或你接错了数据源。

### 1.3 GetCapabilities：服务的"说明书"怎么看（0.5 h）

> **学完你能做什么**：能在浏览器里用 Ctrl+F 三分钟定位"图层名、支持的 CRS、默认样式、可用格式"；能判断"前端接不上"是名字写错还是 CRS 不在列表；能把一份 Capabilities 存档并在旁边标注关键行。

浏览器打开（【浏览器地址栏】）：`http://127.0.0.1:8080/geoserver/gis/wms?service=WMS&request=GetCapabilities`。

这是 XML，浏览器默认挤成一行难读。**精确操作步骤**（照着做）：

1. 地址栏贴 URL 回车 → 页面显示一片 XML 文字（不是图片就是对的）。
2. 按 `Ctrl+F` 打开浏览器查找框，**输入 `<Layer>`** → 回车逐个跳。
3. 每跳到一个 `<Layer>`，往下看 2~3 行就有 `<Name>`、`<Title>`、`<CRS>`、`<Style>`——这就是"一个图层的名片块"。
4. 想读得舒服：`Ctrl+S` 另存为 `capabilities/wms.xml`，VS Code 打开 → 右键 Format Document（或直接装 XML 插件）。
5. 顺手 `Ctrl+F` 搜 `IsDefault` → 命中的 `<Name>` 就是该图层默认样式。

一份 Capabilities 回答四个问题（读的时候就是去找这四样）：

1. **有哪些图层？** 搜 `<Layer>` 下的 `<Name>gis:schools</Name>`——`Name` 就是请求里 `layers=` / `typeNames=` 该填的值（命名前缀 = 工作区缩写）。**看到自己发布的图层名 = 发布成功**；搜不到 = 该图层没勾对应服务，回练习 2 第 1~3 步的 Publishing 页。
2. **它认识哪些坐标系？** `<CRS>EPSG:4326</CRS>` 列表——不在列表里的 `srs=` 请求会报错或被回退；这解释了一多半"图层空白"。
3. **能给我什么格式？** `<Format>image/png</Format>` 等——请求里写列表外的格式就 404/报错。
4. **默认样式是什么？能不能换装？** `<Style><Name>polygon</Name>...`；`STYLES=` 留空 = 用 `IsDefault=true` 那个。

WFS 版：`http://127.0.0.1:8080/geoserver/gis/wfs?service=WFS&request=GetCapabilities`，同样 Ctrl+F 搜 `<FeatureType>`（能取数的表）、`<DefaultSRS>`、`<OtherSRS>`，再搜 `application/json` 确认 `<OutputFormat>` 列表里有它（练习里要用它，没有就去【GeoServer 后台→Settings→Services→WFS】的 List of output formats 勾选启用，见坑 P6）。**注意：GeoServer 新版菜单里 WMS/WFS 服务级设置在 `Settings` 下，不在 `Layers` 下——找不到就搜左侧 "Services"。**

顺带认识一个"懒人入口"：管理界面 Layers 页每个图层右侧的 **Layer Preview** 里 "OpenLayers" 链接背后就是自动拼好的 GetMap；"GWC cached WMTS" 链接则是 W3 学过的预切瓦片——同一份数据三种吃法，一图胜千言。

### 1.4 SLD：用 XML 写样式（1 h）

> **学完你能做什么**：能读懂一份分级设色 SLD 的每一段在干什么；能改颜色代码、改阈值、加描边和标注；能在 GeoServer 后台新增样式并挂到图层上；知道"属性名写错的症状是整层变灰/空白而不是报错"。

SLD = Styled Layer Descriptor，OGC 的"样式说明书"，本质是一段 XML。GeoServer 内置一批（polygon、point、边界红色高亮……），自定义时**在内置样式基础上改最省事**。后台新增样式的精确路径：【GeoServer 后台→数据→Styles→Add new style→Name 填 `gz_districts_choropleth`→Workspace 选 `gis`（留 Empty/无 则全局可用）→把下面整段粘进 Style XML 文本框→先点右上角 `Validate`（预期绿勾 "This is valid SLD document"）→`Save`】。**Validate 红了不 Save**：红色会保存成坏样式，图层引用它之后整个预览变空白，报错只写在 `docker logs geoserver` 里。一份按属性分级设色（数值分 3 档）的完整可用示例——字段 `n_schools`（练习 1 会把它加到 `gz_districts` 上）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- ① 文件头：声明这是 SLD 1.0，OGC 的样式语言版本；缺它 Validate 直接红 -->
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink">

  <!-- ② NamedLayer：给这一"图层样式包"起内部名，必须与 GeoServer 里图层的图层名一致 -->
  <NamedLayer>
    <Name>gz_districts_choropleth</Name>
    <UserStyle>
      <Title>各区学校密度分级</Title>   <!-- 成对标签：写成 </title> 小写 Validate 就红 -->
      <FeatureTypeStyle>       <!-- ③ FeatureTypeStyle：一组规则的容器，同层多套规则才放得下 -->

        <!-- ④ 第 1 档：n_schools < 1000 → 浅黄。Rule = "什么条件(Filter) + 怎么画(Symbolizer)" -->
        <Rule>
          <Name>low</Name>
          <ogc:Filter>                     <!-- Filter 会被翻译成 SQL WHERE -->
            <ogc:PropertyIsLessThan>       <!-- 比较符：LessThan/GreaterThanOrEqualTo/EqualTo… -->
              <ogc:PropertyName>n_schools</ogc:PropertyName>  <!-- ← 数据库列名，写错整层不中 -->
              <ogc:Literal>1000</ogc:Literal>                 <!-- ← 比较值（字面量） -->
            </ogc:PropertyIsLessThan>
          </ogc:Filter>
          <PolygonSymbolizer>              <!-- 面符号器：只管多边形的画 -->
            <Fill><CssParameter name="fill">#F7FBD0</CssParameter></Fill>  <!-- 填充色=6位HEX -->
          </PolygonSymbolizer>
        </Rule>

        <!-- ⑤ 第 2 档：1000~1999 → 中间色（区间 = ≥下界 AND <上界，And 包两个比较） -->
        <Rule>
          <Name>mid</Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsGreaterThanOrEqualTo>
                <ogc:PropertyName>n_schools</ogc:PropertyName>
                <ogc:Literal>1000</ogc:Literal>
              </ogc:PropertyIsGreaterThanOrEqualTo>
              <ogc:PropertyIsLessThan>
                <ogc:PropertyName>n_schools</ogc:PropertyName>
                <ogc:Literal>2000</ogc:Literal>
              </ogc:PropertyIsLessThan>
            </ogc:And>
          </ogc:Filter>
          <PolygonSymbolizer>
            <Fill><CssParameter name="fill">#A1D76E</CssParameter></Fill>
          </PolygonSymbolizer>
        </Rule>

        <!-- ⑥ 第 3 档：≥2000 → 深绿。最后一条规则不写 Filter，
             充当"其余全部"兜底，GeoServer 按从上到下顺序取第一条命中的规则 -->
        <Rule>
          <Name>high</Name>
          <PolygonSymbolizer>
            <Fill><CssParameter name="fill">#41AB45</CssParameter></Fill>
          </PolygonSymbolizer>
        </Rule>

      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
```

读法要点（也是自己改的要点）：

- `PropertyName` = 字段名、`Literal` = 比较值——**字段拼错不报错，直接全不中**，图层回退空白或默认样式（坑 P5）。**症状要背下来**：整层变灰 / 全部落在兜底那一档 / 预览一张纯色图，而 GeoServer 界面和日志都"一切正常"——这时先 `[psql] SELECT * FROM gz_districts LIMIT 1;` 抄列名，再对照 GetFeature 返回的 JSON 属性名（1.6 的验证三步之二）。
- 分级设色本质就是**多条 Rule + Filter 区间**；GeoServer 界面 "Editing → Classification" 自动生成的 SLD 也是这个骨架，区别只是它帮你写了一堆 Rule。手写一遍，界面上的按钮就祛魅了。
- `fill` 是面填充色，加描边就在同一个 `PolygonSymbolizer` 里补 `<Stroke><CssParameter name="stroke">#333</CssParameter><CssParameter name="stroke-width">0.5</CssParameter></Stroke>`。
- **颜色代码怎么写**：一律 6 位十六进制 `#RRGGBB`（`#F7FBD0` 浅、`#41AB45` 深，同一色相从浅到深排就是"分级设色"的视觉顺序）；要半透明不写 `#33333380`（SLD 不认 8 位），而是补 `<CssParameter name="fill-opacity">0.5</CssParameter>`。线层用 `LineSymbolizer`＋`stroke`，点层用 `PointSymbolizer`＋`ExternalGraphic`（图片）或 `Fill`（实心圆）。
- 数字字段前提：`n_schools` 在 GeoServer 眼里**类型跟数据库列一致**——所以练习 1 建的是 `integer` 列；拿字符串列比大小会按字典序出笑话（"9" > "10"）。
- **常见误区**：① 以为样式改了立刻在所有预览生效——有内存/瓦片缓存，要 `Reload from disk`（练习 4 第 2 步）；② 把 `NamedLayer/Name` 写成样式名而不是图层名，Validate 可能过但不生效；③ 以为"一个图层只能一个样式"——默认样式 + Committed styles 列表可以同时挂多个。

### 1.5 CORS 的三种开法 + vite 代理（0.5 h）

> **学完你能做什么**：三种解法都能独立操作到位（后台开关 / web.xml / vite 代理 / nginx 反代），并且能判断眼前这个报错该用哪一种；能看懂 Console 里那行红字在说什么。

W3 结论：CORS 报错**找服务端**；解法要么服务端开、要么同源代理。在 GeoServer 上三选一，**本周要求 A、C 都会**：

- **方式 A（管理界面，最常用）完整步骤**：【GeoServer 后台→Security→CORS】（左侧栏 "Security" 组 → `CORS Access-Control-Allow-Origin`；若看不到该菜单，先【后台→Admin→Security→Users/Groups→Administrators】确认自己是 admin）→ 勾选 `Enable CORS access` → `Allowed origins` 填 `*`（学习用；生产改成你的域名白名单，一行一个）→ 其余条目保持默认 → 点右上角 `Save`（**不点 Save 刷新就回原样**，界面右上角只有 Save / Revert / Cancel 三个按钮）。验证：【psql】之外的任何前端页面直连 `http://127.0.0.1:8080` 的 WFS fetch 不再红。
- **方式 B（配置文件，等价"手工版 A"）完整步骤**：

  ```powershell
  # 【PowerShell】进容器
  docker exec -it geoserver bash
  # 容器内：编辑（镜像里通常只有 vi；文件路径以容器实际为准）
  vi /opt/geoserver/webapps/geoserver/WEB-INF/web.xml
  ```

  找到被注释包起来的 `CrossOriginFilter` 段（搜 `filter-class` 输入 `org.eclipse.jetty.servlets.CrossOriginFilter`），把 `<!--` 与 `-->` **两对标签一起解开**（`<filter>` 与 `<filter-mapping>` 都要，只解一半等于没解）→ 保存退出 → 宿主机 `docker restart geoserver` → 日志出现 `Started ... Jetty` 再测。
  **预期输出**：重启后 `curl -i http://127.0.0.1:8080/geoserver/gis/wfs?request=GetCapabilities -H "Origin: http://127.0.0.1:5173"` 的响应头里有 `Access-Control-Allow-Origin`。**失败时**：容器重启起不来 = XML 改坏了（`docker logs geoserver` 里找 `SAXParseException` 行号）；**注意 web.xml 在镜像里、不在挂载卷里，`docker rm` 后改动丢失**（坑 P2）——要持久就学方式 A，或把改好的 web.xml 也 `-v` 覆盖挂载。
- **方式 C（同源代理，不碰服务端）完整步骤**：你仓库里早就配好了——[vite.config.js](../projects/webgis-starter/vite.config.js) 的 `server.proxy`：

  ```js
  export default defineConfig({
    server: {
      port: 5173, host: '127.0.0.1',
      proxy: {
        '/geoserver': {                      // 前端只要请求 /geoserver 开头就打到这里
          target: 'http://localhost:8080',   // GeoServer 容器映射到宿主机 8080（端口冲突时改成 8081）
          changeOrigin: true,                // 转发时把 Host 头改成 target 的，避免虚拟主机规则拒掉
        },
      },
    },
  });
  ```

  前端请求 `/geoserver/gis/wfs`（同源，浏览器不管），dev server 在 Node 层转发给 GeoServer（**服务器之间没有 CORS 这回事**）。生产环境对应 nginx 反代：

  ```nginx
  # 【nginx.conf】server 块里 —— 与 vite proxy 同思路：让浏览器只跟本站说话
  location /geoserver/ {
      proxy_pass http://127.0.0.1:8080/geoserver/;   # 结尾带 / 才会把 /geoserver 前缀原样接上
      proxy_set_header Host              $host;
      proxy_set_header X-Real-IP         $remote_addr;
  }
  ```

  改完 `nginx -t && nginx -s reload`。**注意：vite 的 proxy 配置改动必须重启 dev server 才生效**（坑 P4）。

三种方式各管一段：A 解决"别人直连你的 GeoServer"；C 解决"我本地开发 / 生产同域部署"；B 是 A 出问题时手动介入。别混用成一团浆糊：练习 3 里先故意**不开 A 且不用 C**（URL 直连 `http://127.0.0.1:8080`），看一次红字长什么样，再切回代理 `/geoserver/...` 看它消失——"跨域问题自己解决、能讲清过程"（验收项 3）的素材就这么来。

### 1.6 前端两种接法骨架（1 h，抄进 `geoserver-lab` 的 ol-bridge.js 备用）

> **学完你能做什么**：把两段骨架改成自己图层名跑起来；每种接法都会用"Network 看状态码 → 改一行数据刷新 → 故意写错参数看报错"三步验证真的走通，而不是"图出来了就当成功"。

**接法一：TileWMS——只要图**（对照 starter 里 [basemaps.js](../projects/webgis-starter/src/basemaps.js) 的 XYZ 写法，换的只是 source）：

```js
import TileLayer from 'ol/layer/Tile.js';
import TileWMS from 'ol/source/TileWMS.js';

export function makeDistrictWmsLayer() {
  return new TileLayer({
    source: new TileWMS({
      url: '/geoserver/gis/wms',          // 走 vite 代理（1.5 方式 C）；直连则写 http://127.0.0.1:8080/...
      params: {
        LAYERS: 'gis:gz_districts',
        FORMAT: 'image/png',
        TRANSPARENT: true,                // 关键！否则 WMS 图带白底盖住你的底图（坑 P7）
        STYLES: '',                       // 空 = 图层默认样式；'gz_districts_choropleth' = 换装
      },
      serverType: 'geoserver',            // 告诉 OL 按 GeoServer 的瓦片对齐习惯拼 bbox
    }),
  });
}
```

**TileWMS 的"验证走通"三步**（【浏览器 DevTools→Network】，先勾 `Disable cache`）：

1. **看请求**：Network 里筛 `wms`（过滤框输入 `wms` 或 `.png`）→ 拖动地图应刷出一串 `GET /geoserver/gis/wms?...BBOX=...`，**状态码 200**、`Type=image/png`；点其中一条看 Response 标签页是二进制 PNG 预览。
   失败时：`404` → 代理没生效或 target 端口错（坑 P4/P3）；`400` + XML → 点 Response 看哪句 `Exception`，通常是 `LAYERS` 名或 `FORMAT` 不在 Capabilities 列表（1.3）。
2. **改一行数据**：【psql】`UPDATE gz_districts SET name='天河区X' WHERE name='天河区';` → 回页面平移出视野再回来（触发新瓦片请求）→ 图上该区的 GetFeatureInfo/注记（练习 4 挑战加了 TextSymbolizer 时最直接）变化；改完记得改回来。**没变** = 你接的是缓存或别的图层（按链路倒查：浏览器缓存 → 代理目标 → 图层数据源）。
3. **故意写错参数**：把 `LAYERS` 改成 `gis:zzz` 刷新 → Network 里该请求**仍是 200 但图是空白**，或 GeoServer 返回 `Layer not defined`（`FORMAT` 写错必返 XML 异常）。**这一步的意义：确认参数真的在服务端生效**，而不是前端自己画的。

**接法二：WFS——要数据 + 属性过滤**（`ol/format/WFS.js` 的 `writeGetFeature` 生成请求 XML，过滤条件用 `ol/format/filter.js` 的 `equalTo` 等组合；这就是计划里"ol/format/Filter 做属性过滤"）：

```js
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import WFS from 'ol/format/WFS.js';
import {bbox as bboxStrategy} from 'ol/loadingstrategy.js';
import {equalTo, within, and} from 'ol/format/filter.js';
import {fromLonLat} from 'ol/proj.js';

const districtGeom = /* ...练习 3 里从 WMS 那层的 bbox 或简单写死一个 Polygon... */ null;

export function makeSchoolsWfsLayer(districtName) {
  const source = new VectorSource({
    format: new GeoJSON(),                // WFS 响应声明 outputFormat=json 时，GeoJSON 格式直接读
    strategy: bboxStrategy,               // 按视野加载：拖动只请求新露出范围（W3 的"分级加载"落到数据层）
    url: async (extent) => {
      const featureRequest = new WFS().writeGetFeature({
        srsName: 'EPSG:3857',             // 要 3857 的几何，和视图投影对齐，省一次前端换算
        featureNS: 'http://gislab',       // ⚠️ 必须 = 工作区的 URI（不是缩写！坑 P8）
        featurePrefix: 'gis',
        featureTypes: ['schools'],
        outputFormat: 'application/json',
        bbox: {extent, crs: 'EPSG:3857'},
        filter: and(                       // ← 属性过滤在这里：GeoServer 翻译成 SQL WHERE
          equalTo('district', districtName),
        ),
      });
      const res = await fetch('/geoserver/wfs', {
        method: 'POST',
        headers: {'Content-Type': 'text/xml'},
        body: new XMLSerializer().serializeToString(featureRequest),
      });
      if (!res.ok) throw new Error(`WFS ${res.status}: ${await res.text()}`);
      return res;                          // OL 拿到 Response 后自会读 features
    },
  });
  return new VectorLayer({source});
}
```

**WFS 的"验证走通"三步**：

1. **看请求**：Network 筛 `wfs` → 应看到 **POST** 一条（不是 GET）；Headers 里 `Content-Type: text/xml`，Payload 标签是 `<wfs:GetFeature ...><ogc:PropertyIsEqualTo><ogc:PropertyName>district` ——**能肉眼看到自己写的过滤条件被发出去**；Response 是 `{"type":"FeatureCollection","features":[...]}`，状态 200。
   失败时：`403/无 Access-Control-Allow-Origin` → 你写了直连 URL 又没开 1.5 方式 A；`Exception: No such feature type` → `featureNS` 填成缩写了（坑 P8）；`400` + `outputFormat` 字样 → WFS 输出格式没启用 JSON（1.3 末）。
2. **改一行数据**：【psql】`UPDATE schools SET district='越秀区' WHERE id=1;` → 页面 F5 或把视野移出再移回 → 点 id=1 那个点看弹窗 / 它出现在越秀区过滤结果里。这一步过了，"前端 ↔ GeoServer ↔ PostGIS"整条链才算闭环（验收项 1）。
3. **故意写错参数**：把 `equalTo('district', ...)` 的字段名改成 `distRICT` → **响应变成 200 + XML 异常** `Property distRCT does not exist`（GeoServer 大小写敏感）；或把 `featureTypes: ['schools']` 改成不存在的表 → 看异常文本。**看到报错 = 参数生效**；若改成错字段仍然返回全部数据，说明你的 filter 根本没被序列化进去（检查 `writeGetFeature` 是不是把 `filter` 拼进请求 XML 了）。

- 骨架不用一次写对，练习 3 的目标就是把它跑通并**改掉两处**（换图层名、加一个 `within` 过滤）。
- 偷懒 GET 版（记一笔，调试期快）：`/geoserver/gis/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=gis:schools&outputFormat=application/json&CQL_FILTER=district='天河区'`——CQL 是"URL 里写的 WHERE"，正式功能再切 XML filter。
- `srsName=EPSG:3857` 与视图一致；若声明了 4326 又忘给 `dataProjection/featureProjection`，就会"数据在索马里"——W4 的老朋友，坑 P9。

### 1.7 docker run GeoServer：逐参数 + 数据目录持久化（0.5 h）

> **学完你能做什么**：独立把 GeoServer 容器起起来、验证它活着、并且证明配置被挂载卷保住了（删容器重建不丢）。

【PowerShell】完整命令（主计划那条展开版）：

```powershell
docker run -d --name geoserver `
  -p 8080:8080 `
  -e GEOSERVER_ADMIN_USER=admin `
  -e GEOSERVER_ADMIN_PASSWORD=geoserver `
  -v D:/xx/GitProjects/gis-learning/projects/geoserver-lab/geoserver_data:/opt/geoserver_data `
  docker.osgeo.org/geoserver:2.25.x
```

| 片段 | 干什么 |
| --- | --- |
| `-d` | 后台运行（detached）；不加会占住终端 |
| `--name geoserver` | 容器起名，之后 `docker logs geoserver`、`docker restart geoserver` 都用它 |
| `-p 8080:8080` | 端口映射：**宿主机 8080 → 容器 8080**。浏览器和 vite 代理都打到宿主机这一侧；被占用就换 `-p 8081:8080`，vite target 跟着改（坑 P3） |
| `-e GEOSERVER_ADMIN_USER/PASSWORD` | 首次启动初始化 admin 账号（官方镜像支持这两个变量；不传则默认 `admin/geoserver`，主计划用的默认值——**学习环境够用，公网部署务必改**，坑 P10） |
| `-v D:/.../geoserver_data:/opt/geoserver_data` | **数据目录挂载**：工作区、图层、样式、内置库全在这个目录——不挂载的话 `docker rm geoserver` 一次，全部发布配置归零（W7 说"数据不会丢"是因为卷里存着库；GeoServer 的"配置"同理要靠这个卷保命，见坑 P2）。宿主机路径用正斜杠，PowerShell 里 `D:/xx/...` 合法 |
| `docker.osgeo.org/geoserver:2.25.x` | 镜像与滚动标签（2.25 系列小版本自动跟随）。国内拉取超时见坑 P1——和 W0 坑 #5 同一件事：先确认镜像加速器配好 |

**启动 → 验证四步**（每步都有"预期/失败"）：

1. 【PowerShell】`docker run ...`（上条命令）→ **预期输出**：回一长串容器 ID 且无红字。**失败时**：`port is already allocated` → 坑 P3；`name in use` → 已建过同名容器，用 `docker start geoserver`，别再 run。
2. 【PowerShell】`docker logs geoserver --tail 20` → **预期**：看到 `Started ... Jetty` 或 `INFO: org.eclipse.jetty... Server - Started`（首启要初始化数据目录，慢，1~2 分钟）。**失败**：`dialing registry ... 超时` 说明镜像还没拉下来 → 坑 P1；`java.lang.RuntimeException` 里出现 `/opt/geoserver_data` → 挂载路径不存在，先在宿主机 `mkdir` 那个目录再 run。
3. 【浏览器地址栏】<http://127.0.0.1:8080/geoserver> → **预期**：欢迎页，右上角有 `Login`。用 `admin/geoserver` 登录 → 右上角变成 `admin`，旁边出现 `Admin`（齿轮）入口。**失败**：页面一直转圈 = 容器还没起完，回第 2 步看日志。
4. 【PowerShell】持久化自证：`docker rm -f geoserver` → 重跑同一条 run 命令 → 登录后 `Layers` 列表**还在**（配置在挂载卷里）。不在了 → 你的 `-v` 写错了，坑 P2 现形——这一步就是验收项 6。

---

## 2. 练（本周主体，产出物进 `projects/geoserver-lab/`）

> 每个练习都是「前置检查 → 编号步骤（操作 + 预期现象 + 失败分支）→ 完成自查」三段。预期现象对不上就是踩坑了，回第 4 节按 P 编号查。所有 GeoServer 操作都在【GeoServer 后台】，路径写成 `菜单→子菜单→按钮`。

### 练习 1：起服务 + 连上 W7 的 PostGIS（周一，主计划练 1）

**为什么做**：翻译官先站到岗，并给它接上唯一的数据源。**这一步的关卡就是 `host.docker.internal`**——W7 坑 P3 预告的正是它。

**前置检查**：

- [ ] `docker ps` 里 `pgis` 状态 Up（Exited → `docker start pgis`）
- [ ] 【psql】`\dt` 能看到 `schools / gz_districts / subway_lines / landuse` 四张表
- [ ] 【PowerShell】`netstat -ano | findstr :8080` 没有别的程序占着（占了就换 8081，并记住要同步改 vite target——坑 P3）
- [ ] 已创建空目录 `projects/geoserver-lab/geoserver_data/`（挂载点必须存在，坑 P2）

**步骤**：

1. 按 1.7 起容器并登录（`docker run` 四步验证全过）。
2. 给 `gz_districts` 加数字列供分级用（【PowerShell】起 `docker exec -it pgis psql -U postgres -d gislab` 进【psql】后贴）：
   ```sql
   ALTER TABLE gz_districts ADD COLUMN n_schools integer DEFAULT 0;
   UPDATE gz_districts d SET n_schools = sub.n
   FROM (SELECT g.name, count(s.id) AS n
         FROM gz_districts g LEFT JOIN schools s ON ST_Contains(g.geom, s.geom)
         GROUP BY g.name) sub
   WHERE d.name = sub.name;
   SELECT name, n_schools FROM gz_districts ORDER BY n_schools DESC;
   ```
   **预期现象**：前两条各回 `ALTER TABLE` / `UPDATE 11`；最后一条每区一个 ≥0 的整数（W7 练习 3 查询 1 同款逻辑，只是这次**写回表里**——文件思维与库思维的分水岭）。**失败分支**：`column "n_schools" already exists` → 已加过，跳过第 1 行；`relation "schools" does not exist` → 练习 1 的前提没满足，先补 W7 练习 2（坑表里没有这条，属于前置检查漏了）。
3. 【GeoServer 后台→数据（Data）→Stores→`Add new Store`→ 点 `PostGIS`(Feature data 组下那个图标)】逐个字段填（这个表单从上到下依次是 Name / Description / Connection Parameters 一堆 + 底部 `Save`）：

   | 字段（界面标签） | 填什么 | 为什么 / 填错的后果 |
   | --- | --- | --- |
   | Data source name | `pgis_gislab` | 起个能认的名字；重名会报 "name already in use" |
   | Description | 留空或写"本机 pgis 容器" | 不参与功能 |
   | **dbhost** | `host.docker.internal` | **GeoServer 在容器里，它的 localhost 是它自己**；数据库端口映射在宿主机上，容器找宿主机 = `host.docker.internal` |
   | dbport | `5432` | 宿主机侧映射端口（若 `pgis` 映射成 5433 就填 5433） |
   | database / user / passwd | `gislab` / `postgres` / `postgres` | W7 建的库；密码错 → `password authentication failed` |
   | schema | `public` | 默认；改成别的会只列出别的 schema 的表 |
   | 其余（Expose PK / Estimate metadata…） | 保持默认 | `Estimate metadata enabled = true` 让 bbox/count 更快，学习环境不用动 |

   填完点**右下角 `Save`**（这个页面右上角是 `Back to list`，没有 Save——Save 在表单底部，新手最常在这儿找不到按钮）。
   **预期现象**：提示 "The store was created successfully"，回到 Stores 列表，`pgis_gislab` 行左侧展开能列出 W7 的四张表。**失败分支**：`Connection refused` → 九成填了 `localhost`（→ 改 `host.docker.internal`，坑 P3 的兄弟）；`password authentication failed` → 核对密码；host 已对仍报 `The connection could not be made` → `pgis` 容器没跑（前置检查第 1 项）或 Windows 防火墙拦了宿主机 5432 的容器访问。
4. 【GeoServer 后台→数据→Workspaces→`Add new workspace`】建工作区：**Name** 填 `gis`，**Namespace URI** 填 `http://gislab`（这个 URI 就是后面 WFS 里 `featureNS` 要抄的值，坑 P8），勾上 `is default workspace`（本手册后续以 gis 为默认），右上角 `Save`。
   **预期现象**：列表出现 `gis | http://gislab`。**失败分支**：URI 手滑写成 `gis` → 后面 WFS POST 报 `No such feature type`，回坑 P8 对照。
5. 顺手记笔记：【浏览器地址栏】`http://127.0.0.1:8080/geoserver/gis/wms?service=WMS&request=GetCapabilities` 现在还没有你的图层（返回里 `<Layer` 数为 0）——正常，练习 2 才有。这一步同时验证工作区建好且 URL 里 `/gis/` 这一路能通。

**完成自查**：

- [ ] Stores 里 `pgis_gislab` 能展开出四张表
- [ ] Workspaces 里 `gis` + `http://gislab` 存在且是默认
- [ ] `docker logs geoserver --tail 20` 无红字异常；`SELECT name, n_schools FROM gz_districts;` 有数
- [ ] `sql/add_n_schools.sql` 与 `run-geoserver.ps1`（注释版）已存进 `projects/geoserver-lab/`

### 练习 2：发布 2 个 WMS + 1 个 WFS，QGIS 先验货（周二~周三，主计划练 2）

**为什么做**：走完"存储→图层→样式"剩余两级；用 QGIS 当"第三方客户"提前验货——前端接完再查错，锅不好分。

**前置检查**：

- [ ] 练习 1 完成（Stores 里表能展开、工作区 gis 已建）
- [ ] 【PowerShell】`docker ps` 里 `geoserver` 与 `pgis` 同时 Up
- [ ] QGIS 已装（未装则本练习第 5 步改用浏览器 Layer Preview 顶上，别跳过验货）

**步骤**：

1. 发布 `gz_districts`（政区，WMS）：【GeoServer 后台→数据→Layers→`Add new Layer`→ 在 "Add a new layer" 列表的 `pgis_gislab` 存储下找到 `gz_districts`（行右侧是绿色小表图标）→ 点它】进入基本信息页：
   - **基本信息**：Resource 显示 `pgis_gislab:gz_districts`；Name 填 `gz_districts`；Title 留空自动同 Name；**Native CRS 应为 `EPSG:4326`**（读自库内 SRID，别改——改了就是"身份证地址 ≠ 实际住址"，见 1.1 表格）；右侧 `Bounding Data` 区填 **Compute from data**（原生 bbox 那个按钮）再点 **Compute from native-to-declared**（如果有）；页面右下角 `Save and continue`（不是 Save：这页只有 `Save and continue` / `Cancel`）。
     **失败分支**：bbox 一栏是 `0,0,0,0` → 按钮没点到，回点 `Compute from data`（坑 P6，不补后面必空白）；Native CRS 显示 `-1` 或别的 → 库内 SRID 有问题，【psql】`SELECT Find_SRID('public','gz_districts','geom');` 复核。
   - 再点 `Save and continue` 进 **Publishing** 页：**Services** 勾选 `WMS`（`WFS` 先不勾）；**Rendering Defaults** 的 Style 选内置 `polygon`（默认样式）；右下角 `Save`。
     **预期现象**：回 Layers 列表，`gis:gz_districts` 出现，Service 列显示 WMS。
2. 同法发布 `landuse`（勾 WMS，默认样式 polygon）。**预期现象**：Layers 里两条 WMS。
3. 再发布 `schools`（点）：Publishing 页勾 **WFS**（可同时勾 WMS 备选）；样式选内置 `point`。`Save and continue` → `Save`。
   **失败分支**：Publishing 页里没有 WFS 可勾 → 说明该图层 Resource 不是矢量要素存储（比如建成了图片存储）；回第 1 步确认走的是 PostGIS 存储。
4. 工作区检查：【后台→Layers→点 `gis:gz_districts`→Properties】里 "Service" 应显示 WMS 启用；若发布时提示"工作区未关联命名空间"，去【后台→Workspaces→gis→`is default workspace`】勾上保存（GeoServer 不拦你，但 QGIS 里图层列表会乱——写进笔记）。
5. QGIS 验货（【QGIS】）：
   - 浏览器面板 / `Layer→Data Source Manager→WMS/OGC Services→Add`，URL 填 `http://127.0.0.1:8080/geoserver/gis/wms` → `Add` → 在弹出的 "QGIS Server Connections" 列表里应看到 `gz_districts`、`landuse` → 选中 `Add` → 图层出现，缩放平移正常出图。
   - `Data Source Manager→WFS Features→` 同 URL（GeoServer 的 WFS 端点与 WMS 同路径 `/geoserver/gis/wfs`）→ 列表应出现 `schools` → `Add` 后开属性表能看到 `id / district / n_schools` 字段。
   **预期现象**：两层 WMS 出图 + WFS 属性表有字段。**失败分支**：WMS 列表里啥也没有 → 图层没勾 WMS（回第 1 步 Publishing）；能加但不出图 → bbox 没算或 CRS 混了（坑 P6）；WFS 报 `Non-existent type` → 名字缺 `gis:` 前缀。
6. **Layer Preview 两种预览各自该看到什么**（【后台→Layers→`gis:gz_districts` 行右侧 `Layer Preview`】→ 列表里两行）：
   - `OpenLayers`（WMS 版）→ 新标签页自动拼好 GetMap：预期看到**一张带边界的黄色面政区图**（内置 `polygon` 样式），左侧有坐标条、可缩放平移；若整片灰白 → 坑 P6 三连查。
   - `GWC cached WMTS` → 同样出图但地址栏是 `.../gwc/service/wmts?...TILEMATRIX=...`：预期能明显看出**一格一格瓦片加载**（W3 概念在此现形）；若报 "Gridset" 相关错 → GWC 还没为这个图层缓存，正常，W9 再治。
   两条都截图进 `notes.md`，并把 OpenLayers 预览地址栏里的完整 URL 复制存一份——练习 1.2 的两条 URL 就从这里抄参数。
7. 浏览器回看 1.2 的两条 URL（替换成你的图层名）：GetMap 出 PNG、GetFeature 出 JSON，截图进笔记——"同一图层两种吃法"。

**完成自查**：

- [ ] Layers 列表有 `gis:gz_districts`(WMS) / `gis:landuse`(WMS) / `gis:schools`(WFS)
- [ ] QGIS 三层都能加载并出图/出属性
- [ ] 【浏览器地址栏】GetCapabilities 里 Ctrl+F 能当场指出「图层 `<Name>` / `<CRS>` 列表 / `IsDefault` 样式」三处（验收项 4）
- [ ] 两张 Layer Preview 截图已进 `notes.md`

### 练习 3：前端消费 + 跨域实验 + 改数据闭环（周三~周四，主计划练 3）

**为什么做**：验收项 1、3 都在这里。顺序刻意：先撞跨域，再解决它，最后验"服务真的走通了"。

**前置检查**：

- [ ] 练习 2 完成（三层已发布并 Layer Preview 出图）
- [ ] 【PowerShell】`cd projects/webgis-starter && npm run dev` 能起 <http://127.0.0.1:5173>
- [ ] [vite.config.js](../projects/webgis-starter/vite.config.js) 里 `/geoserver → http://localhost:8080` 代理存在（1.5 方式 C）
- [ ] 【GeoServer 后台→Security→CORS】当前**未勾选** Enable CORS（第 4 步才开——先制造报错现场）

**步骤**：

1. 在 starter 旁新建 `geoserver-lab/` 页面（复制 starter 的 `index.html`/`main.js` 骨架即可；嫌重也可直接改 starter，但代码骨架独立进 `ol-bridge.js`，仓库留痕）。
2. **先故意直连制造跨域**：WFS 的 `fetch` URL 写 `http://127.0.0.1:8080/geoserver/...`，页面跑在 <http://127.0.0.1:5173>。
   **预期现象**：【浏览器 DevTools→Console】红字 `Access to fetch at 'http://127.0.0.1:8080/geoserver/wfs' from origin 'http://127.0.0.1:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header...`；Network 里该请求显示 `(failed) net::ERR_FAILED` 或状态 0/cors。**截图存证**（W3 坑 P1 的续集，这就是你"自己解决跨域"的起点记录）。**失败分支**：居然没报错 → 你之前开过 CORS 开关（第 4 步就没素材了），关掉再测；或 URL 其实写成 `/geoserver/...` 走了代理。
3. **解法一（代理，1.5 方式 C）**：URL 改 `/geoserver/...`，**重启 dev server**（Ctrl+C 再 `npm run dev`——proxy 改了不重启不生效，坑 P4）。
   **预期现象**：红字消失；Network 里请求名变成 `wfs`、状态 200、`Initiator` 是你的 `ol-bridge.js`；地图上出现学校点。
4. **解法二（服务端开 CORS，1.5 方式 A）**：URL 改回直连 `http://127.0.0.1:8080/...` + 【后台→Security→CORS→勾 Enable CORS→Allowed origins `*`→`Save`】。
   **预期现象**：红字同样消失；DevTools→Network 里该响应头出现 `Access-Control-Allow-Origin: *`（点开请求 → Headers → Response headers 找）。**失败分支**：还是红字 → 点了 `Cancel`/没点 `Save`（刷新页面看勾选还在不在）。两种都成功后，在笔记里各写一句"它各自适合什么场合"（验收项 3 的"讲清过程"）。
5. 按 1.6 两个骨架分别接：TileWMS 政区层（底图之上，调透明度 0.7 能看见底图压住关系）+ WFS 学校层（`bboxStrategy` 拖动按需加载）。**改两处骨架**：① 图层名换成你的；② filter 里给 `equalTo` 之外加一个 `within('geom', <某区 polygon>)`。
   **验证走通**：照 1.6 的两组"三步"逐条做——【浏览器 DevTools→Network】看到 GET `.wms` 一串 200 PNG、POST `wfs` 一条 200 FeatureCollection，且故意写错 `LAYERS` 后**结果变了**（证明参数生效）。**失败分支**：底图整片变白 → `TRANSPARENT: true` 没写（坑 P7）；点跑到非洲 → P9；`No such feature type` → P8。
6. **改一条数据的闭环验真**（验收项 1）：【psql】
   ```sql
   UPDATE schools SET district = '越秀区' WHERE id = 1;
   SELECT id, district FROM schools WHERE id = 1;
   ```
   **预期现象**：回前端页面按 F5（或平移出视野再回来触发 bbox 重新请求）：id=1 那个点的过滤归属/弹窗变了 → **链路真的通到 PostGIS**。
   **失败分支**：没变 → 按链路图倒查：浏览器缓存（DevTools 勾 `Disable cache`）→ 代理目标（是否 404，坑 P4）→ 图层数据源（前端连的图层是不是这个存储里的表）。改回原值 `UPDATE schools SET district='天河区' WHERE id=1;`。
7. `serverType: 'geoserver'` + `TILED` 这类细节不必深究，笔记一句：TileWMS 默认每次视野变化都现渲染（WMS 不友好缓存，W3 表格结论），**预切瓦片要 GWC/WMTS——W9 的入口**。

**完成自查**：

- [ ] 有跨域报错截图 + 两种解法各自"红字消失"的截图
- [ ] Network 面板能同时筛出 WMS（png）与 WFS（POST xml payload）请求
- [ ] 改一行库数据 → 前端刷新看得到变化（并把它改回）
- [ ] `geoserver-lab/web/ol-bridge.js` 提交 Git

### 练习 4：手写 SLD 分级设色 + 挂图层（周五，主计划练 4）

**为什么做**：把 1.4 的 XML 变成自己手里能改的东西——"样式与数据分离"的实操。

**前置检查**：

- [ ] `n_schools` 列有数（【psql】`SELECT max(n_schools), min(n_schools) FROM gz_districts;` 记下这组值，第 4 步要用）
- [ ] `gis:gz_districts` 已发布且 Layer Preview 出图（练习 2）

**步骤**：

1. 【GeoServer 后台→数据→Styles→`Add new style`→Name `gz_districts_choropleth`→Workspace 选 `gis`→粘贴 1.4 整段→`Validate`→`Save`】
   **预期现象**：Validate 显示绿勾 "This is valid SLD document"；Save 后 Styles 列表出现它。**失败分支**：Validate 红 → 报错文本会给行号，多半是 `</title>` 大小写（应为 `<Title>`）或漏了闭合标签；**别硬 Save 坏样式**。
2. 【后台→Layers→`gis:gz_districts`→`Editing` 标签页】Style 下拉选 `gz_districts_choropleth`（这是默认样式）；再把 `polygon` 用下方 `+` 加进 **Committed styles** 列表（这样才能用 `STYLES=` 切换对比）→ 右下角 `Save`。然后【后台→Data→Cache Options】或【Admin→Server Status→`Reload from disk`】清一次缓存。
   **预期现象**：Layer Preview 出现黄绿深三色分级。**失败分支**：预览还是一片蓝 → 没重载缓存（坑 P6 后半，"看起来没生效"）；预览变灰/空白 → `n_schools` 列名拼错（坑 P5，症状就是整层变灰不报错）或该图层 bbox 没算。
3. 浏览器验证换装能力：【浏览器地址栏】`.../GetMap?...&STYLES=`（空）→ 默认蓝面；`...&STYLES=gis:gz_districts_choropleth`（注意跨工作区样式要带 `gis:` 前缀）→ 三色分级。前端 TileWMS 的 `params.STYLES` 同改，两张截图并排进笔记——**这就是"样式与数据分离"的实证**。
4. **改一档阈值**：把 `2000` 改成你 `n_schools` 分布里真实存在的分位值（先看第 2 步记下的 max/min，取一个让某区变色）→ 【后台→Styles→该样式→改数字→Validate→Save→`Reload from disk`】→ 预览刷新。**预期现象**：至少一个区的颜色换了。**失败**：没换 → 缓存没清，或新阈值把三档区间重叠了（GeoServer 从上往下取第一条命中）。**改一处、说清为什么生效**——主计划 AI 纪律的本周版本。
5. 挑战（选做）：加 `TextSymbolizer`（`<Label>[name]</Label>` + 半透明白 halo），让区名注记直接出在 WMS 图上——体会"样式在后端"和 W5"标注在前端"两种路线。**预期现象**：图上出现区名 + 白描边；**失败**：注记全无 → `Label` 里字段名拼错（同样是 P5 症状）或 `<Rule>` 里没有 PolygonSymbolizer 之外的顺序问题（TextSymbolizer 放最后才压在上层）。

**完成自查**：

- [ ] `STYLES=` 空与带样式名的两张对比截图
- [ ] 阈值改过一处并能说出"为什么生效"（缓存 + 规则顺序）
- [ ] `styles/gz_districts_choropleth.sld`（含逐段注释）已提交

---

## 3. 验收标准（全过才算 W8 通关）

- [ ] 后端改一条数据（练习 3.6 的 UPDATE），前端刷新后能看到变化；能说出"为什么本来就该看到"（服务请求时现查库，无中间副本）
- [ ] 能说出 WMS 出图与 WFS 传数据的取舍场景：各 1 个你项目里的真实例子（背景政区 WMS / 要点属性 WFS），外加"为什么 WMS 做不了点击弹窗"
- [ ] 跨域问题是你自己解决的，能讲清过程：有截图的报错现场 + 两种解法（GeoServer 开关 / vite 代理）各自的适用场合
- [ ] 2 WMS + 1 WFS 在 QGIS 与浏览器/前端都验证过；GetCapabilities 里能当场指出"图层名、支持的 CRS、默认样式"三样东西在哪
- [ ] 自定义 SLD 分级设色生效，阈值改过一处并能解释；四级层级图能不看笔记默画
- [ ] GeoServer 容器 `docker rm` 后用同一条命令重建，配置还在（证明 `-v` 挂载起效）——做不到就回查坑 P2
- [ ] 能说清 Native CRS / Declared CRS / Native bbox 各自是什么（"身份证地址 vs 实际住址"类比能讲出口），并知道 bbox 没算的症状为什么是"空白而非报错"
- [ ] 产出物已提交 Git：`projects/geoserver-lab/`

---

## 4. 坑预告（按你的环境定制，遇到就回来打勾）

| # | 预判的坑 | 症状 | 解法 |
| --- | --- | --- | --- |
| P1 | `docker.osgeo.org/geoserver` 拉取超时 | `dialing registry ... 超时`（W0 坑 #5 同款：DNS 污染） | 确认 Docker Desktop 镜像加速器（`docker info | grep -A3 -i "registry mirrors"`）→ `Apply & restart` 后重试；`docker.osgeo.org` 不在加速器覆盖时，改从 Docker Hub 拉官方镜像或用能通的网络时段重试 |
| P2 | GeoServer 数据目录没挂载 | 删了重建容器，工作区/图层/样式全没了；或改 web.xml 重启后配置被"打回原形" | 起容器时 `-v D:/.../geoserver_data:/opt/geoserver_data`；已犯的用 `docker cp` 抢救。记住：**挂载卷 = GeoServer 的配置保险箱**，而 web.xml 在镜像里不在卷里，改它必丢 |
| P3 | 8080 端口被占 | `docker run: port is already allocated`；或 `docker logs` 起了但浏览器打不开 | 宿主机占用常见（IIS/Tomcat/别的服务）：`netstat -ano | findstr :8080` 找 PID；学习期换 `-p 8081:8080` 并把 [vite.config.js](../projects/webgis-starter/vite.config.js) 的 target 改 `http://localhost:8081` |
| P4 | 改了 vite 代理不生效 | 前端请求 `/geoserver/...` 一直 404，明明 GeoServer 正常 | **proxy 配置改动必须重启 dev server**（Ctrl+C 再 `npm run dev`）；顺带确认 target 端口与实际映射一致（P3） |
| P5 | 字段名拼错静默失败 | SLD 分级颜色不生效、图层空白，但 GeoServer 日志不报错 | Filter 里 `PropertyName` 必须与库列名**完全一致**（大小写、下划线）。先用 GetFeature JSON 看返回属性名，照抄进 SLD |
| P6 | 图层发布成功但预览空白 | Layer Preview 一张灰图；QGIS 里能加但不出图 | 三连查：① Bounding Boxes 没算（图层属性里 Compute from data）；② 声明 CRS 与库内 SRID 不一致（4326/3857 混了）；③ WFS JSON 不在 OutputFormats 列表（Settings → Services → WFS 勾选启用）。GetCapabilities 是你的证人（1.3） |
| P7 | TileWMS 不带 TRANSPARENT | WMS 图层一开，底图整片变白 | `params: {TRANSPARENT: true}`——GeoServer 默认渲染白背景盖住一切；这是 WMS 组合底图最高频坑 |
| P8 | featureNS 填了工作区缩写 | WFS POST 报 `No such feature type` 或 XML 异常 | `featureNS` = 工作区的 **URI**（练习里 `http://gislab`），`featurePrefix` 才是缩写 `gis`；两个参数各管一半，分不清去 Workspaces 页对照抄 |
| P9 | WFS 几何坐标系与视图不匹配 | 点位跑到几内亚湾 / 缩放到非洲才发现数据 | 请求 `srsName=EPSG:3857` 与视图对齐；若坚持 4326，则读要素时给 `dataProjection`/`featureProjection`（W4 老朋友）。判据：看返回坐标的数值量级，度≈100 级、米≈1e7 级 |
| P10 | 公网裸奔默认密码 | 学习机顺手把 GeoServer 挂公网演示 | `admin/geoserver` 是公开知识，公网必须改密 + 关演示资源 + CORS 白名单收窄；内网/localhost 学习用可保留 |
| P11 | GeoServer 里 `localhost` 当作数据库地址 | 建存储报 `Connection refused`，但宿主机 `psql`/pgAdmin 连得上 | 容器内的 `localhost` = 容器自己。连宿主机服务一律 `host.docker.internal`（Docker Desktop on Windows 自带该 DNS 名）；Linux 上需加 `--add-host=host.docker.internal:host-gateway` |

---

## 5. 本周产出物结构（提交到 Git）

```
projects/geoserver-lab/
├─ README.md                  # 结论汇总：翻译官模型、四级层级图（默写版）、WMS/WFS 选型一例
├─ notes.md                   # 实验记录：跨域报错截图、两种方式对比、改数据闭环前后截图
├─ run-geoserver.ps1          # 1.7 的 docker run 命令（注释版）
├─ geoserver_data/            # 数据目录（挂载卷；体积大只 .gitignore 掉 gwc 缓存子目录）
├─ styles/
│  └─ gz_districts_choropleth.sld   # 练习 4 的分级设色（含逐段注释）
├─ sql/
│  └─ add_n_schools.sql       # 练习 1.2 加列回填（W8 与 W7 的接口）
├─ web/
│  ├─ index.html / main.js    # 练习 3 的接服务页面（最小版，可复用 starter）
│  └─ ol-bridge.js            # 1.6 两个骨架（TileWMS + WFS filter）跑通版
└─ capabilities/              # 1.3 GetCapabilities 存档（wms.xml / wfs.xml 摘录，标注三处关键位置）
```

---

## 6. W8 结束后的下一步预告（W9：矢量瓦片与性能）

W8 你已经体验了 WMS"每次现渲染"的代价（样式在后端、缓存不友好）和 WFS"数据全给前端"的代价（量大就卡、跨域要管）。W9 的矢量瓦片正是两头的好处：**预切瓦片像 WMTS 一样可缓存，装的却是数据**——百万级点拖动不卡的秘密就藏在 tippecanoe 的金字塔切分里。本周 `schools` 表 3.3 万点已经让你 WFS 接得很顺，W9 把它放大到 100 万，你才知道优化是必须的而不是"听说"的。

> 纪律不变：卡住 2 小时 → 记坑表 → 跳过。本周过程记录写进 `notes/week08.md`（格式延续 [week01.md](../notes/week01.md) 第二节），通关后回来更新 README 进度表。
