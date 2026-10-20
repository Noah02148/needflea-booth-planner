# Codex 项目约定

## 文档来源与工作范围

- 本文件适用于整个仓库。与用户沟通默认使用中文。
- 依据当前 `README.md`、`package.json`、`package-lock.json`、源码、现有测试脚本及 Git 历史整理。
- 本次整理时，项目中未找到 `CLAUDE.md`；仅有 `.claude/settings.local.json`。保留现有 Claude 配置；如后续提供 `CLAUDE.md`，阅读并协调其项目约定，不删除或覆盖原文。
- `.claude/settings.local.json` 是 Claude Code 的本机工具权限记录，不是 Codex 的授权来源。不要复制其中的机器路径、宽泛命令许可或历史操作作为项目规则。
- 开始修改前查看 `git status --short`，保留用户已有改动；按任务范围修改，避免顺带重构或更新依赖。

## 项目结构与运行模型

NEED!FLEA 摊位规划工具：浏览器端 CAD 查看、场景图导入、摊位与设施标注、2D/等轴测预览和导出。

- 前端是纯 HTML / JavaScript / Canvas，无框架、打包步骤、数据库或业务后端。
- `index.html`：页面、内联样式、事件入口和脚本引用。
- `app.js`：主控制器，负责导入、交互、图层、比例尺、保存/载入、自动保存和导出。
- `dxf-parser.js`：ASCII DXF 解析器，定义 `DXFParser`。
- `renderer.js`：`DXFRenderer`，负责视口、CAD/SVG/图片底图渲染与坐标转换。
- `booth.js`：`BoothSystem`，负责标注、摊位几何、样式、颜色及 DXF 导出。
- `iso-renderer.js`：`IsoRenderer`，负责等轴测预览。
- `dwg-server.mjs`：可选的本地 HTTP 转换服务，调用 ODA File Converter 将 DWG 转成 DXF。
- `libdxfrw.js` / `libdxfrw.wasm`：浏览器使用的第三方 WASM 解析器；其他 `libredwg*` 文件用于相关转换实验。不要直接编辑生成的第三方代码或二进制。
- `render-project-json.mjs`：基于 v3 项目 JSON 的独立渲染参考，依赖 `sharp`。
- `preview.js`、`test-render*.js`、本机 `test-*.mjs`：渲染实验与人工验证脚本，不是统一测试套件。

浏览器脚本是经典脚本而非 ES modules，按以下顺序加载：
`libdxfrw.js` → `dxf-parser.js` → `renderer.js` → `booth.js` → `iso-renderer.js` → `app.js`。
保留全局类、页面内联事件调用的 `window` 入口及加载顺序；不要直接套用模块化构建工具。

新增场地环境功能是局部例外：`environment.js` 在 `app.js` 后加载，通过动态导入 `scene-three.js` 使用 Three.js ES modules；`index.html` 的 import map 指向 `vendor/three/` 的固定版本。不要将现有经典脚本全部迁移为模块。`environment.css` 提供环境面板样式及工具栏溢出处理。

`environment` 为项目 v3 的可选字段，schema 为 `needflea-environment/1`。对象中心 x/y 使用 CAD 世界坐标，尺寸 width/depth/height 使用米，角度为 CAD 平面逆时针角度；可用对象类型为 wall/column/platform。参考照片、地面材质内嵌于完整项目，不放入原有 localStorage 自动保存。照片生成由用户点击触发，先渲染预览，再应用或放弃；不要把照片估计值当作实测值。保留对象的 estimated/source 和 analysis 中的假设与待确认问题；floorPattern/floorTileMeters 用于参数化地面纹理。

照片的可选 camera 字段含 x/y 拍摄点、targetX/targetY 朝向参考点，均为 CAD 世界坐标；方向只表示平面方位，不代表距离、楼层、拍摄高度或俯仰角。每张照片在二维底图两次点击标注，P 编号和箭头也显示在三维视图；退出/取消重标不得覆盖原位置或改变摊位。位置需在项目保存、导入导出及生成服务校验中完整保留；生成提示同时传递 camera 与文字说明。

