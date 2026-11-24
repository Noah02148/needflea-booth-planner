import OSS from 'ali-oss';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { emptyLibrary, fail } from './contract.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const MAX = 100 * 1024 * 1024;
// No writable head object: the next numbered commit is conditionally created.
// OSS PutObject does not provide a documented If-Match compare-and-swap.
export function ossStore(client, prefix = 'needflea/library/') {
  if (!/^[a-zA-Z0-9/_-]+\/$/.test(prefix)) throw new Error('OSS_PREFIX 必须是安全的目录前缀，以 / 结尾。');
  const versionKey = revision => `${prefix}commits/${String(revision).padStart(12, '0')}.json`;
  let checked = false;
  async function check() {
    if (checked) return;
    const result = await client.getBucketVersioning(client.options.bucket);
    if (result.versionStatus === 'Enabled' || result.versionStatus === 'Suspended') fail(503, '云端 Bucket 启用了版本控制，请为场地库配置未启用版本控制的专用 Bucket。');
    checked = true;
  }
  async function get(key) {
    try { return (await client.get(key)).content; }
    catch (error) { if (error.code === 'NoSuchKey') return null; throw error; }
  }
  async function putNew(key, content, type = 'application/json') {
    try { await client.put(key, content, { headers: { 'x-oss-forbid-overwrite': 'true', 'x-oss-object-acl': 'private', 'Cache-Control': 'no-store', 'Content-Type': type } }); return true; }
    catch (error) { if (error.code === 'FileAlreadyExists') return false; throw error; }
  }
  async function blob(data) {
    const content = Buffer.from(data), digest = hash(content);
    await putNew(`${prefix}blobs/${digest}.gz`, gzipSync(content), 'application/octet-stream');
    return digest;
  }
  async function readBlob(digest) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail(500, '云端文件引用损坏。');
    const data = await get(`${prefix}blobs/${digest}.gz`);
    if (!data) fail(500, '云端项目文件缺失，请从 JSON 备份恢复。');
    const raw = gunzipSync(data, { maxOutputLength: MAX });
    if (hash(raw) !== digest) fail(500, '云端文件校验失败。');
    return raw;
  }
  return {
    async putCadChunk(digest, bytes) {
      if (!bytes.length || bytes.length > 2*1024*1024 || hash(bytes)!==digest) fail(400,'底图片段校验失败。');
      await check();
      await putNew(`${prefix}cad-chunks/${digest}.gz`, gzipSync(bytes), 'application/octet-stream');
    },
    async getCadChunk(digest) {
      if (!/^[a-f0-9]{64}$/.test(digest)) fail(400,'底图片段编号无效。');
      const data = await get(`${prefix}cad-chunks/${digest}.gz`);
      if (!data) fail(400,'底图片段缺失，请重新保存。');
      const bytes = gunzipSync(data,{maxOutputLength:2*1024*1024});
      if (hash(bytes)!==digest) fail(500,'底图片段校验失败。');
      return bytes;
    },
    async verifyCadChunks(chunks) {
      if (!Array.isArray(chunks) || !chunks.length || chunks.length > 128 ||
          chunks.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) {
        fail(400, '底图片段清单无效。');
      }
      // Upload verifies the digest before creating each immutable object.
      // Check existence without expanding the whole drawing in FC memory.
      const ids = [...new Set(chunks)];
      for (let i = 0; i < ids.length; i += 8) {
        await Promise.all(ids.slice(i, i + 8).map(async id => {
          try { await client.head(`${prefix}cad-chunks/${id}.gz`); }
          catch (error) {
            if (error.status === 404 || error.code === 'NoSuchKey') fail(400, '底图片段缺失，请重新保存。');
            throw error;
          }
        }));
      }
    },
    async restoreCad(chunks) {
      if (!Array.isArray(chunks) || !chunks.length || chunks.length>128) fail(400,'底图片段清单无效。');
      const decoder = new TextDecoder();
      let json = '';
      for (const id of chunks) json += decoder.decode(await this.getCadChunk(id), { stream: true });
      let cad;
      try { cad = JSON.parse(json + decoder.decode()); } catch { fail(400,'云端底图无效。'); }
      if (typeof cad?.base64 !== 'string' || !cad.base64 || typeof cad.name !== 'string') fail(400,'云端 DWG 底图不完整。');
      return cad;
    },
    async knowledgeGet(key) {
      const data = await get(`${prefix}knowledge/v1/${key}.gz`);
      return data ? JSON.parse(gunzipSync(data, { maxOutputLength: MAX })) : null;
    },
    async knowledgePut(key, value) {
      await check();
      return putNew(`${prefix}knowledge/v1/${key}.gz`, gzipSync(JSON.stringify(value)), 'application/octet-stream');
    },
    async latest() {
      await check();
      let token, last;
      do {
        const result = await client.listV2({ prefix: `${prefix}commits/`, 'max-keys': 1000, ...(token ? { 'continuation-token': token } : {}) });
        const keys = (result.objects || []).map(item => item.name).filter(name => /\/\d{12}\.json$/.test(name)).sort();
        if (keys.length) last = keys.at(-1);
        token = result.isTruncated ? result.nextContinuationToken : null;
      } while (token);
      return last ? JSON.parse((await get(last)).toString()) : emptyLibrary();
    },
    async revision(revision) {
      if (!revision) return emptyLibrary();
      const data = await get(versionKey(revision)); return data ? JSON.parse(data.toString()) : null;
    },
    async writeProject(project) {
      const slim = structuredClone(project), blobs = [];
      const extract = async (obj, key, path) => {
        if (typeof obj?.[key] !== 'string' || obj[key].length < 16384) return;
        const digest = await blob(obj[key]); obj[key] = null; blobs.push({ path, hash: digest });
      };
      await extract(slim.cadFile, 'base64', ['cadFile', 'base64']);
      await extract(slim.environment, 'floorTexture', ['environment', 'floorTexture']);
      for (let i = 0; i < (slim.environment?.photos?.length || 0); i++) await extract(slim.environment.photos[i], 'dataUrl', ['environment', 'photos', i, 'dataUrl']);
      return blob(JSON.stringify({ schema: 'needflea-cloud-project/1', project: slim, blobs }));
    },
    async readProject(digest, packedCad = false) {
      const packed = JSON.parse((await readBlob(digest)).toString());
      if (packed.schema !== 'needflea-cloud-project/1') fail(500, '云端项目格式不受支持。');
      const project = packed.project;
      for (const item of packed.blobs) {
        if (!Array.isArray(item.path) || item.path.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) fail(500, '云端文件路径无效。');
        let parent = project;
        for (const key of item.path.slice(0, -1)) parent = parent[key];
        parent[item.path.at(-1)] = (await readBlob(item.hash)).toString();
      }
      if (!packedCad && project.cloudCadChunks) {
        project.cadFile = await this.restoreCad(project.cloudCadChunks); delete project.cloudCadChunks;
      }
      return project;
    },
    async commit(next) { await check(); return putNew(versionKey(next.revision), Buffer.from(JSON.stringify(next))); },
  };
}

