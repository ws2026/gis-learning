# W2 空间数据格式与转换

> 日期：2026-10-12 ｜ 状态：✅ W2 通关
> 相关：[12 周学习计划](../docs/WebGIS-12周学习计划.md) ｜ 前置：[W1 坐标系与投影](./week01.md)
> 产出：[hometown_4326.geojson](../data/clean/hometown_4326.geojson) ｜ [gx_fixed.geojson](../data/clean/gx_fixed.geojson)

## 一、完成清单

- [x] 从阿里云 DataV.GeoAtlas 下载家乡 GeoJSON，放入 `data/raw/`
- [x] 解决 GDAL 环境问题（UCRT64 报错，改用 OSGeo4W Shell）
- [x] 用 `ogr2ogr` 将数据统一成 EPSG:4326，输出到 `data/clean/`
- [x] 确认文件大小（原 49 KB，远小于 100 KB，跳过 `-simplify`）
- [x] 用 `ogrinfo -so -al` 验证坐标系和要素数（EPSG:4326, Feature Count: 1）
- [x] 在 QGIS 中检查有效性，并尝试修复几何（生成 `gx_fixed.geojson`）
- [x] 解决 GeoJSON 导出时 `字段 parent 的类型不受支持` 报错
- [x] 成功将 GeoJSON 接入 `webgis-starter`，前端正常渲染家乡轮廓
- [x] 修复 Git 拼写错误（`git comit` → `git commit`），成功推送至 GitHub

## 二、踩过的坑（延续 W1 的 N 编号）

| # | 现象 | 根因 | 解法 |
| --- | --- | --- | --- |
| N12 | UCRT64 终端里 `pacman` 和 `ogrinfo` 均报 `command not found` | 当前终端并非真正的 MSYS2 完整环境 | 放弃折腾该终端，改用 QGIS 自带的 **OSGeo4W Shell** |
| N13 | `'og' 不是内部或外部命令` | 命令行拼写不完整，GDAL 不支持该缩写 | 必须输入全拼 `ogrinfo` 或 `ogr2ogr` |
| N14 | QGIS 工具箱搜“修复”找不到工具 | 搜到了“修复形状文件”（用于修 shp），非目标工具 | 搜“几何”或“Fix geometries”，且输入图层必须是原始图层 |
| N15 | QGIS 导出 GeoJSON 报错 `字段 parent 的类型不受支持` | DataV 数据的 `parent` 字段是嵌套 JSON，GeoJSON 标准不支持 | 导出时取消勾选 `parent` 字段，仅保留 `name` 和 `adcode` |
| N16 | `git comit` 提示 `is not a git command` | 拼写错误，少打了一个 `m` | 重新输入 `git commit -m "..."`，再执行 `git push` |

## 三、方法论收获

- **工具链的互补**：QGIS 擅长可视化检查和修复，命令行 GDAL 擅长批量转换。不要在一个工具上死磕，换条路也许 5 分钟就解决了。
- **不要过度追求完美**：对于只有 1 个要素的 GeoJSON，微小的拓扑错误在 QGIS 里报“输出无效”，但在浏览器（OpenLayers）里 99% 的情况下都能正常渲染。以“数据能上网页”为核心目标，不要被拓扑警告绊住脚步。
- **属性清洗和几何清洗同等重要**：GeoJSON 规范非常严格，属性表里不能有嵌套的对象（如 JSON 对象）。导出前务必清理掉不需要的字段。
- **命令行的容错性**：Git、GDAL 这类 CLI 工具，拼写错误往往报错晦涩。遇到报错先检查命令拼写，其次才是逻辑。

## 四、数据转换实测记录（W2 素材）

### 关键命令记录（在 OSGeo4W Shell 中执行）

```bash
# 1. 统一坐标系并转换格式
ogr2ogr -f GeoJSON -t_srs EPSG:4326 data\clean\gx_4326.geojson data\raw\hometown.geojson

# 2. 查看数据信息
ogrinfo -so -al data\clean\gx_4326.geojson
```

坐标系与文件大小对比