`environment-server.mjs` 是可选本地照片分析服务，监听 127.0.0.1:3003；`codex-environment-runner.mjs` 调用本机官方 Codex CLI，只接受 ChatGPT 订阅登录。拒绝 API Key 登录，清除子进程的 API Key/接口覆盖环境，使用 forced_login_method="chatgpt"，不得回退到另付费 API。通过 stdin 传递结构化场地资料、通过 --image 传入真实照片；使用只读、临时会话和隔离临时目录，不使用项目目录作为模型工作目录，不复制登录 token，完成后清理临时图片。用户在网页输入修改意见后可基于当前预览再生成，消耗当前 Codex 套餐额度。`environment-ai-contract.mjs` 校验浏览器与服务的输入输出。生成前后保留原环境，应用后保存。


## 安装与启动

在仓库根目录执行，前提是已安装 Python 3；转换服务和辅助脚本另需 Node.js / npm。
仓库没有声明 Node.js 版本，也没有 `dev`、`start`、`build`、`test` 或 `lint` npm scripts。

```bash
# 需要 Node 辅助脚本时安装依赖；有锁文件时优先使用 npm ci
npm ci

# 终端一：启动静态页面
python3 -m http.server 3000 --bind 127.0.0.1
```

浏览器访问 `http://localhost:3000`。静态页面使用仓库内的 JS/WASM，单纯使用 DXF/图片功能无需启动 Node 服务，也无需 npm 构建。README 使用 `npm install`，该命令也可安装依赖；不要无故改动锁文件。

DWG 转换需要另一个终端：

```bash
node dwg-server.mjs
```

- 必须先安装 ODA File Converter；代码固定检测 `/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter`。
- 服务固定监听 3001，前端请求 `POST http://localhost:3001/convert`；当前无环境变量配置。
- 转换服务使用 `/tmp/oda-dwg-input` 和 `/tmp/oda-dwg-output`，每次转换会清理其中的文件；不要用于存放其他资料。
- 实际 DWG 导入先尝试浏览器 `libdxfrw`，失败后回退到 ODA 服务。README 的简述不能替代源码中的实际策略。
- 两个终端分别按 `Ctrl+C` 停止自己启动的服务，避免批量终止其他占用端口的进程。

## 编码与数据约定

- 延续现有 JavaScript 风格：两空格缩进、分号、类与普通函数；局部修改遵循相邻代码，不做全文件格式化。
- 界面文案主要为中文，保留现有操作名称和工作流。
- CAD 世界坐标 Y 向上，Canvas/SVG 屏幕坐标 Y 向下。沿用现有坐标转换；真实米数 = 世界单位 × `metersPerUnit`。
- 摊位位置/尺寸使用 `wx`、`wy`、`ww`、`wh`，旋转 `angle` 为绕中心的角度。修改几何时对照 `BoothSystem` 的实现，保持命中检测、吸附、2D、等轴测和导出一致。
- 颜色优先通过 `booths.catColor(cat)` 读取，保留未知分类的兜底，避免载入不同分类的项目后崩溃。
- 保存格式为 `version: 3`，含 `cadFile`、`categories`、`items`、比例尺、视口、图层及 `venue`；保持现有项目的载入兼容。
- `venue.schema` 为 `needflea-venue/1`，携带归一化几何、图层、边界及 SVG 快照。图片场景中 `venue` 为 `null`，底图由带 `isImage` 的 `cadFile` 保存。
- `localStorage` 的 `needflea_autosave` 每 30 秒保存标注等部分状态，不包含完整 CAD 底图；完整备份使用项目 JSON。人工验证宜用独立浏览器上下文，避免影响已有自动保存。
- `index.html` 中部分脚本有 `?v=` 缓存版本号；修改浏览器脚本并准备发布时检查对应引用。
- `.gitignore` 忽略 `node_modules/`、`test-*.png`、`test-*.svg`、`test-*.mjs`；部分旧测试图片已被跟踪。提交前检查新增测试是否被忽略，不把本机样本、截图或临时产物混入变更。

