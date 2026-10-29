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
- `toolbar.js` / `toolbar.css`：顶部四个功能分组与响应式布局，保留原控件 ID / 内联事件。切换分组不得调用 setTool 或重置参数；setTool 通过 `needflea-tool-changed` 事件同步分组与当前工具提示。保存、统一场景搭建入口及选择工具保持可见；选择场地放在场地与文件分组，二维 / 三维切换放在场景侧栏，不恢复独立 3D 顶部按钮。改动后运行 `node scripts/check-toolbar.mjs` 并查看桌面 / 窄屏截图。
- `app.js`：主控制器，负责导入、交互、图层、比例尺、保存/载入、自动保存和导出。
- `site-library.js` / `site-library.css`：浏览器本地场地 / 多活动库。通过 `window.projectIO.capture/load/setSite` 复用项目逻辑；IndexedDB `needflea-site-library` v2 的 `sites` / `projects` 保存场地元数据 / 不含摊位的基础，`activities` / `activityProjects` 保存按 siteId 归属的活动元数据 / 独立完整项目。相关写入同事务提交。不要把完整 CAD / 照片塞进 localStorage。
- `dxf-parser.js`：ASCII DXF 解析器，定义 `DXFParser`。
- `renderer.js`：`DXFRenderer`，负责视口、CAD/SVG/图片底图渲染与坐标转换。
- `booth.js`：`BoothSystem`，负责标注、摊位几何、样式、颜色及 DXF 导出。
- `iso-renderer.js`：`IsoRenderer`，负责等轴测预览。
- `dwg-server.mjs`：可选的本地 HTTP 转换服务，调用 ODA File Converter 将 DWG 转成 DXF。
- `libdxfrw.js` / `libdxfrw.wasm`：浏览器使用的第三方 WASM 解析器；其他 `libredwg*` 文件用于相关转换实验。不要直接编辑生成的第三方代码或二进制。
- `render-project-json.mjs`：基于 v3 项目 JSON 的独立渲染参考，依赖 `sharp`。
- `preview.js`、`test-render*.js`、本机 `test-*.mjs`：渲染实验与人工验证脚本，不是统一测试套件。

浏览器脚本是经典脚本而非 ES modules，按以下顺序加载：
`libdxfrw.js` → `cad-text.js` → `dxf-parser.js` → `renderer.js` → `booth.js` → `iso-renderer.js` → `app.js`。
保留全局类、页面内联事件调用的 `window` 入口及加载顺序；不要直接套用模块化构建工具。

新增场地环境功能是局部例外：`environment.js` 在 `app.js` 后以 ES module 加载，通过动态导入 `scene-three.js` 使用 Three.js；`index.html` 的 import map 指向 `vendor/three/` 的固定版本。不要将现有经典 CAD 主脚本全部迁移为模块。`environment.css` 提供环境面板样式及工具栏溢出处理。

`environment` 为项目 v3 的可选字段，schema 为 `needflea-environment/1`。对象中心 x/y 使用 CAD 世界坐标，尺寸 width/depth/height 使用米，角度为 CAD 平面逆时针角度；对象类型和归属见下文场景搭建约定。参考照片、地面材质内嵌于完整项目，不放入原有 localStorage 自动保存。不要把照片估计值当作实测值。保留对象的 estimated/source 和 analysis 中的假设与待确认问题；floorPattern/floorTileMeters 用于参数化地面纹理。

照片的可选 camera 字段含 x/y 拍摄点、targetX/targetY 朝向参考点，均为 CAD 世界坐标；方向只表示平面方位，不代表距离、楼层、拍摄高度或俯仰角。每张照片在二维底图两次点击标注，P 编号和箭头也显示在三维视图；退出/取消重标不得覆盖原位置或改变摊位。位置需在项目保存及导入导出中完整保留。

以下是保留的历史路径，当前网页不再提供此入口：`environment-server.mjs` 是本地照片分析服务，监听 127.0.0.1:3003；`codex-environment-runner.mjs` 调用本机官方 Codex CLI，只接受 ChatGPT 订阅登录。拒绝 API Key 登录，清除子进程的 API Key/接口覆盖环境，使用 forced_login_method="chatgpt"，不得回退到另付费 API。通过 stdin 传递结构化场地资料、通过 --image 传入真实照片；使用只读、临时会话和隔离临时目录，不使用项目目录作为模型工作目录，不复制登录 token，完成后清理临时图片。历史版本支持网页输入修改意见后再生成；当前面板已移除此工作流。`environment-ai-contract.mjs` 校验浏览器与服务的输入输出。生成前后保留原环境，应用后保存。