| 文件名 | 原始大小 | 清洗后大小 | 坐标系 | 要素数 |
| :--- | :---: | :---: | :---: | :---: |
| hometown_4326.geojson | 16k | 16k | EPSG:4326 | 1 |
| gx_4326.geojson | 49k | 49k | EPSG:4326 | 1 |
| gx_fixed.geojson | 49k | 49k | EPSG:4326 | 1 |

结论：
统一为 EPSG:4326 后，文件大小远低于验收要求的 100 KB，无需使用 -simplify 进行简化，保留了原始几何精度。

前端接入配置与显示记录

```js
// src/main.js 核心配置
const url = '/data/gx_fixed.geojson'; // 前端指向 public/data 目录下的文件
// ...
view: new View({
  center: fromLonLat([108.625, 23.5]), // 家乡中心点
  zoom: 9
});
```

运行电脑终端 npm run dev，浏览器打开后成功显示家乡轮廓。

## 五、日常命令备忘录

### 进入仓库

```bash
cd /d D:\xx\GitProjects\gis-learning  # 前端开发（在 webgis-starter 目录下）
npm run dev
```

### Git 提交流程（注意 commit 拼写）

```bash
git add .
git commit -m "feat: 完成第2周任务，修复几何及属性字段，成功在前端渲染GeoJSON"
git push
```

## 六、踩坑补充

| # | 现象 | 根因 | 解法 |
| --- | --- | --- | --- |
| N12 | UCRT64 终端里 pacman 和 ogrinfo 均报 command not found | 当前终端并非真正的 MSYS2 完整环境，缺少 GDAL 包管理器 | 放弃在该终端折腾，改用 QGIS 自带的 OSGeo4W |
| N13 | 'og' 不是内部或外部命令 | 命令拼写不完整，GDAL 不支持该缩写 | 必须输入全拼 ogrinfo 或 ogr2ogr |
| N14 | QGIS 工具箱搜“修复”找不到目标工具 | 搜到了“修复形状文件”（针对 Shapefile 的工具），而非修复几何的工具 | 在工具箱搜索 “几何” 或 “Fix geometries”，且输入图层必须选原始图层，不能选“输出错误”图层 |
| N15 | QGIS 导出 GeoJSON 报错 | 字段 parent 的类型不受支持；DataV 数据的 parent 字段是嵌套 JSON 对象，GeoJSON 标准规范不支持这种复杂类型 | 导出时取消勾选 parent 字段，或只用 name / adcode；也可以用 ogr2ogr -select "name,adcode" 过滤字段 |
| N16 | git comit is not a git command | 拼写错误，少打了一个 m | 正确拼写是 git commit，重新执行后再 git push |
| N17 | 文件大小只有 15KB，感觉太小想强行压缩 | DataV 下载的是单一区县数据（Feature Count: 1），不是省市整体数据 | 15KB 完全合规且优质，不要强行 -simplify 破坏形状；想练分级配色可重新下载包含多个区县的市级/省级数据 |
| N18 | Markdown 标题不变成蓝色 | 上方代码块没有闭合（缺结尾的 ） | 在代码内容末尾新起一行，顶格补上三个英文半角反引号``` |
| N19 | Markdown 表格竖线 | 排版错乱；中文字符占 2 格，英文/数字占 1 格，VS Code 等宽字体对不齐；且表格中误将 49KB 写成了 16KB | 安装 Markdown All in One 插件，按 Shift+Alt+F 一键格式化；同时务必核对数据准确性，gx_fixed.geojson 实际为 49KB |

## 七、W2 验收自检

| 验收项 | 状态 | 证据 |
| :--- | :---: | :--- |
| ogrinfo -so 能看到正确的坐标系和要素数 | ✅ | 输出显示 EPSG:4326 和 Feature Count: 1 |
| 精简后的文件 < 100 KB 且目视形状可接受 | ✅ | 文件 49 KB，QGIS 及前端渲染形状完整 |
| 把这份 GeoJSON 拖进 webgis-starter 页面，能自动定位并显示 | ✅ | 浏览器成功渲染，地图自动定位到下载数据范围 |
| 总结 | ✅ | W2 通关 |
