import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { winService } from '../optional-deps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!winService) {
  console.error('node-windows is not installed.');
  process.exit(1);
}

const { Service } = winService;

const svc = new Service({
  name: 'CloudDeck Agent',
  script: path.join(__dirname, '..', 'index.js'),
});

svc.on('uninstall', () => console.log('[uninstall-service] removed'));
svc.uninstall();
