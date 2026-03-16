# NEED!FLEA 摊位规划工具

网页端 DXF 查看 + 摊位标注工具，无需安装，本地运行。

## 快速启动

```bash
# 方法1：Python（推荐，系统自带）
cd needflea-booth-planner
python3 -m http.server 8080
# 打开浏览器 → http://localhost:8080

# 方法2：Node.js
npx serve .
# 打开浏览器 → http://localhost:3000
```

## 使用流程

1. **导入 DXF** — 拖入文件或点击「导入 DXF」按钮
   - QuickCAD 导出：文件 → 另存为 → DXF 格式
   - 支持 ASCII DXF（R12/R14/2000/2004/2007/2010）

2. **定比例尺**（重要！）— 点击「📐 定比例尺」
   - 在图上点选两个已知距离的点（如走廊两端）
   - 输入真实距离（米）
   - 确认后，所有帐篷尺寸将精确匹配实际大小

3. **标注摊位** — 工具栏选择类型和尺寸，点击放置
   - 颜色点 = 摊位类型（二手/HAOCHI/VINTAGE/原创设计/WORKSHOP）
   - 尺寸下拉 = 帐篷尺寸（3×3m / 2×2m / 4×3m 等）
   - 选中后可在右侧面板修改编号、类型、备注

4. **其他标注**
   - 👮 安保：点击放置安保点位
   - → 动线：拖动画箭头
   - ▭ 功能区：拖动框选，输入名称（DJ music / movie area 等）

5. **导出**
   - PNG：给甲方/团队查看用
   - DXF：回写 CAD，含 NEEDFLEA_BOOTHS / NEEDFLEA_LABELS 等图层，QuickCAD 可直接打开

## 快捷操作

| 操作 | 说明 |
|---|---|
| 滚轮 | 缩放 |
| Alt + 拖动 | 平移视图 |
| 中键拖动 | 平移视图 |
| 双击空白 | 恢复适合视图 |
| 右键元素 | 删除 |

## 文件结构

```
needflea-booth-planner/
├── index.html      # 主界面
├── dxf-parser.js   # DXF 解析（支持 LINE/LWPOLYLINE/CIRCLE/ARC/TEXT 等）
├── renderer.js     # CAD 渲染引擎（带缩放平移）
├── booth.js        # 摊位标注系统 + DXF 导出
├── app.js          # 主控制器
└── README.md
```

## DXF 兼容性

- QuickCAD 导出 → ✅ 完整支持
- AutoCAD DXF R12/R14 → ✅
- AutoCAD DXF 2000+ → ✅
- DWG 格式 → ❌（需先在 CAD 软件另存为 DXF）

## 后续可扩展

- [ ] 帐篷旋转（拖动角点）
- [ ] 保存/载入标注方案（JSON）
- [ ] 批量编号重排
- [ ] 通道宽度标注
- [ ] 打印模式（带图例、活动标题）
