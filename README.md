# NEED!FLEA 摊位规划工具

网页端 CAD 查看 + 摊位标注工具，支持 DXF/DWG 格式。

**在线访问：https://booth-planner.pbrick.cn/**

## CAD 中文与图形显示

DWG / DXF 文字支持常见中文 GBK 字节、`\M+5XXXX` 中文转义及 `\U+XXXX` Unicode 转义；保留 MTEXT 格式分组内的正文、分段内容和换行。文字按原图高度、宽度、旋转与对齐显示，不再把小注释统一放大。

DXF 路径递归展开 INSERT 块，包含块基点、嵌套旋转 / 缩放、块内图层与 BYBLOCK 颜色；支持匿名 DIMENSION 块中的已有几何。对象坐标系（OCS）与标高先投影到平面，避免竖向门窗构件跑到远处。初始图层显示遵循原图关闭 / 冻结状态，仍可手动开关图层。

验证：`node scripts/check-cad-import.mjs`（需要 3002 静态服务），覆盖中文编码、格式、多行文字、原始字高、嵌套块、坐标投影、图层开关与保存载入。可选设置 `NEEDFLEA_DWG_FILE` 指向演艺中心测绘 DWG 样本，另测真实座椅布局和中文标题；此样本的浏览器 DWG 读取会回退到本地 ODA 服务。测试截图保存在系统临时目录，不提交场地原图。

## 功能工具栏

顶部按用途分为四组，只展开当前组：

- **场地与文件**：选择已保存场地、建立 / 编辑场地（统一 CAD、图片、实测及比例尺入口）、导入项目 JSON、清空标注。
- **摊位与设施**（默认）：分「摊位」「活动组件」子标签。摊位含样式、分类颜色、尺寸、安保、灭火器和批量编号；活动组件含舞台、桁架、展台、招牌、桌台、围挡和属性面板。
- **绘图与测量**：动线、文字、画线与线型、测距、标距、测面积、橡皮擦。
- **视图与导出**：背景切换、摊位图、区域图、标注 DXF、底图 DXF。

顶部保留保存完整项目 JSON 和统一的「场景搭建」入口，二维 / 三维在场景侧栏切换；「选择场地」收在「场地与文件」分组；「选择」工具始终可用。切换分组不更改当前工具、不清空参数或进行中的绘图；使用工具时自动展开对应分组。分组标签支持方向键、Home / End，窄屏工具行可横向滚动。运行 `node scripts/check-toolbar.mjs` 验证功能分组、实际导入 / 放置、状态保留及响应式布局（需要 3002 静态服务）。

## 场地库（浏览器本地保存）

在「场地与文件」分组点击「🏛 选择场地」进入场地与活动库。一个场地对应多份独立的活动布局：场地基础保存底图、比例尺和环境，不含摊位；每个活动保存自己的完整项目快照。新建场地可导入 DXF / DWG、已有项目 JSON 或使用当前画布；已有 JSON 的布局会保存为首个活动。

使用流程：选择场地 → 选择活动 →「载入活动」。同一场地下用「为此场地新建活动」导入另一份 JSON、从场地基础开始空布局，或复制当前画布；不需要为每次活动重复创建场地。活动 JSON 自带底图时使用自己的底图，没有底图时继承所选场地基础。编辑后「保存当前活动布局」仅更新当前活动；「保存场地基础（不含摊位）」仅更新基础，不回写已有活动。未保存修改切换前会提示。

场地使用当前浏览器、当前网站地址的 IndexedDB 保存，刷新或关闭后仍可读取；**不会同步到其他电脑、浏览器或不同端口地址**。清理网站数据会删除本地记录，因此请分别「导出活动 JSON」备份每个活动；每份活动 JSON 包含底图、环境和布局，换电脑时可重新导入。场地基础也可单独导出，基础 JSON 不包含活动。项目保持 v3，可选 `site: { name, eventName }` 保存名称，不包含浏览器内部 ID。

IndexedDB 由 v1 升级至 v2 时，在单个升级事务中将旧布局与活动备注复制为首个活动，原环境 / 照片 / 标注保留，场地基础移除摊位。升级失败会整体回滚，不清空旧库。测试运行 `node scripts/check-site-library.mjs`，验证迁移、多活动隔离、不同 JSON / 空布局 / 当前画布、持久化、切换保护、失败恢复和活动完整备份，不调用模型服务。

## 场景搭建

先通过「场地与文件 → 建立 / 编辑场地」完成二维场地；然后进入「🏛 场景搭建」补高度、布置和出图，不需要生成服务或 API 密钥。两处共用侧栏，场景页通过「编辑场地」返回建场页；未建立场地或未定比例尺时进入场景搭建会引导到建场页。CAD / 图片按钮共用原 file-input 和导入逻辑，比例尺只有一个 btn-calib 控件；顶部「保存」统一备份完整项目：