## 安装与启动

场景搭建工作流为 CAD / 图片 / 实测建立二维场地 → 结构高度 → 活动组件 → 展示出图。Marble 相关服务、生成 UI 和 Spark 渲染已按用户要求移除，不再连接 3004。不要恢复付费生成路径。旧资源字段不再使用，仓库外历史资源和密钥配置不清理。

`environment.sitePlan` 为 `needflea-site-plan/1`，保存至少三个点的非自交多边形，仅在无 cadFile 时作为米制场地（metersPerUnit=1）。二维轮廓及三维地面须一致，场地边界不得随摊位范围变化。固定结构 wall/column/platform/building/tree 与活动组件 stage/truss/counter/sign/table/fence 分开；对象 elevation 为米。场地基础过滤活动组件并清除机位，活动备份保留全部数据。`environment.views` 保存相机参数，出图不得改动布局；旧项目应清除前一个场地的实测边界和机位。

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
- 摊位新建与载入的 height 统一为 2.5 米（帐篷含屋顶总高），空地不生成立体体块；二维与三维必须共用 placeLayoutItem 的尺寸、吸附和避让逻辑。活动组件右键点击删除，三维右键拖动不得误删；射线区分摊位与环境 ID。相关回归运行 `node scripts/check-layout-components.mjs`。
- 摊位位置/尺寸使用 `wx`、`wy`、`ww`、`wh`，旋转 `angle` 为绕中心的角度。修改几何时对照 `BoothSystem` 的实现，保持命中检测、吸附、2D、等轴测和导出一致。
- 颜色优先通过 `booths.catColor(cat)` 读取，保留未知分类的兜底，避免载入不同分类的项目后崩溃。
- 保存格式为 `version: 3`，含 `cadFile`、`categories`、`items`、比例尺、视口、图层及 `venue`；保持现有项目的载入兼容。
- 可选 `site: {name,eventName}` 为可移植场地名称 / 活动备注。浏览器内部记录 ID 不随项目导出，外部 JSON 载入不能静默绑定或覆盖已有场地。切换仅显式载入、更新仅显式保存；有未保存改动先提示。无底图 / 比例尺的旧项目必须清除前一场地的背景和单位；加载或存储失败恢复原画布，不留半条场地记录。
- 场地库 v1 升级至 v2 在升级事务中复制旧完整布局为首个活动，并另建空摊位的场地基础；失败必须回滚旧库。活动更新不能改变其他活动或场地基础，基础更新不能覆盖已有活动。活动名称仅在同一场地内去重。活动导入无底图 JSON 时继承明确选中的场地基础，此规则只适用于活动创建，不改变通用项目载入的清理规则。活动导出须自包含 CAD / 环境 / 布局；场地基础导出不声称包含全部活动。
- `venue.schema` 为 `needflea-venue/1`，携带归一化几何、图层、边界及 SVG 快照。图片场景中 `venue` 为 `null`，底图由带 `isImage` 的 `cadFile` 保存。
- `localStorage` 的 `needflea_autosave` 每 30 秒保存标注等部分状态，不包含完整 CAD 底图；完整备份使用项目 JSON。人工验证宜用独立浏览器上下文，避免影响已有自动保存。
- `index.html` 中部分脚本有 `?v=` 缓存版本号；修改浏览器脚本并准备发布时检查对应引用。
- `.gitignore` 忽略 `node_modules/`、`test-*.png`、`test-*.svg`、`test-*.mjs`；部分旧测试图片已被跟踪。提交前检查新增测试是否被忽略，不把本机样本、截图或临时产物混入变更。

## 验证方式

CAD 导入 / 文字 / 块变更运行 `node scripts/check-cad-import.mjs`（3002 静态服务）。`cad-text.js` 共享 GBK / Unicode / CAD 转义处理、MTEXT 正文及换行和文字布局；不能把真实 Unicode 截断为低字节，不能删掉格式括号内正文或统一放大小字。DXFParser 输出递归展开后的世界坐标叶实体，保留 sourceLayers 父层可见性链；textTransform 保留块变换后的文字基向量。OCS / elevation 必须在块变换前处理，图层初始状态遵循 off / frozen，用户开关可覆盖。normalized venue 的文字可携带可选 textTransform / widthScale / textWidth / attachment / hAlign / vAlign / textGen / lineSpacing，原 v3 结构保持兼容。可选 NEEDFLEA_DWG_FILE 指向演艺中心真实样本，依赖 ODA 本地服务，样本不得入库。

