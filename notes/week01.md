# W0 环境搭建与踩坑记录

> 日期：2026-10-07 ｜ 状态：✅ W0 通关
> 相关：[12 周学习计划](../docs/WebGIS-12周学习计划.md) ｜ 起步项目：[webgis-starter](../projects/webgis-starter/README.md)

## 一、完成清单

- [x] 跑通 `webgis-starter`（OpenLayers：6 种底图 / 3 个矢量图层 / 绘制 / 测距测面积 / 拖拽导入 / 导出 GeoJSON）
- [x] 建立 GitHub 仓库 `gis-learning`，学习计划 + 起步项目已推送
- [x] WSL2 3.0.1 + Docker Desktop 4.94.0 安装完成
- [x] Docker 数据盘迁移到 `D:\xx\DockerData\DockerDesktopWSL`（不动只剩 17 GB 的 C 盘）
- [x] 配置国内镜像加速（`docker.m.daocloud.io` + `docker.1ms.run`，实测 443 端口可达）
- [x] PostGIS 16-3.4 容器运行，`POSTGIS="3.4.3" GEOS="3.9.0" PROJ="7.2.1"` 验证通过
- [ ] QGIS、Python(Miniconda) 待装（W1 需要）

## 二、踩过的坑（全是真实报错，按发生顺序）

| # | 现象 | 根因 | 解法 |
|---|---|---|---|
| 1 | `Cannot find package 'rolldown'` | 本机 pnpm 用 junction 软链布局，Node 解析 ESM 时未对软链做 realpath | 改用 **npm**（扁平 node_modules） |
| 2 | `dataLayers.values is not a function` | `import Map from 'ol/Map.js'` **遮蔽了内置 Map**，`new Map()` 建出的是 OpenLayers 地图对象 | 把 OL 的导入重命名为 `OlMap` |
| 3 | `Cannot read properties of undefined (reading 'toFixed')` | `const {x, y} = fromLonLat(...)`：函数返回**数组**，却用**对象解构**，得到 undefined | 改成 `const [x, y] = fromLonLat(...)` |
| 4 | `! [rejected] main -> main (fetch first)` | 网页改了 README + 本地又提交 → 分支**分叉** | `git fetch` → `git pull --rebase origin main` → `git push`（快进） |
| 5 | `dialing registry-1.docker.io:443 ... connectex 超时` | **DNS 污染**：`registry-1.docker.io` 被解析到 `2a03:2880:...:face:b00c`（Facebook 网段） | 配国内镜像加速器（阿里云 / daocloud） |
| 6 | `docker info \| grep -i mirror` 看不到地址 | 值在**下一行的缩进**里，grep 默认只输出匹配行 | `grep -A3 -i "registry mirrors"` |
| 7 | psql 卡住不动，底部显示 `END` | 输出触发了 `less` **分页器**，此时敲 SQL 无效 | 按 `q` 退出；`\pset pager off` 永久关闭 |
| 8 | `cd D:\xx\...` 报 No such file | Git Bash 把 `\` 当**转义符** | 用 `/d/xx/...` 或 `"D:/xx/..."` |
| 9 | Markdown 里「六、」显示成灰色（标题不生效） | ` ```bash ` 代码块**没有闭合** | 补一行单独顶格的三个反引号（注意别用中文输入法的全角撇号） |

## 三、方法论收获（比具体知识更值钱）

- **报错先读 stderr / Console 全文**，不要猜；报错里的方法名（如 `toFixed`）可以反查调用点，往往一眼定位。
- **测连通性一定要带"已知能通"的对照组**（先用 baidu 确认自己的网络和测试方法正常），才能区分"目标不通"和"自己断了"。
- **教程里的占位符必须替换**：`<你的地址>`、`你的专属前缀`、`YOUR_TOKEN` 这类字样直接粘会 100% 失败，而且报错常常很隐晦。
- **任何数字都要自己验算，包括 AI 给的**：本次发现一处示例坐标值偏差约 1.7 km。
- **容器类配置改完要 `Apply & restart` 才生效**；磁盘位置这类设置必须在 `docker pull` 之前改。
- **工具/环境限制会造成"假阴性"**：某些环境下端口检测、WMI 查询会失败，此时以交互终端的实际结果为准。
- **看现象找规律**：编辑器里蓝色=标记语法生效（标题），灰色=被当成代码内容。

## 四、坐标系实测数据（W1 素材）

用 PostGIS 的 `ST_Transform` 与前端 JS 分别计算 EPSG:3857 坐标：

