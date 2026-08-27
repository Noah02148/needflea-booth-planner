# NEED!FLEA 摊位规划工具

网页端 CAD 查看 + 摊位标注工具，支持 DXF/DWG 格式，本地运行。

## 快速启动

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
# 杀死端口 3000 和 3001 上的进程
lsof -ti :3000 -ti :3001 | xargs kill
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
- **DWG 转换**：[ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)（免费）
- **Node.js 依赖**：puppeteer, sharp, @mlightcad/libredwg-web（`npm install`）
