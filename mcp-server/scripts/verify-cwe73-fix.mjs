// Manual reproduction of GitHub Issue #3 (CWE-73) against the patched server.
// Spawns dist/index.js exactly as an MCP host would, sends the same tool
// calls described in the issue with a workspace root configured, and checks
// that every attempt to escape the workspace root is rejected.
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hwpx-poc-workspace-'));
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hwpx-poc-outside-'));
const outsideTarget = path.join(outsideDir, 'PWNED.txt');

console.log('workspaceRoot:', workspaceRoot);
console.log('outsideDir   :', outsideDir);

const child = spawn(process.execPath, [path.resolve('dist/index.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, HWPX_MCP_WORKSPACE_ROOT: workspaceRoot },
});

let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function send(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify(payload) + '\n');
  });
}

function callTool(name, args) {
  return send('tools/call', { name, arguments: args });
}

async function main() {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'poc-verify', version: '0.0.0' },
  });

  const results = [];

  // --- PoC 1: save_document writing outside the workspace root -----------
  const createRes = await callTool('create_document', { title: 'poc' });
  const createBody = JSON.parse(createRes.result.content[0].text);
  const docId = createBody.doc_id;

  const saveRes = await callTool('save_document', {
    doc_id: docId,
    output_path: outsideTarget, // absolute path OUTSIDE workspaceRoot
  });
  results.push(['save_document (absolute path outside root)', saveRes]);

  const saveTraversalRes = await callTool('save_document', {
    doc_id: docId,
    output_path: path.join('..', path.basename(outsideDir), 'PWNED2.txt'),
  });
  results.push(['save_document (../ traversal)', saveTraversalRes]);

  // --- PoC 2: export_to_text / export_to_html writing outside root -------
  const exportTextRes = await callTool('export_to_text', {
    doc_id: docId,
    output_path: outsideTarget,
  });
  results.push(['export_to_text (absolute path outside root)', exportTextRes]);

  // --- PoC 3: open_document reading a file outside the root --------------
  fs.writeFileSync(path.join(outsideDir, 'secret.hwpx'), 'not a real hwpx, just a probe');
  const openRes = await callTool('open_document', {
    file_path: path.join(outsideDir, 'secret.hwpx'),
  });
  results.push(['open_document (absolute path outside root)', openRes]);

  let allBlocked = true;
  for (const [label, res] of results) {
    const text = res?.result?.content?.[0]?.text ?? JSON.stringify(res);
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    const blocked = typeof parsed.error === 'string' && parsed.error.includes('허용되지 않은 경로');
    if (!blocked) allBlocked = false;
    console.log(`[${blocked ? 'BLOCKED' : 'NOT BLOCKED'}] ${label}:`, JSON.stringify(parsed));
  }

  const leaked = fs.existsSync(outsideTarget) || fs.existsSync(path.join(outsideDir, 'PWNED2.txt'));
  console.log('File written outside workspace root?', leaked);

  child.stdin.end();
  child.kill();

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });

  if (!allBlocked || leaked) {
    console.error('\nPoC RESULT: VULNERABLE');
    process.exit(1);
  } else {
    console.log('\nPoC RESULT: PATCHED (all attempts blocked, no file written outside workspace root)');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  child.kill();
  process.exit(1);
});
