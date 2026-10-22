# NEED!FLEA 摊位规划工具

网页端 CAD 查看 + 摊位标注工具，支持 DXF/DWG 格式。

**在线访问：https://booth-planner.pbrick.cn/**

## CAD 中文与图形显示

DWG / DXF 文字支持常见中文 GBK 字节、`\M+5XXXX` 中文转义及 `\U+XXXX` Unicode 转义；保留 MTEXT 格式分组内的正文、分段内容和换行。文字按原图高度、宽度、旋转与对齐显示，不再把小注释统一放大。

DXF 路径递归展开 INSERT 块，包含块基点、嵌套旋转 / 缩放、块内图层与 BYBLOCK 颜色；支持匿名 DIMENSION 块中的已有几何。对象坐标系（OCS）与标高先投影到平面，避免竖向门窗构件跑到远处。初始图层显示遵循原图关闭 / 冻结状态，仍可手动开关图层。

验证：`node scripts/check-cad-import.mjs`（需要 3002 静态服务），覆盖中文编码、格式、多行文字、原始字高、嵌套块、坐标投影、图层开关与保存载入。可选设置 `NEEDFLEA_DWG_FILE` 指向演艺中心测绘 DWG 样本，另测真实座椅布局和中文标题；此样本的浏览器 DWG 读取会回退到本地 ODA 服务。测试截图保存在系统临时目录，不提交场地原图。

## 功能工具栏

顶部按用途分为四组，只展开当前组：

- **场地与文件**：导入底图、定比例尺、载入 JSON、清空标注。
- **摊位与设施**（默认）：摊位样式、分类颜色、尺寸、安保、灭火器、批量编号。
- **绘图与测量**：动线、文字、画线与线型、测距、标距、测面积、橡皮擦。
- **视图与导出**：背景切换、摊位图、区域图、标注 DXF、底图 DXF。

选择场地、保存完整项目 JSON、3D 和场地环境保留在顶部；「选择」工具始终可用。切换分组不更改当前工具、不清空参数或进行中的绘图；使用工具时自动展开对应分组。分组标签支持方向键、Home / End，窄屏工具行可横向滚动。运行 `node scripts/check-toolbar.mjs` 验证功能分组、实际导入 / 放置、状态保留及响应式布局（需要 3002 静态服务）。

## 场地库（浏览器本地保存）

工具栏点击「🏛 选择场地」进入场地与活动库。一个场地对应多份独立的活动布局：场地基础保存底图、比例尺和环境，不含摊位；每个活动保存自己的完整项目快照。新建场地可导入 DXF / DWG、已有项目 JSON 或使用当前画布；已有 JSON 的布局会保存为首个活动。

使用流程：选择场地 → 选择活动 →「载入活动」。同一场地下用「为此场地新建活动」导入另一份 JSON、从场地基础开始空布局，或复制当前画布；不需要为每次活动重复创建场地。活动 JSON 自带底图时使用自己的底图，没有底图时继承所选场地基础。编辑后「保存当前活动布局」仅更新当前活动；「保存场地基础（不含摊位）」仅更新基础，不回写已有活动。未保存修改切换前会提示。

场地使用当前浏览器、当前网站地址的 IndexedDB 保存，刷新或关闭后仍可读取；**不会同步到其他电脑、浏览器或不同端口地址**。清理网站数据会删除本地记录，因此请分别「导出活动 JSON」备份每个活动；每份活动 JSON 包含底图、环境和布局，换电脑时可重新导入。场地基础也可单独导出，基础 JSON 不包含活动。项目保持 v3，可选 `site: { name, eventName }` 保存名称，不包含浏览器内部 ID。

IndexedDB 由 v1 升级至 v2 时，在单个升级事务中将旧布局与活动备注复制为首个活动，原环境 / 照片 / 标注保留，场地基础移除摊位。升级失败会整体回滚，不清空旧库。测试运行 `node scripts/check-site-library.mjs`，验证迁移、多活动隔离、不同 JSON / 空布局 / 当前画布、持久化、切换保护、失败恢复和活动完整备份，不调用模型服务。

## Marble 实景环境（本地 API 接入）

「场地环境」提供两种添加方式：

- **手动增加环境**：地面颜色 / 纹理 / 材质近照、CAD 底图显示、墙柱台面的实测尺寸与放置、对象编辑。环境 JSON 导入 / 导出收在折叠区。
- **Marble 生成**：场地照片与拍摄标注、场地说明 / 生成要求、输入方式与模型、费用确认、任务进度与恢复、场景预览和 CAD 校准。当前接入照片输入，尚未接视频。

