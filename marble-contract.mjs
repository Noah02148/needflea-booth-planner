// Pure contract shared by the webpage, local service and regression checks.
export const marbleModels = ['marble-1.0-draft', 'marble-1.1', 'marble-1.1-plus'];
const finite = (v, min, max, label) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${label}无效`);
  return v;
};
export function assetURL(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('场景资源地址无效');
  const u = new URL(value);
  if (u.username || u.password || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) throw new Error('场景资源必须使用 HTTPS 或本地服务');
  return u.href;
}
export function validateMarbleAsset(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Marble 场景无效');
  const urls = {};
  for (const key of ['100k', '500k', 'full_res']) if (value.spzUrls?.[key]) urls[key] = assetURL(value.spzUrls[key]);
  if (!Object.keys(urls).length) throw new Error('Marble 场景缺少 SPZ 资源');
  const resolution = value.resolution || (urls['500k'] ? '500k' : Object.keys(urls)[0]);
  if (!urls[resolution]) throw new Error('Marble 场景精度无效');
  const t = value.transform || {};
  return {
    worldId: String(value.worldId || '').slice(0, 200), model: String(value.model || '').slice(0, 80),
    spzUrls: urls, resolution, visible: value.visible !== false,
    colliderUrl: value.colliderUrl ? assetURL(value.colliderUrl) : null,
    metricScale: finite(value.metricScale ?? 1, 0.000001, 1000000, '场景米制比例'),
    groundOffset: finite(value.groundOffset ?? 0, -1000000, 1000000, '场景地面偏移'),
    transform: { x: finite(t.x ?? 0, -1e12, 1e12, '场景 CAD X'), y: finite(t.y ?? 0, -1e12, 1e12, '场景 CAD Y'), height: finite(t.height ?? 0, -10000, 10000, '场景高度'), angle: finite(t.angle ?? 0, -360, 360, '场景旋转'), scale: finite(t.scale ?? 1, 0.0001, 10000, '场景校准比例') },
    costCredits: value.costCredits == null ? null : finite(value.costCredits, 0, 1000000, '生成费用'),
  };
}
export function validateMarbleInput(value) {
  if (!value || !marbleModels.includes(value.model)) throw new Error('请选择有效的 Marble 模型');
  if (!['reconstruct', 'directions', 'pano'].includes(value.mode)) throw new Error('请选择照片输入方式');
  const max = value.mode === 'pano' ? 1 : value.mode === 'directions' ? 4 : 8;
  if (!Array.isArray(value.photos) || !value.photos.length || value.photos.length > max) throw new Error(`此输入方式需要 1～${max} 张照片`);
  if (!/^[a-f\d-]{36}$/i.test(value.requestId || '')) throw new Error('生成请求编号无效');
  const photos = value.photos.map(p => {
    const match = typeof p?.dataUrl === 'string' && p.dataUrl.length <= 10000000 && p.dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([a-z\d+/]+={0,2})$/i);
    if (!match) throw new Error('照片格式无效，请使用 JPG、PNG 或 WebP');
    let camera;
    if (p.camera) {
      camera = Object.fromEntries(['x', 'y', 'targetX', 'targetY'].map(k => [k, finite(p.camera[k], -1e12, 1e12, '拍摄坐标')]));
      if (Math.hypot(camera.x - camera.targetX, camera.y - camera.targetY) < 1e-9) throw new Error('照片朝向无效');
    }
    return { name: String(p.name || '').slice(0, 200), note: String(p.note || '').slice(0, 1000), dataUrl: p.dataUrl, ...(camera ? { camera } : {}) };
  });
  return { requestId: value.requestId, model: value.model, mode: value.mode, photos, notes: String(value.notes || '').slice(0, 6000), instruction: String(value.instruction || '').slice(0, 4000) };
}
export function estimateMarbleCost(model, mode, count) {
  const pano = mode === 'pano' ? 0 : count === 1 ? 80 : 100;
  const min = (model === 'marble-1.0-draft' ? 150 : 1500) + pano;
  return { min, max: min + (model === 'marble-1.1-plus' ? 1500 : 0) };
}
export function buildMarbleRequest(input) {
  const content = p => ({ source: 'data_base64', data_base64: p.dataUrl.split(',')[1], extension: p.dataUrl.startsWith('data:image/jpeg') ? 'jpg' : p.dataUrl.split('/')[1].split(';')[0] });
  const text = [
    'Recreate the existing venue architecture and materials shown in the photos. Preserve visible columns, walls, stairs and openings. Do not add market booths or people. Unseen areas are uncertain; this is visual reference, not a measured CAD reconstruction.',
    input.photoPadding ? 'Photos were proportionally resized and padded to a common canvas. Ignore the flat dark padding borders; they are not walls, floors or scene content.' : '',
    input.notes, input.instruction,
    ...input.photos.map((p, i) => `Photo ${i + 1}: ${p.note}`),
  ].filter(Boolean).join('\n');
  let world_prompt;
  if (input.mode === 'pano' || input.photos.length === 1) {
    world_prompt = { type: 'image', image_prompt: content(input.photos[0]), is_pano: input.mode === 'pano', text_prompt: text };
  } else {
    const reference = input.photos.find(p => p.camera)?.camera;
    const heading = c => Math.atan2(c.targetY - c.y, c.targetX - c.x) * 180 / Math.PI;
    world_prompt = { type: 'multi-image', reconstruct_images: input.mode === 'reconstruct', text_prompt: text,
      multi_image_prompt: input.photos.map(p => ({ content: content(p), ...(input.mode === 'directions' && p.camera && reference ? { azimuth: ((heading(reference) - heading(p.camera)) % 360 + 360) % 360 } : {}) })) };
  }
  return { display_name: 'NEEDFLEA 场地环境', model: input.model, permission: { public: false }, world_prompt };
}
// Horizontal similarity fit: metric Three.js (x, -z) -> CAD metres.
export function solveMarbleAlignment(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 2 || pairs.length > 20) throw new Error('至少选择两组对应点，建议三组以上');
  for (const p of pairs) for (const k of ['sourceX', 'sourceY', 'targetX', 'targetY']) finite(p[k], -1e12, 1e12, '对应点');
  const mean = k => pairs.reduce((s, p) => s + p[k], 0) / pairs.length;
  const sx = mean('sourceX'), sy = mean('sourceY'), tx = mean('targetX'), ty = mean('targetY');
  let a = 0, b = 0, denominator = 0;
  for (const p of pairs) { const x = p.sourceX - sx, y = p.sourceY - sy, u = p.targetX - tx, v = p.targetY - ty; a += x * u + y * v; b += x * v - y * u; denominator += x * x + y * y; }
  if (denominator < 1e-8) throw new Error('场景对应点距离过近，请重新选择');
  const c = a / denominator, s = b / denominator, scale = Math.hypot(c, s);
  finite(scale, 0.0001, 10000, '校准比例');
  const x = tx - c * sx + s * sy, y = ty - s * sx - c * sy;
  const residual = Math.sqrt(pairs.reduce((sum, p) => sum + (c * p.sourceX - s * p.sourceY + x - p.targetX) ** 2 + (s * p.sourceX + c * p.sourceY + y - p.targetY) ** 2, 0) / pairs.length);
  return { x, y, angle: Math.atan2(s, c) * 180 / Math.PI, scale, residual };
}