## 验证方式

当前无统一测试框架、lint 配置或仓库内 CI 工作流。不要声称 `npm test` 可用，也不要将实验脚本成功当成完整回归通过。

场地环境新增浏览器回归脚本：启动静态服务后运行 `node scripts/check-environment.mjs`（默认端口 3002，可通过 `NEEDFLEA_URL` 更改）。脚本生成隔离的 CAD/图片样本，验证环境放置、尺寸编辑、照片/材质、JSON 导入校验、PNG 导出、保存载入、旧项目和 WebGL 失败回退；输出截图在系统临时目录。涉及三维功能时运行该脚本并检查截图。Three.js 依赖升级后同步 `vendor/three/` 文件和 MIT 许可证，见其 README。

照片生成改动另运行 `node scripts/check-photo-generation.mjs`（模拟 Codex，不消耗额度）及 `node scripts/check-codex-environment.mjs`（CLI 参数、图片附件、隔离与清理测试）。`node scripts/check-codex-environment.mjs --live` 会使用本机 ChatGPT 登录做一次合成图片真实模型测试，消耗现有套餐额度；仅在用户授权相关模型功能时使用。报告时区分模拟流程验证、真实登录连通测试和现场识别精度。


- 只改文档时检查内容、命令与代码是否一致，并运行 `git diff --check`。
- 修改 JavaScript 时可对相关文件运行 `node --check <文件>`；语法检查不能替代浏览器验证。
- UI/渲染变更：启动静态服务，按变更范围验证导入 DXF/图片、缩放/平移、比例尺、放置/选中/旋转摊位、分类兜底、图层、2D/等轴测、保存后载入及相关导出；查看控制台错误和输出图片。
- 涉及 DWG 时，另行验证浏览器解析和 ODA 回退；需可用 DWG 样本及转换器。
- 独立 JSON 渲染验证：`node render-project-json.mjs /path/to/project-v3.json /tmp/needflea-project.png`。需含 `venue` 的有效项目及已安装的 `sharp`；这是参考消费者，当前主要重建 CAD 几何和摊位，不能代表全部标注/样式的渲染覆盖。
- 本机存在但未被 Git 跟踪的 `test-venue-export.mjs` 可这样运行：`node test-venue-export.mjs /path/to/project.json /tmp/venue-test-v3.json`。需 3000 静态服务、Puppeteer 浏览器；DWG 可能还需 ODA 服务。随后可用上述独立渲染命令检查输出。该脚本不保证新克隆中存在。
- `test-render.js`、`test-render2.js` 以及本机其他转换实验含硬编码的个人桌面 CAD 路径，并可能覆盖已有输出；运行前检查输入和输出。仓库不提供通用 CAD 测试样本。
- 汇报时区分实际执行的检查、人工验证及缺少样本/环境而未执行的部分。

## 当前开发状态与已知限制

- 本次整理前 Git 工作区干净。最近业务提交 `10d9931` 增加复合摊位（盘扣架/帐篷＋空地）、邻近吸附时的支架角位、分类颜色兜底及自包含项目 JSON；后续提交主要更新域名与 README。
- README 记录 GitHub Pages 静态部署，`CNAME` 指向 `booth-planner.pbrick.cn`。线上是否可达不由本地文件保证；不要为普通开发任务改动域名或部署配置。
- README 列出的已知限制：DXF 解析路径的嵌套 INSERT 展开、DIMENSION 文字和复杂 HATCH 渲染存在不足；WASM 对部分 DWG 版本/文件可能解析失败。遇到兼容性问题时先确认所走解析路径与样本，不假设所有 CAD 实体都受支持。