1. **建立场地**：导入 CAD / 平面图片，或按米新建矩形、输入多边形坐标建立实测场地。实测边界可以在二维画布重新描绘，0.1 米吸附；图片需用已知长度校准。图片提供颜色与标识，不能自动推断高度。
2. **结构高度**：在二维或三维放置墙、柱、平台、建筑与树木，输入位置、尺寸、转角和离地高度；设置地面颜色、参数纹理或内嵌材质。
3. **活动布置**：在「摊位与设施 → 活动组件」添加舞台、桁架展亭、展台、招牌、桌台和围挡。二维占地轮廓和三维共享同一对象，可通过属性列表编辑名称、颜色、位置、尺寸和复制。摊位与组件均支持三维点击放置；右键点击删除，右键拖动保持平移。摊位新建与载入统一保存 height:2.5（米），帐篷含屋顶总高 2.5 米；空地仍只显示占地，不生成 2.5 米方块。
4. **展示出图**：鸟瞰 / 人视角、保存并恢复机位、显示或隐藏名称、16:9 图片导出（1920 / 2560 / 3840 像素宽）。保存完整项目保留全部场景和机位。

场地基础保留固定结构与实测边界，活动保存自己的组件与机位；从当前画布保存场地基础时会移除活动组件和摊位。当前采用参数化基础几何，尚未支持精细 GLB 模型导入、自动建筑重建或照片转模型。人视角使用轨道操作，未提供漫游键盘导航。

旧项目的 CAD、摊位、手动结构、照片及分析记录仍可读取。已移除 Marble 生成、任务服务、SPZ 校准及 Spark 渲染；旧项目中的该资源字段不再使用或导出。本机仓库外的历史资源与配置不会被清理。

验证：`node scripts/check-environment.mjs` 检查 CAD 与三维兼容；`node scripts/check-photo-generation.mjs`（历史文件名）检查建场与场景工作流、实测场地、组件、机位及移动端；`node scripts/check-site-library.mjs` 检查活动隔离；`node scripts/check-layout-components.mjs` 检查真实三维点击放置、五种样式的高度、右键删除与拖动平移、二维删除和保存恢复。默认测试地址为 3002，也可用 `NEEDFLEA_URL` 指定。旧 CLI 服务检查 `node scripts/check-codex-environment.mjs` 不调用模型。

> 在线版为纯前端（GitHub Pages 部署），支持 DXF 与场景图；DWG 转换依赖本地
> `dwg-server`，需按下方说明本地运行。

## 快速启动（本地）

```bash
cd needflea-booth-planner
npm install

# 启动文件服务器（端口 3000）
python3 -m http.server 3000

# 启动 DWG 转换服务器（端口 3001，需要 ODA File Converter）
node dwg-server.mjs

# 打开浏览器 → http://localhost:3000
```

### DWG 支持（可选）

DWG 文件需要本地安装 [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)（免费），用于将 DWG 转换为 DXF。

- macOS：下载 DMG 安装到 `/Applications/ODAFileConverter.app`
- 启动 `node dwg-server.mjs` 提供转换服务
- 没有 ODA 的用户可以直接导入 DXF 文件（由有 ODA 的用户导出）

## 使用流程

### 场景搭建（Three.js）

先建立二维场地，再补充结构高度、活动组件和机位，操作见上面的「场景搭建」。CAD 主流程和原有摊位字段保持兼容。三维操作为拖动旋转、滚轮缩放、右键平移；点击放置期间暂停轨道操作，Esc 取消。

「建立场地」中的参考照片可标注位置和朝向：先在二维点击拍摄点，再点击朝向点；Esc、右键或取消保留原标记。照片、材质及完整场景保存在项目文件中，原 localStorage 自动保存不是完整备份。

项目 v3 使用可选 `environment` 字段，不改变原有 `venue` 格式。`sitePlan: {schema:"needflea-site-plan/1",points:[{x,y},…]}` 保存无 CAD 的米制多边形边界（`metersPerUnit` 必须为 1）；`views` 保存机位的名称、position、target 与 fov；`showLabels` 控制名称显示。旧版本程序不保证保留新增字段。示例：

```json
{
  "schema": "needflea-environment/1",
  "floorColor": "#d4cbbd",
  "wallColor": "#deddd5",
  "showPlan": true,
  "showStructures": true,
  "objects": [
    { "id": 1, "type": "column", "x": 5000, "y": 3000,
      "width": 0.5, "depth": 0.5, "height": 3.6, "angle": 0 }
  ]
}
```

