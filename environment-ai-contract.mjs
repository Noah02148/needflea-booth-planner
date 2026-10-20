// Shared data contract for the local Codex bridge and browser.
const text = { type: 'string' };
const numeric = { type: 'number' };
const objectSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['wall', 'column', 'platform'] }, name: text,
    x: numeric, y: numeric, width: numeric, depth: numeric, height: numeric, angle: numeric,
    color: text, estimated: { type: 'boolean' }, source: text,
  },
  required: ['type', 'name', 'x', 'y', 'width', 'depth', 'height', 'angle', 'color', 'estimated', 'source'],
};
export const proposalSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: text,
    floorColor: text, wallColor: text,
    floorPattern: { type: 'string', enum: ['plain', 'tile', 'wood', 'concrete'] },
    floorTileMeters: numeric,
    objects: { type: 'array', items: objectSchema },
    observations: { type: 'array', items: text }, assumptions: { type: 'array', items: text }, questions: { type: 'array', items: text },
  },
  required: ['summary', 'floorColor', 'wallColor', 'floorPattern', 'floorTileMeters', 'objects', 'observations', 'assumptions', 'questions'],
};
const color = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
function finite(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}超出有效范围`);
  return value;
}
function short(value, max = 2000) {
  if (typeof value !== 'string' || value.length > max) throw new Error('模型返回的文字格式无效');
  return value;
}
export function validateProposal(value, bounds) {
  if (!value || !color(value.floorColor) || !color(value.wallColor)) throw new Error('模型返回的场地颜色无效');
  if (!['plain', 'tile', 'wood', 'concrete'].includes(value.floorPattern)) throw new Error('模型返回的地面材质无效');
  const result = { summary: short(value.summary), floorColor: value.floorColor, wallColor: value.wallColor, floorPattern: value.floorPattern, floorTileMeters: finite(value.floorTileMeters, 0.1, 20, '地面纹理尺寸'), objects: [] };
  if (!Array.isArray(value.objects) || value.objects.length > 200) throw new Error('模型返回的环境对象最多 200 项');
  result.objects = value.objects.map((o, i) => {
    if (!o || !['wall', 'column', 'platform'].includes(o.type) || !color(o.color) || typeof o.estimated !== 'boolean') throw new Error('模型返回的环境对象格式无效');
    return { id: i + 1, type: o.type, name: short(o.name, 100), x: finite(o.x, bounds.minX, bounds.maxX, '中心 X'), y: finite(o.y, bounds.minY, bounds.maxY, '中心 Y'), width: finite(o.width, 0.01, 1000, '宽度'), depth: finite(o.depth, 0.01, 1000, '深度'), height: finite(o.height, 0.01, 100, '高度'), angle: finite(o.angle, -360, 360, '角度'), color: o.color, estimated: o.estimated, source: short(o.source) };
  });
  for (const key of ['observations', 'assumptions', 'questions']) {
    if (!Array.isArray(value[key]) || value[key].length > 50) throw new Error('模型返回的说明列表无效');
    result[key] = value[key].map(v => short(v));
  }
  return result;
}

export function validateAnalysisInput(body) {
  if (!body || !body.bounds || !Array.isArray(body.photos) || body.photos.length < 1 || body.photos.length > 12) throw new Error('请上传 1～12 张实景照片');
  const image = data => typeof data === 'string' && data.length < 4000000 && /^data:image\/(jpeg|png|webp);base64,[a-z\d+/=]+$/i.test(data);
  const bounds = Object.fromEntries(['minX', 'minY', 'maxX', 'maxY'].map(key => [key, finite(body.bounds[key], -1e12, 1e12, '场地边界')]));
  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) throw new Error('场地边界无效');
  const mpu = finite(body.metersPerUnit, 1e-9, 1e6, '比例尺');
  const photos = body.photos.map(p => {
    if (!p || !image(p.dataUrl)) throw new Error('实景照片格式无效');
    let camera;
    if (p.camera != null) {
      camera = Object.fromEntries(['x', 'y', 'targetX', 'targetY'].map(key => [key, finite(p.camera[key], -1e12, 1e12, '拍摄坐标')]));
      if (Math.hypot(camera.targetX - camera.x, camera.targetY - camera.y) < 1e-9) throw new Error('拍摄方向不能与拍摄位置重合');
      camera.angle = (Math.atan2(camera.targetY - camera.y, camera.targetX - camera.x) * 180 / Math.PI + 360) % 360;
    }
    return { name: short(p.name, 200), note: short(p.note, 2000), dataUrl: p.dataUrl, ...(camera ? { camera } : {}) };
  });
  if (!image(body.planImage)) throw new Error('请先导入场地底图');
  if (!Array.isArray(body.cadEntities) || body.cadEntities.length > 1500) throw new Error('CAD 几何输入超出上限');
  // Whitelist finite numeric geometry; never forward arbitrary project fields.
  const cadEntities = body.cadEntities.map(e => {
    if (!e || !['line', 'polyline', 'circle', 'arc', 'text'].includes(e.type)) throw new Error('CAD 几何类型无效');
    const out = { type: e.type, layer: short(String(e.layer || ''), 200) };
    for (const key of ['x1','y1','x2','y2','cx','cy','r','x','y','height','angle','startAngle','endAngle']) if (e[key] !== undefined) out[key] = finite(e[key], -1e12, 1e12, 'CAD 坐标');
    if (e.text !== undefined) out.text = short(e.text, 500);
    if (e.points !== undefined) {
      if (!Array.isArray(e.points) || e.points.length > 100) throw new Error('CAD 折线过长');
      out.points = e.points.map(p => {
        if (!Array.isArray(p) || p.length !== 2) throw new Error('CAD 折线坐标无效');
        return p.map(v => finite(v, -1e12, 1e12, 'CAD 坐标'));
      });
      out.closed = !!e.closed;
    }
    return out;
  });
  const currentEnvironment = body.currentEnvironment == null ? null : validateProposal({ summary: '当前环境', observations: [], assumptions: [], questions: [], ...body.currentEnvironment }, bounds);
  return { bounds, metersPerUnit: mpu, notes: short(body.notes || '', 10000), instruction: short(body.instruction || '', 4000), currentEnvironment, photos, planImage: body.planImage, cadEntities };
}