| 城市 | x_3857 | y_3857 | z=12 瓦片 |
|---|---|---|---|
| 北京 | 12958412.49 | 4852030.63 | 3372/1552 |
| 上海 | 13522390.43 | 3662707.26 | 3430/1673 |
| 广州 | 12608535.33 | 2647638.58 | 3336/1777 |
| 成都 | 11584629.79 | 3577327.84 | 3232/1682 |
| 拉萨 | 10145758.58 | 3458075.89 | 3084/1694 |
| 乌鲁木齐 | 9753457.56 | 5438492.93 | 3044/1492 |

关键结论：

1. **前端 JS 与 PostGIS 结果完全一致**：北京 `POINT(12958412.492568914 4852030.634814578)` —— 坐标转换是确定性的数学，不是玄学；以后"图层对不上"可以用它交叉验证。
2. **球面 vs 椭球差 2.66 km**：北京–上海球面大圆 1068.51 km，而 PostGIS `geography`（WGS84 椭球）为 1065.85 km。前端 `ol/sphere` 用球面模型，数据库 `geography` 用椭球模型。
3. **4326 与 4490 经 PROJ 转换结果完全相同**（椭球扁率倒数只差第 8 位小数）；但中国境内正式成果**法律上必须用 CGCS2000(4490)**。
4. `spatial_ref_sys` 是 PostGIS 的坐标系字典；`proj4text`（给 PROJ 用）与 `srtext`（WKT，给软件/标准用）是同一坐标系的两种描述。
5. WKT 首词可快速判断类型：`GEOGCS` = 地理坐标系（单位度）；`PROJCS` = 投影坐标系（单位米）。3857 的正式名称是 **Pseudo-Mercator**（伪墨卡托），因为它把椭球当正球体处理（`+a=6378137 +b=6378137`）。

## 五、日常命令备忘

```bash
gis                                     # 进仓库（/d/xx/GitProjects/gis-learning）
gisproj                                 # 进起步项目
docker start pgis                       # 启动 PostGIS 容器（电脑重启后需要）
docker exec -it pgis psql -U postgres   # 进数据库：\q 退出 / \pset pager off / \l 看库
docker ps -a                            # 看全部容器（含已停止）
docker logs pgis                        # 容器起不来时看日志
```

交付流程（每次改完代码）：

```bash
gis
git pull                                # 开工前先拉，避免分叉
git add .
git commit -m "week01: 坐标系与投影练习"
git push
```

## 六、环境里的两处"隐藏设施"（知道就好，别乱动）

1. **hosts 文件里的 Steam++ 加速记录**：`C:\Windows\System32\drivers\etc\hosts` 中有 `# Steam++ Start` ~ `# Steam++ End` 包裹的 79 条记录，把 `github.com`、`raw.githubusercontent.com` 等域名指向 `127.0.0.1`，由 Watt Toolkit（Steam++）的本地代理转发。
   - ⚠️ **这些域名只在它运行时才通**。如果哪天"GitHub 突然打不开"或"从 raw.githubusercontent.com 下载数据失败"，先检查它是否在运行；解法是启动它，或在它界面里关闭 hosts 加速功能（会自动还原 hosts）。
   - GIS 学习里常用到 `raw.githubusercontent.com` 上的示例数据，这个坑要记住。

2. **SSH over 443**：`~/.ssh/config` 里配置了 `Host github.com → Hostname ssh.github.com, Port 443`。这让 `git push/pull`（SSH 方式）走独立通路，**不受 hosts 和加速器状态影响**。
   - 所以：**clone 别人的仓库时优先用 SSH 地址**（`git@github.com:用户/仓库.git`）比 HTTPS 稳。

## 七、W1 开局计划（坐标系与投影）

| # | 练习 | 需要的工具 |
|---|---|---|
| 1 | 写脚本：输入经纬度 → 输出 3857 坐标 + z=12/15/18 瓦片编号（对照第四节数据） | Node.js（已有）或 Python |
| 2 | QGIS 里同一份数据分别用 4326 / 3857 打开，量同一条线的长度，对比并解释 | QGIS |
| 3 | 找一份 GCJ-02（高德）坐标数据与 WGS84 数据叠加，量出偏移量 | QGIS |

产出物放 `projects/coordinate-lab/`，建议结构：

```
projects/coordinate-lab/
├─ README.md            # 结论：换算公式、瓦片公式、球面 vs 椭球
├─ coord.mjs            # 练习 1 脚本（与 SQL 版互相验证）
├─ sql/coordinate.sql   # PostGIS 版换算
└─ notes.md             # 练习 2、3 的实验记录
```

**验收标准**（达到才算过关）：

- [ ] 能手算 z=1、z=2 的瓦片编号，并能解释公式每一项
- [ ] 能说清"同一份数据在 QGIS 里对不上底图"的 3 种可能原因
- [ ] 投影换算脚本能跑，结果与 QGIS 一致（误差 < 1 米）