对象支持 `wall`、`column`、`platform`、`building`、`tree`（场地固定结构），以及 `stage`、`truss`、`counter`、`sign`、`table`、`fence`（活动组件）；新增 `elevation` 为离地高度（米），`scope` 标识归属；`x/y` 为几何中心的 CAD 世界坐标（Y 向上），`width/depth/height` 为米，`angle` 为平面逆时针角度。上例坐标仅演示格式，实际应使用场地坐标。可选 `photos` 存储 `{name,note,dataUrl}`；`floorTexture` 存储内嵌材质图片，`textureMeters` 指定重复单元宽度（默认 2 米），`notes` 存储实测记录。

兼容可选字段：`floorPattern` 为 `plain/tile/wood/concrete`，`floorTileMeters` 为纹理单元尺寸；对象的 `estimated` 和 `source` 记录是否包含估计尺寸及其照片/CAD 依据；`analysis` 保存模型摘要、假设、待确认问题和模型名，随项目保存与载入。

照片可选 `camera: {x,y,targetX,targetY}`：位置与朝向参考点均使用 CAD 世界坐标，连线只表示平面朝向，不表示测量距离或照片里某个物体的精确位置。图纸右侧为 0°、上方为 90°。这些数据随项目保存；楼层、拍摄高度、俯仰角仍需在文字说明中补充，不由平面箭头推断。

当前环境采用简化几何，不提供完整建筑重建、自动测量、碰撞检查或消防通道合规判断。现场照片和实测资料由用户提供；三维墙柱可隐藏以便查看摊位布局。尚未提供 GLB 导入、屋顶或门窗。

### 1. 导入 CAD 文件

- **DXF 文件**：拖入或点击「导入 DXF/DWG」直接加载
- **DWG 文件**：自动走 ODA 转换流程（需要 dwg-server 运行）
  - 支持 AC1015 (AutoCAD 2000) 到 AC1032 (AutoCAD 2018) 所有版本
  - 转换后可点击「💾 底图DXF」下载 DXF 文件，分享给其他用户

### 2. 定比例尺（重要）

点击「📐 定比例尺」→ 在图上点两个已知距离的点 → 输入真实距离（米）。

DWG 文件会自动从 `$INSUNITS` 读取单位（如毫米=1m:1000单位），通常无需手动设定。

### 3. 标注摊位

- 工具栏选择摊位类型（颜色）和尺寸（2×2m / 3×3m / 2×4m）
- 点击图面放置帐篷
- 选中帐篷后可在右侧面板修改类型、尺寸、旋转角度、标注文字
- **批量编号**：点击「🔢 批量编号」，蛇形排序（从上到下、左右交替），可清除编号

### 4. 其他标注工具

| 工具 | 说明 |
|------|------|
| 👮 安保 | 点击放置安保点位 |
| 🧯 灭火器 | 点击放置灭火器 |
| → 动线 | 拖动画箭头 |
| T 文字 | 点击放置文字标注（可调字体大小） |
| ✏ 画线 | 自由画线标注 |
| 📏 距离 | 测量两点距离 |
| 📐 标距 | 放置尺寸标注 |
| ○ 测面积 | 测量多边形面积 |

### 5. 图层控制

右侧面板显示 CAD 图层列表，可切换可见性。DWG 转换文件支持完整的图层切换。

### 6. 导出

| 按钮 | 说明 |
|------|------|
| 💾 保存 | 保存项目（JSON，含底图+标注） |
| 📥 载入 | 加载已保存项目 |
| 🖨 白图 | 导出白底 PNG（打印用） |
| 💾 全图 | 导出完整截图 PNG |
| ✂ 截取 | 框选区域导出 |
| 📤 DXF | 导出标注为 DXF（含 CAD 图层） |
| 💾 底图DXF | 下载 ODA 转换的底图 DXF（分享给无 ODA 用户） |

## 项目 JSON 格式（v3）

保存的项目 JSON 是自包含的：除了原始 CAD 文件（`cadFile.base64`）和标注（`items`），
v3 起还内嵌 `venue` 区块 —— 已解析好的场地底图，其他软件**无需 CAD 解析器**即可
渲染出完整摊位图。

```jsonc
{
  "version": 3,
  "cadFile": { "name": "1F.dxf", "base64": "…" },   // 原始 CAD（本工具重载用）
  "categories": { "二手": { "fill": "#5B8FE8", "stroke": "#3a6ec4" }, … },
  "items": [ /* 摊位/安保/动线等标注，世界坐标 */ ],
  "metersPerUnit": 0.001,                            // 世界单位 → 米
  "venue": {
    "schema": "needflea-venue/1",
    "bounds": { "minX", "minY", "maxX", "maxY" },    // 世界坐标，Y 向上
    "layers": [ { "name", "color", "visible" } ],
    "entities": [                                     // 归一化几何，颜色已解析为 hex
      { "type": "line",     "layer", "color", "lineType", "x1","y1","x2","y2" },
      { "type": "polyline", "layer", "color", "lineType", "closed", "points": [[x,y],…] },
      { "type": "circle",   "layer", "color", "cx","cy","r" },
      { "type": "arc",      "layer", "color", "cx","cy","r", "startAngle","endAngle" }, // 度，逆时针
      { "type": "text",     "layer", "color", "x","y", "height", "angle", "text" }
    ],
    "svg": {                                          // 现成的整图快照（底图+摊位）
      "width", "height", "scale", "offsetX", "offsetY",
      "content": "<svg …>"                            // px = x*scale+offsetX, py = -y*scale+offsetY
    }
  }
}
```

