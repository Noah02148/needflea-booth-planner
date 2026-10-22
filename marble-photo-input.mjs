import sharp from 'sharp';

// Preserve camera perspective and the entire image: resize proportionally, then
// pad to a common canvas. Never stretch or silently crop walls and columns.
export async function prepareMarblePhotos(input, onProgress = () => {}) {
  const decoded = [];
  for (const [i, photo] of input.photos.entries()) {
    onProgress({ stage: 'preparing', message: `正在检查照片 ${i + 1}/${input.photos.length}` });
    const buffer = Buffer.from(photo.dataUrl.split(',')[1], 'base64');
    let meta;
    try { meta = await sharp(buffer, { limitInputPixels: 40000000 }).metadata(); }
    catch { throw new Error(`第 ${i + 1} 张照片无法解码，请重新上传有效图片`); }
    const swapped = meta.orientation >= 5 && meta.orientation <= 8;
    decoded.push({ buffer, width: swapped ? meta.height : meta.width, height: swapped ? meta.width : meta.height });
  }
  if (input.mode === 'pano' && decoded.some(p => p.width !== p.height * 2)) throw new Error('完整 360° 全景必须是 2:1 图片，普通横向全景不适用');
  const mismatch = decoded.some(p => p.width !== decoded[0].width || p.height !== decoded[0].height);
  if (input.mode !== 'reconstruct' || !mismatch) {
    onProgress({ stage: 'preparing', message: `${decoded.length} 张照片已检查，尺寸可用` });
    return { input, preparation: { normalized: false, width: decoded[0].width, height: decoded[0].height } };
  }
  const ratios = decoded.map(p => p.width / p.height).sort((a, b) => a - b);
  const ratio = ratios[Math.floor(ratios.length / 2)];
  const edge = Math.min(2048, Math.max(...decoded.map(p => Math.max(p.width, p.height))));
  const width = Math.max(2, Math.round((ratio >= 1 ? edge : edge * ratio) / 2) * 2);
  const height = Math.max(2, Math.round((ratio >= 1 ? edge / ratio : edge) / 2) * 2);
  const photos = [];
  for (const [i, photo] of input.photos.entries()) {
    onProgress({ stage: 'preparing', message: `正在统一照片 ${i + 1}/${decoded.length} 为 ${width} × ${height}，等比缩放并补边` });
    const jpeg = await sharp(decoded[i].buffer, { limitInputPixels: 40000000 }).rotate()
      .resize(width, height, { fit: 'contain', background: '#202020' }).flatten({ background: '#202020' }).jpeg({ quality: 90 }).toBuffer();
    photos.push({ ...photo, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` });
  }
  onProgress({ stage: 'preparing', message: `${photos.length} 张照片已统一为 ${width} × ${height}，原照片与拍摄标注保留` });
  return { input: { ...input, photos, photoPadding: true }, preparation: { normalized: true, width, height } };
}
