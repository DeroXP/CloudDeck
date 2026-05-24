// Register the CloudDeck PC agent as a Windows service via node-windows.
// Run with: npm run install-service (from agent/)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { winService } from '../optional-deps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!winService) {
  console.error('node-windows is not installed. Run `npm install node-windows` first.');
  process.exit(1);
}

const { Service } = winService;

const svc = new Service({
  name: 'CloudDeck Agent',
  description: 'CloudDeck — gaming PC agent. Bridges Railway → Windows.',
  script: path.join(__dirname, '..', 'index.js'),
  nodeOptions: [],
  env: [
    { name: 'NODE_ENV', value: 'production' },
  ],
});

svc.on('install', () => {
  console.log('[install-service] installed; starting…');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('[install-service] already installed');
});

svc.on('start', () => {
  console.log('[install-service] service started');
});

svc.on('error', err => {
  console.error('[install-service] error:', err);
});

svc.install();