摊位项：`{ type:'booth', wx, wy /*左上角*/, ww, wh, angle /*度，绕中心逆时针*/, cat, label }`，
颜色查 `categories[cat]`。

参考实现：`node render-project-json.mjs <project.json> [out.png]` —— 仅凭
`venue.entities` + `items` 重建摊位图（不读 cadFile），可直接作为第三方接入范例。
背景为图片的项目（场地照片模式）没有矢量底图，`venue` 为 `null`，图片在
`cadFile.base64`（`isImage: true`）。

## 停止服务

```bash
# 在各服务终端按 Ctrl+C，停止自己启动的服务
```

## 快捷操作

| 操作 | 说明 |
|------|------|
| 滚轮 | 缩放 |
| Alt + 拖动 | 平移视图 |
| 中键拖动 | 平移视图 |
| 双击空白 | 适合视图 |
| R / L | 旋转选中帐篷 |
| Shift + 点击 | 多选 |
| 右键元素 | 删除 |
| Esc | 退出当前工具 |

## 文件结构

```
needflea-booth-planner/
├── index.html        # 主界面
├── app.js            # 主控制器（DWG/DXF 加载、工具、导出）
├── dxf-parser.js     # DXF 解析器
├── renderer.js       # CAD 渲染引擎（缩放平移）
├── booth.js          # 摊位标注系统 + DXF 导出
├── dwg-server.mjs    # DWG→DXF 转换服务器（ODA）
├── libdxfrw.js       # libdxfrw WASM（浏览器端 DWG 解析备选）
├── libdxfrw.wasm     # WASM 二进制
└── package.json
```

## CAD 兼容性

| 格式 | 支持 | 说明 |
|------|------|------|
| DXF (ASCII) | ✅ 常见二维实体 | R12/R14/2000~2018；特殊实体见下方限制 |
| DWG + ODA | ✅ 转换后读取二维实体 | AC1015~AC1032，需 dwg-server；渲染限制同 DXF |
| DWG (仅浏览器) | ⚠️ 部分 | libdxfrw WASM，部分版本/文件可能失败 |

### 已知限制

- DXF 支持嵌套 INSERT 展开，但动态块、三维实体和外部参照不保证完整显示
- DIMENSION 使用文件已有的匿名块几何，不重新计算缺失块的尺寸标注
- 浏览器使用系统字体替代 CAD 专用 SHX / Bigfont，复杂富文本样式仍可能与 CAD 软件不同
- 复杂 HATCH 填充模式简化显示

## 技术依赖

- **前端**：纯 HTML/JS/Canvas，无框架
- **三维**：Three.js 0.186.1（MIT），运行资源和许可证在 `vendor/three/`；`environment.js` 管理环境资料与面板，`scene-three.js` 使用 ES module 加载三维库。旧 `iso-renderer.js` 保留。
- **DWG 转换**：[ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)（免费）
- **Node.js 依赖**：puppeteer, sharp, @mlightcad/libredwg-web（`npm install`）

## 三维环境验证

先安装依赖并启动静态服务，再运行：

```bash
npm ci
# 另一个终端启动：python3 -m http.server 3002 --bind 127.0.0.1
node scripts/check-environment.mjs
# 自定义已有服务地址：
NEEDFLEA_URL=http://localhost:3000 node scripts/check-environment.mjs
```

脚本在独立 Puppeteer 浏览器中生成临时 CAD / 图片样本，验证三维放置与尺寸编辑、照片/材质输入、环境导入校验、PNG 导出、项目保存载入和旧 JSON 兼容性。输出目录位于系统临时目录，不使用个人 CAD 文件，也不覆盖仓库中的旧截图。

```bash
node scripts/check-photo-generation.mjs
```

该脚本现验证建场与统一活动组件布置、实测场地、组件与机位持久化、键盘导航、移动端以及不连接旧生成服务，不消耗模型额度。

```bash
# 验证 CLI 参数、图片附件、结构化输出和临时目录清理（不调用模型）
node scripts/check-codex-environment.mjs
# 可选：已通过 ChatGPT 登录后，用合成参考图做一次真实订阅连通测试
# 此项会消耗现有 Codex 套餐额度
node scripts/check-codex-environment.mjs --live
```

真实连通测试只验证订阅登录、图片输入和结构化输出，不代表真实场地识别精度；后者需用现场照片验证。
