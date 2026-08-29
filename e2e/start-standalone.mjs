import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workspaceRoot = process.cwd();
const standaloneRoot = path.join(workspaceRoot, '.next', 'standalone');
const serverPath = path.join(standaloneRoot, 'server.js');

if (!existsSync(serverPath)) {
  throw new Error('Missing .next/standalone/server.js. Run npm run build first.');
}

const staticSource = path.join(workspaceRoot, '.next', 'static');
if (!existsSync(staticSource)) {
  throw new Error('Missing .next/static. Run npm run build first.');
}

const staticTarget = path.join(standaloneRoot, '.next', 'static');
mkdirSync(path.dirname(staticTarget), { recursive: true });
cpSync(staticSource, staticTarget, { recursive: true, force: true });

const publicSource = path.join(workspaceRoot, 'public');
if (existsSync(publicSource)) {
  cpSync(publicSource, path.join(standaloneRoot, 'public'), {
    recursive: true,
    force: true,
  });
}

await import(pathToFileURL(serverPath).href);
