// CAD text is encoded independently from the file's byte encoding.
// Shared by the ASCII DXF parser and the libdxfrw DWG/SVG path.
const CADText = (() => {
  const codepages = { 1: 'shift_jis', 2: 'big5', 3: 'euc-kr', 5: 'gbk' };
  function decode(value, legacyBytes = false) {
    let s = String(value || '').replace(/\0/g, '');
    // libdxfrw can expose legacy bytes as Latin-1. Never truncate real Unicode.
    if (legacyBytes) s = s.replace(/[\x80-\xff]+/g, run => {
      if (run.length < 2 || run.length % 2) return run;
      try { return new TextDecoder('gbk', { fatal: true }).decode(Uint8Array.from(run, c => c.charCodeAt(0))); }
      catch { return run; }
    });
    return s.replace(/\\M\+([1235])([0-9a-f]{4})/gi, (raw, page, hex) => {
      try { return new TextDecoder(codepages[page], { fatal: true }).decode(Uint8Array.of(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2), 16))); }
      catch { return raw; }
    }).replace(/\\U\+([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/%%d/gi, '°').replace(/%%p/gi, '±').replace(/%%c/gi, '⌀');
  }
  function plain(value) {
    // Scan formatting rather than deleting {...}: braces group visible content.
    const s = decode(value);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '{' || ch === '}') continue;
      if (ch !== '\\') { out += ch; continue; }
      const code = s[++i];
      if (code === undefined) break;
      if (['\\', '{', '}'].includes(code)) { out += code; continue; }
      if (code === 'P' || code === 'X') { out += '\n'; continue; }
      if (code === '~') { out += '\u00a0'; continue; }
      if ('LlOoKk'.includes(code)) continue;
      if ('AaCcFfHhQqTtWwpS'.includes(code)) {
        const end = s.indexOf(';', i + 1);
        if (end >= 0) {
          if (code === 'S') out += s.slice(i + 1, end).replace(/[\^#]/g, '/');
          i = end;
          continue;
        }
      }
      // Preserve unknown/malformed escapes instead of silently dropping text.
      out += '\\' + code;
    }
    return out.replace(/\^J/gi, '\n').replace(/\^I/gi, '\t');
  }
  function readBytes(buffer) {
    const bytes = new Uint8Array(buffer);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch {
      const header = new TextDecoder('windows-1252').decode(bytes.subarray(0, 16384));
      const page = header.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/)?.[1];
      const encoding = { 936: 'gbk', 950: 'big5', 932: 'shift_jis', 949: 'euc-kr', 1252: 'windows-1252' }[page] || 'gbk';
      return new TextDecoder(encoding).decode(bytes);
    }
  }
  function layout(ctx, entity, scale) {
    const size = Math.abs((entity.height || entity.h || 1) * scale);
    const widthScale = entity.widthScale > 0 ? entity.widthScale : 1;
    const font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.font = font;
    const limit = entity.textWidth > 0 ? entity.textWidth * scale / widthScale : Infinity;
    const lines = [];
    for (const paragraph of (entity.text || '').split(/\r?\n/)) {
      let line = '';
      for (const ch of paragraph) {
        if (line && ctx.measureText(line + ch).width > limit) { lines.push(line); line = ''; }
        line += ch;
      }
      lines.push(line);
    }
    const width = Math.max(0, ...lines.map(s => ctx.measureText(s).width))*widthScale;
    const spacing = size * 1.5 * (entity.lineSpacing || 1);
    const height = size + (lines.length-1)*spacing;
    const attachment = entity.attachment || 0;
    const col = attachment ? (attachment-1)%3 : (entity.hAlign === 4 ? 1 : entity.hAlign || 0);
    let x = col === 1 ? -width/2 : col === 2 ? -width : 0;
    let y = 0;
    if (attachment) y = size - Math.floor((attachment-1)/3)*height/2;
    else if (entity.vAlign === 3) y = size;
    else if (entity.vAlign === 2 || entity.hAlign === 4) y = size/2;
    return { size, font, widthScale, lines, x, y, spacing };
  }
  return { decode, plain, readBytes, layout };
})();
window.CADText = CADText;