场地库或共享项目 I/O 改动运行 `node scripts/check-site-library.mjs`（3002 静态服务），覆盖 v1 升级迁移、多活动隔离、JSON / 空布局 / 当前画布创建、基础与活动独立更新、刷新载入、未保存取消、无底图继承、无效导入、事务失败恢复、活动备份与移动端排版。DWG 无样本时须明确未验证。共享保存载入改动同时运行环境、面板和场景工作流回归。

当前无统一测试框架、lint 配置或仓库内 CI 工作流。不要声称 `npm test` 可用，也不要将实验脚本成功当成完整回归通过。

场地环境新增浏览器回归脚本：启动静态服务后运行 `node scripts/check-environment.mjs`（默认端口 3002，可通过 `NEEDFLEA_URL` 更改）。脚本生成隔离的 CAD/图片样本，验证环境放置、尺寸编辑、照片/材质、JSON 导入校验、PNG 导出、保存载入、旧项目和 WebGL 失败回退；输出截图在系统临时目录。涉及三维功能时运行该脚本并检查截图。Three.js 依赖升级后同步 `vendor/three/` 文件和 MIT 许可证，见其 README。

场景工作流改动运行 `node scripts/check-photo-generation.mjs`（历史文件名；现检查实测边界、固定 / 活动组件、机位、保存恢复、无旧生成服务及移动端）。保留旧服务改动运行 `node scripts/check-codex-environment.mjs`，仅检查 CLI 隔离与清理，不代表网页仍提供该入口。


- 只改文档时检查内容、命令与代码是否一致，并运行 `git diff --check`。
- 修改 JavaScript 时可对相关文件运行 `node --check <文件>`；语法检查不能替代浏览器验证。
- UI/渲染变更：启动静态服务，按变更范围验证导入 DXF/图片、缩放/平移、比例尺、放置/选中/旋转摊位、分类兜底、图层、2D/等轴测、保存后载入及相关导出；查看控制台错误和输出图片。
- 涉及 DWG 时，另行验证浏览器解析和 ODA 回退；需可用 DWG 样本及转换器。
- 独立 JSON 渲染验证：`node render-project-json.mjs /path/to/project-v3.json /tmp/needflea-project.png`。需含 `venue` 的有效项目及已安装的 `sharp`；这是参考消费者，当前主要重建 CAD 几何和摊位，不能代表全部标注/样式的渲染覆盖。
- 本机存在但未被 Git 跟踪的 `test-venue-export.mjs` 可这样运行：`node test-venue-export.mjs /path/to/project.json /tmp/venue-test-v3.json`。需 3000 静态服务、Puppeteer 浏览器；DWG 可能还需 ODA 服务。随后可用上述独立渲染命令检查输出。该脚本不保证新克隆中存在。
- `test-render.js`、`test-render2.js` 以及本机其他转换实验含硬编码的个人桌面 CAD 路径，并可能覆盖已有输出；运行前检查输入和输出。仓库不提供通用 CAD 测试样本。
- 汇报时区分实际执行的检查、人工验证及缺少样本/环境而未执行的部分。

## 当前开发状态与已知限制

- 建场入口集中在「场地与文件 → 建立 / 编辑场地」，包含 CAD / 图片 / 实测及唯一的比例尺控件。场景搭建侧栏只提供结构高度、展示出图两个标签；活动布置统一在「摊位与设施 → 活动组件」子标签，并可返回编辑场地。未校准时先引导建场。入口共用同一侧栏与原始 file-input 导入处理，不能再复制导入和比例尺控件；切换入口不应清空现有布局或绘图。照片作为实测参考继续保留；当前提供参数化组件，未接精细模型导入。原 CAD 主脚本保持经典全局脚本，Three.js 按需加载。

- 本次整理前 Git 工作区干净。最近业务提交 `10d9931` 增加复合摊位（盘扣架/帐篷＋空地）、邻近吸附时的支架角位、分类颜色兜底及自包含项目 JSON；后续提交主要更新域名与 README。
- README 记录 GitHub Pages 静态部署，`CNAME` 指向 `booth-planner.pbrick.cn`。线上是否可达不由本地文件保证；不要为普通开发任务改动域名或部署配置。
- README 列出的已知限制：动态块 / 外部参照、缺失匿名块的 DIMENSION、复杂 HATCH 与 CAD 专用字体仍可能显示不完整；WASM 对部分 DWG 版本/文件可能解析失败。遇到兼容性问题时先确认所走解析路径与样本，不假设所有 CAD 实体都受支持。
