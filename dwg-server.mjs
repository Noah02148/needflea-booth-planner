/**
 * Local DWG conversion server.
 * Uses ODA File Converter to convert DWG → DXF, then returns the DXF
 * for the browser's libdxfrw parser to handle (full block/layer support).
 */
import { createServer } from 'http';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const PORT = 3001;
const ODA_PATH = '/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter';
const TMP_IN = '/tmp/oda-dwg-input';
const TMP_OUT = '/tmp/oda-dwg-output';

async function convertDWG(buffer, filename = 'input.dwg') {
  // Clean temp dirs
  for (const dir of [TMP_IN, TMP_OUT]) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) unlinkSync(join(dir, f));
  }

  // Write DWG to temp input
  writeFileSync(join(TMP_IN, filename), Buffer.from(buffer));

  // Convert DWG → DXF via ODA
  console.log(`  Converting via ODA...`);
  try {
    execSync(`"${ODA_PATH}" "${TMP_IN}" "${TMP_OUT}" ACAD2018 DXF 0 1`, {
      timeout: 60000,
      stdio: 'pipe'
    });
  } catch (err) {
    throw new Error('ODA conversion failed: ' + (err.stderr?.toString() || err.message));
  }

  // Find output DXF
  const outFiles = readdirSync(TMP_OUT).filter(f => f.endsWith('.dxf'));
  if (outFiles.length === 0) throw new Error('No DXF output from ODA converter');

  const dxfPath = join(TMP_OUT, outFiles[0]);
  const dxfBuffer = readFileSync(dxfPath);
  console.log(`  DXF: ${(dxfBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  return dxfBuffer;
}

// Check ODA is installed
if (!existsSync(ODA_PATH)) {
  console.error('ERROR: ODA File Converter not found at', ODA_PATH);
  console.error('Download from: https://www.opendesign.com/guestfiles/oda_file_converter');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/convert') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const filename = decodeURIComponent(req.headers['x-filename'] || 'input.dwg');
        console.log(`Converting: ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);

        const dxfBuffer = await convertDWG(buffer.buffer, filename);

        // Return the DXF content directly — browser will parse it with libdxfrw/DXF parser
        res.writeHead(200, {
          'Content-Type': 'application/dxf',
          'Content-Length': dxfBuffer.length
        });
        res.end(dxfBuffer);
        console.log(`  Done! Sent ${(dxfBuffer.length / 1024).toFixed(0)} KB DXF`);
      } catch (err) {
        console.error('  Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => console.log(`DWG→DXF server on http://localhost:${PORT} (using ODA File Converter)`));