默认打开手动方式；载入已有 Marble 的项目时打开 Marble。切换只改变操作面板，保留照片、手动对象和已应用场景。预览期间需先应用 / 放弃，加载期间可取消后切换。底部的视图、图片导出和完整项目保存为共用操作。原 Codex 照片简模入口已从页面移除，不再自动连接 3003；旧项目的分析记录和生成要求仍兼容保留，旧本地服务文件保留供历史使用。

Marble 工作流：上传照片 → 选择输入方式和模型 → 查看费用并确认 → 生成 / 查询进度 → 加载预览 → CAD 对齐 → 应用 → 保存完整项目。Marble 使用独立 World API 额度，不需要先购买 Marble 网页 Pro。

安装依赖后，本地运行静态页面与 Marble 服务（Node.js 22.16+，支持 `process.loadEnvFile`；当前验证环境为 Node.js 25）：

配置了 `HTTP_PROXY` / `HTTPS_PROXY` 的机器推荐 Node.js 24.14+ / 25.4+，服务会在启动时启用 Node 内置代理支持；本地请求仍遵循 `NO_PROXY`。较早的 Node.js 22.21+ / 24.5+ 可用 `node --use-env-proxy marble-server.mjs` 启动。代理地址和凭据不写入项目或网页。高清资源下载上限为 10 分钟，网页等待最多 11 分钟、解码最多 2 分钟；失败恢复之前的精度，可继续重试已有结果。

```bash
npm ci
# 终端一；3000 被其他应用使用时用 3002
python3 -m http.server 3002 --bind 127.0.0.1
# 终端二
node marble-server.mjs
```

浏览器打开 `http://127.0.0.1:3002`。服务监听 `127.0.0.1:3004`。**不要把真实密钥写入网站目录**，因为静态 HTTP 服务可能直接公开其中的文件；`.gitignore` 只能防止 Git 提交，不能防止 HTTP 访问。

将密钥在终端设置为 `WORLDLABS_API_KEY` 后从该终端启动服务；或在网站目录之外创建 `~/.config/needflea/marble.env`，内容为一行 `WORLDLABS_API_KEY=你的密钥`，限制为本人可读写（`chmod 600 ~/.config/needflea/marble.env`）。服务启动时自动读取此文件。文件内容和密钥不会返回浏览器，也不写入项目 JSON、任务记录或日志。密钥变更后重启 Marble 服务。

使用前在网页点击「检查余额」，只查询余额，不生成或消耗生成额度。用户勾选费用说明并点击「用 Marble 生成」才提交付费请求。服务先核验图片和余额：

- 同一空间多图重建：最多 8 张普通照片，使用官方 `reconstruct_images: true`。尺寸不同时，服务自动等比缩放并补边到统一画布（最长边不超过 2048），不拉伸、不裁切；保留项目中的原图和拍摄标注。提示模型忽略补边。无需使用者先统一图片尺寸。
- 朝向组合：最多 4 张照片。已有 CAD 拍摄箭头换算为相对首个已标注照片的顺时针 `azimuth`；这是方向提示，不是精确三维相机姿态。未标注的图不提交 azimuth。
- 360° 全景：单张完整等距柱状全景，宽高必须 2:1。普通手机横向全景不是完整全景，不能只靠改尺寸满足要求。
- 目前照片在浏览器缩放至最长边 2400 像素、JPEG 压缩并限制在 4MB 数据 URL 以下，再与说明发送至 World Labs。不会把 CAD 文件或用户密钥发送为照片内容。