export function configuredOSS(req, env = process.env) {
  const region = (env.OSS_REGION || '').replace(/^oss-/, '');
  if (!/^cn-[a-z0-9-]+$|^[a-z]+-[a-z0-9-]+-\d$/.test(region) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.OSS_BUCKET || '')) fail(503, '云端尚未配置 OSS Bucket 和地域。');
  const fc = !!env.FC_FUNCTION_NAME;
  const accessKeyId = fc ? req.headers['x-fc-access-key-id'] || env.ALIBABA_CLOUD_ACCESS_KEY_ID : env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = fc ? req.headers['x-fc-access-key-secret'] || env.ALIBABA_CLOUD_ACCESS_KEY_SECRET : env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  const stsToken = fc ? req.headers['x-fc-security-token'] || env.ALIBABA_CLOUD_SECURITY_TOKEN : env.ALIBABA_CLOUD_SECURITY_TOKEN;
  if (!accessKeyId || !accessKeySecret) fail(503, '云端尚未配置 OSS 访问角色。');
  return ossStore(new OSS({ region: `oss-${region}`, bucket: env.OSS_BUCKET, accessKeyId, accessKeySecret, stsToken, secure: true, authorizationV4: true, timeout: 60000 }), env.OSS_PREFIX || 'needflea/library/');
}
