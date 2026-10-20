# NEED!FLEA 摊位规划工具

网页端 CAD 查看 + 摊位标注工具，支持 DXF/DWG 格式。

**在线访问：https://booth-planner.pbrick.cn/**

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
3. 添加现场照片，填写拍摄方向、对应位置及层高等实测记录。照片会缩小后内嵌到项目中，最多 12 张；只有点击「从照片生成环境」时才发送给配置的模型接口。
4. 填写高度、墙厚或柱宽等尺寸，在三维底图上定位：墙体点击起点和终点；柱子、台面点击中心。列表中可编辑精确坐标、尺寸、角度或删除对象。
5. 设置地面/墙柱颜色；可上传正对地面的材质近照，并设定一块贴图对应的实际宽度。关闭「显示 CAD / 图片地面底图」可看完整材质。普通透视场景照片作为外观参考，不能直接当成准确平面图。
6. 点击「保存完整项目」或工具栏「保存」，环境、参考照片、材质与标注一起保存到项目 JSON。旧项目仍可载入，不含环境时使用默认场景。

操作：拖动旋转、滚轮缩放、右键平移；放置墙柱时暂停视角控制，按 Esc 取消。「适合视图」重置视角；「导出 3D 图片」导出当前三维视角，工具栏「摊位图 → 全图」在三维模式下也会导出三维画面。

**在网页内用现有订阅生成环境**：工具通过本地服务调用已使用 ChatGPT 登录的 Codex CLI，使用该账号现有的 Codex 套餐额度。网页上传照片、生成、预览、输入修改意见和应用结果均在同一界面完成，无需在对话里另行生成文件，也不需要 API Key。此路径遵循账号的套餐用量限制；不会改用 API Key，也不会由工具自动购买额度。[官方 CLI 调用说明](https://learn.chatgpt.com/docs/developer-commands)、[订阅用量说明](https://learn.chatgpt.com/docs/pricing)。

本机需要已安装 Codex CLI，并通过 **ChatGPT 登录**。如果已经登录，直接启动服务：

```bash
codex login status
# 若尚未登录：codex login，并选择 ChatGPT 登录
node environment-server.mjs
```

服务监听 `127.0.0.1:3003`。网页的「检查连接」应显示已连接 Codex / ChatGPT 订阅。API Key 登录会被拒绝，不会悄悄回退到另付费接口。找不到 Codex 时可通过 `NEEDFLEA_CODEX_BIN` 指定官方 CLI 的完整路径。服务使用只读、临时会话，在隔离临时目录中传入图片及 JSON 输出约束；凭据由 Codex 自行管理，工具不读取或复制登录 token，临时图片和结果在请求结束后清理。

使用流程：

1. 导入底图、设定比例尺，上传场地照片并填写对应位置、拍摄方向和实测记录。
   每张照片下点击「在图上标注」会切到二维底图：先点拍摄位置，再点镜头看向的位置。移动鼠标预览方向，滚轮缩放、Alt 拖动平移；Esc、右键或「取消标注」保留原标记。完成后恢复原视图，P1/P2 编号、位置和箭头在二维/三维图中对应照片。可「重新标注」或「清除位置」，不会改变摊位。
2. 点击「从照片生成环境」。本机 Codex 会分析照片实际图像、俯视底图、CAD 几何及场地说明，返回墙柱/台面、颜色和地面纹理参数。
3. 三维视图先显示预览。可以在「补充要求 / 修改意见」输入如“柱高按实测 4.2 米，保留其他结构”，再点击「按修改意见重新生成」，继续修改当前预览。
4. 点击「应用此环境」才替换原环境，或点击「放弃预览」返回原场景。摊位位置保留；生成中的请求可取消，失败或额度不足不会覆盖已保存的环境。
5. 应用后可以手动精调并保存完整项目。生成材质默认隐藏 CAD 地面覆盖图，可自行重新显示底图。

生成时面板显示真实阶段、已用时间、最近一次状态更新时间及阶段记录。进度通过本地流式连接传回，来自 Codex 的会话/任务/输出事件；服务心跳只用于判断连接状态，不代表模型取得新进展。模型没有提供可靠完成百分比，因此不显示估算百分比。超过 30 秒无新状态时会提示仍在等待响应或连接可能中断；任务最长 4 分钟，可主动取消。刷新页面会中断当前请求，新进度界面需在保存项目并刷新后开始的请求中使用。

生成的是可编辑的参数化简模，不是摄影测量网格。未知尺寸标记为估计；面板列出识别依据、假设和待确认问题，不能定位到 CAD 的结构应列为待确认。照片决定颜色和材质类型，地面纹理由参数生成，真实场地还原效果需要对照照片、定位说明与实测尺寸核实。每次重新生成会使用现有套餐额度，是否可用取决于账号/工作区权限及剩余额度。

本地服务只接受回环地址页面访问。GitHub Pages 纯静态线上页面无法直接使用本机服务；此方案适用于本地运行的工具。也保留「导出建模资料 / 导入环境 JSON」供手动交换资料。

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

照片可选 `camera: {x,y,targetX,targetY}`：位置与朝向参考点均使用 CAD 世界坐标，连线只表示平面朝向，不表示测量距离或照片里某个物体的精确位置。图纸右侧为 0°、上方为 90°。这些数据随项目保存，并连同照片传给 Codex；楼层、拍摄高度、俯仰角仍需在文字说明中补充，不由平面箭头推断。

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
| DXF (ASCII) | ✅ 完整 | R12/R14/2000~2018 |
| DWG + ODA | ✅ 完整 | AC1015~AC1032，需 dwg-server |
| DWG (仅浏览器) | ⚠️ 部分 | libdxfrw WASM，部分版本/文件可能失败 |

### 已知限制

- DXF 解析器不支持嵌套 INSERT 块的递归展开（如电梯符号）
- DIMENSION 实体的文字渲染不完整
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

照片生成集成测试使用本地模拟 Codex，验证实际图片/底图传递、网页内修改意见、预览/应用/放弃、来源和估计记录、取消、订阅额度不足、登录/API Key 拒绝及非本地访问处理，不消耗模型额度。

```bash
# 验证 CLI 参数、图片附件、结构化输出和临时目录清理（不调用模型）
node scripts/check-codex-environment.mjs
# 可选：已通过 ChatGPT 登录后，用合成参考图做一次真实订阅连通测试
# 此项会消耗现有 Codex 套餐额度
node scripts/check-codex-environment.mjs --live
```

真实连通测试只验证订阅登录、图片输入和结构化输出，不代表真实场地识别精度；后者需用现场照片验证。