官方当前价格基于 $1 / 1,250 credits，完整全景生成 Marble 1.1 为 1,500 credits，多图正式生成为 1,600，草稿多图为 250；Plus 可能额外消耗最多 1,500。界面按选项显示预计费用，任务成功后显示 API 返回的结算费用（若有）。不自动请求高质量 GLB 网格导出，不自动重试付费 POST。定价会变化，见 [官方计费](https://docs.worldlabs.ai/api/pricing)。

任务和下载资源默认保存在系统临时目录的 `needflea-marble`，不包含密钥和原始输入照片。生产或长期保存请把 `MARBLE_DATA_DIR` 设置到网站目录之外的持久目录。此目录内的随机任务 ID JSON 保存 Operation ID、资源链接和结算费用；已下载的 SPZ 会缓存，重启服务可继续查询同一任务。不要删除正在使用的目录。`MARBLE_DAILY_LIMIT` 默认限制最近 24 小时最多 10 个提交记录，一次只允许一个活动任务；它是本地保护，不替代 World Labs 的账单约束。

若付费 POST 途中断网，服务标记为「提交结果待确认」，阻止自动重复生成。在 World Labs 控制台确认后，可在「历史任务 / 恢复任务」填 Operation ID 关联原任务，或明确确认不存在任务后解除阻塞。关闭网页只是停止查看，不会取消上游任务或退还生成费用。任务列表和保存的任务 ID 支持刷新后恢复。

场景通过仓库内 Spark 2.4.0 与 Three.js 混合渲染，新预览优先加载轻量 100k SPZ，可切换 500k 或完整精度（取决于 API 提供的资源，切换不重新生成）。加载时显示渲染器、下载和解码阶段，下载可查看传输量，支持取消、超时提示和重试；取消加载保留生成结果，不重新收费生成。默认「进入场景」从生成视点内部观看，临时隐藏 CAD、摊位与标签；拖动环顾、滚轮前后移动，点击画面后用 WASD 移动、R/F 升降。「俯视校准」恢复叠加和轨道镜头，用于选对应点；查看模式不写入项目数据。按官方 `metric_scale_factor`、`ground_plane_offset` 处理比例和地面，再绕 X 轴旋转 180°转换到 Three.js；CAD 校准变换单独保存，避免重复缩放。GLB 碰撞网格地址保留在项目中，本阶段的自由查看不检测墙体碰撞。

校准时点击「添加对应点」，在三维环境中选地面墙角 / 柱脚，再在二维 CAD 中点击同一位置；至少两组，建议三组以上。点击「计算对齐」拟合平移、统一比例与平面旋转，并显示误差。高度可手动调整。用未参与拟合的点交叉检查；生成的局部扭曲无法靠整体变换修复，尺寸与通道检查仍以 CAD / 实测为准。

完整项目的可选 `environment.marble` 保存资源 URL、模型、米制元数据、可见性、精度、校准变换及已知生成费用，**不内嵌 SPZ**。换电脑时需迁移持久资源目录并配置可访问的资源地址；仅传项目 JSON 不包含大体积环境文件。放弃预览不会修改已有环境；载入无 Marble 字段的旧项目会清空旧场景。

此版服务只允许本地 HTTP 页面，API Key 留在本地服务。现有 GitHub Pages 仍是静态网站，尚未部署公网 Marble 后端。后续线上生成需部署带用户认证、任务持久化和预算控制的 HTTPS 服务；通过 `window.NEEDFLEA_MARBLE_API_URL` 配置 API 根地址。不能把此无用户认证的本地服务直接暴露到公网。

网页从点击生成起显示整理照片、检查额度、提交任务、生成环境及完成阶段，包含实际耗时和阶段记录。服务通过 NDJSON 实时发送照片检查 / 统一尺寸、余额检查、提交状态及心跳；提交后继续轮询原 Operation，仅显示上游实际提供的百分比。校验或余额错误标记为「本次尚未提交给 Marble，未产生生成费用」，与提交结果待确认的错误分开处理。

新增文件：`marble-server.mjs`（World API / 任务 / 资源缓存）、`marble-photo-input.mjs`（图片校验与等比补边）、`marble-contract.mjs`（输入与资源校验、费用估计、校准）、`marble-ui.mjs`（网页工作流）、`vendor/spark/`（固定版渲染器）。`environment.js` 现为 ES module，仍在 `app.js` 后加载；原有 CAD 主脚本保持经典全局脚本。

验证：静态服务启动后执行 `node scripts/check-marble.mjs`。该脚本只使用模拟 World API 和合成 SPZ，检查费用与请求边界、任务恢复、真实 Spark 渲染、坐标转换、三维 / CAD 选点和应用保存，不消耗真实 API 额度。真实场地识别质量需使用用户照片另外验收。

`node scripts/check-photo-generation.mjs` 现检查两种添加方式的字段归属、切换保留数据、键盘导航、旧项目兼容以及不调用旧 Codex 服务；`node scripts/check-environment.mjs` 检查手动建模 / 照片标注 / 保存导出。`scripts/check-codex-environment.mjs` 仅为保留的旧 CLI 服务检查，不代表当前网页仍提供该入口。

参考：[World API](https://docs.worldlabs.ai/api/reference/worlds/generate)、[多图输入](https://docs.worldlabs.ai/api/world-generation-examples)、[SPZ 比例与坐标](https://docs.worldlabs.ai/api/rendering-spz)、[Spark](https://sparkjs.dev/docs/)。

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

### 场地三维环境（Three.js）

1. 导入 CAD 或图片底图，先设定比例尺，再放置摊位。
2. 点击「🏛 场地环境」进入三维预览和环境面板。三维库随仓库提供，无需构建或连接外部 CDN。点击「🧊 3D」可直接切换二维/三维。
3. 选择「手动增加环境」设置地面材质并添加结构，或选择「Marble 生成」上传照片。照片内嵌到项目中最多保留 12 张；每次 Marble 提交须符合所选输入方式的数量限制，并确认费用。
4. 填写高度、墙厚或柱宽等尺寸，在三维底图上定位：墙体点击起点和终点；柱子、台面点击中心。列表中可编辑精确坐标、尺寸、角度或删除对象。
5. 设置地面/墙柱颜色；可上传正对地面的材质近照，并设定一块贴图对应的实际宽度。关闭「显示 CAD / 图片地面底图」可看完整材质。普通透视场景照片作为外观参考，不能直接当成准确平面图。
6. 点击「保存完整项目」或工具栏「保存」，环境、参考照片、材质与标注一起保存到项目 JSON。旧项目仍可载入，不含环境时使用默认场景。

操作：拖动旋转、滚轮缩放、右键平移；放置墙柱时暂停视角控制，按 Esc 取消。「适合视图」重置视角；「导出 3D 图片」导出当前三维视角，工具栏「摊位图 → 全图」在三维模式下也会导出三维画面。

手动方式只需要静态页面，不需要模型服务。Marble 方式需要启动 3004 服务，使用独立 API 额度，具体流程见本文开头。

在 Marble 面板的照片下点击「在图上标注」会切到二维底图：先点拍摄位置，再点镜头看向的位置。Esc、右键或「取消标注」保留原标记；完成后恢复原视图。P 编号和箭头在二维 / 三维图中与照片对应，可重新标注或清除，不改变摊位。

原 Codex 照片简模入口已退出当前网页。历史本地服务和 CLI 文件仍保留；旧项目的分析记录与估计标记仍可保存载入，不需要启动该服务。

项目 v3 新增可选 `environment` 字段，不改变原有 `venue` 格式：

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

对象支持 `wall`、`column`、`platform`；`x/y` 为几何中心的 CAD 世界坐标（Y 向上），`width/depth/height` 为米，`angle` 为平面逆时针角度。上例坐标仅演示格式，实际应使用场地坐标。可选 `photos` 存储 `{name,note,dataUrl}`；`floorTexture` 存储内嵌材质图片，`textureMeters` 指定重复单元宽度（默认 2 米），`notes` 存储实测记录。

照片生成可选字段：`floorPattern` 为 `plain/tile/wood/concrete`，`floorTileMeters` 为纹理单元尺寸；对象的 `estimated` 和 `source` 记录是否包含估计尺寸及其照片/CAD 依据；`analysis` 保存模型摘要、假设、待确认问题和模型名，随项目保存与载入。

照片可选 `camera: {x,y,targetX,targetY}`：位置与朝向参考点均使用 CAD 世界坐标，连线只表示平面朝向，不表示测量距离或照片里某个物体的精确位置。图纸右侧为 0°、上方为 90°。这些数据随项目保存；Marble 朝向组合模式使用箭头方向，多图重建不把这些平面坐标当作精确相机位姿；楼层、拍摄高度、俯仰角仍需在文字说明中补充，不由平面箭头推断。

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

该脚本现验证手动 / Marble 面板切换、字段显示、数据保留、键盘导航与不连接旧 Codex 服务，不消耗模型额度。

```bash
# 验证 CLI 参数、图片附件、结构化输出和临时目录清理（不调用模型）
node scripts/check-codex-environment.mjs
# 可选：已通过 ChatGPT 登录后，用合成参考图做一次真实订阅连通测试
# 此项会消耗现有 Codex 套餐额度
node scripts/check-codex-environment.mjs --live
```

真实连通测试只验证订阅登录、图片输入和结构化输出，不代表真实场地识别精度；后者需用现场照片验证。
