import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  railwayUrl: process.env.RAILWAY_WS_URL || 'ws://localhost:3000',
  agentToken: requireEnv('AGENT_TOKEN'),

  reconnectMinMs: parseInt(process.env.RECONNECT_MIN_MS || '1000', 10),
  reconnectMaxMs: parseInt(process.env.RECONNECT_MAX_MS || '30000', 10),
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '5000', 10),
  statsIntervalMs: parseInt(process.env.STATS_INTERVAL_MS || '2500', 10),

  sunshine: {
    url: process.env.SUNSHINE_URL || 'https://localhost:47990',
    username: process.env.SUNSHINE_USERNAME || 'admin',
    password: process.env.SUNSHINE_PASSWORD || '',
    browserStreamUrl: process.env.SUNSHINE_BROWSER_STREAM_URL || 'https://localhost:47989',
  },

  steam: {
    apiUrl: process.env.STEAM_API_URL || 'http://localhost:27060',
    userDataDir: process.env.STEAM_USER_DATA_DIR || 'C:\\Program Files (x86)\\Steam\\userdata',
  },

  xboxGamesDir: process.env.XBOX_GAMES_DIR || 'C:\\XboxGames',

  screenshotDir: process.env.SCREENSHOT_DIR || '',

  github: {
    repo: process.env.GITHUB_REPO || '',
    checkIntervalHours: parseInt(process.env.AUTO_UPDATE_CHECK_INTERVAL_HOURS || '24', 10),
    allowMandatory: process.env.ALLOW_MANDATORY_UPDATES !== 'false',
  },

  muteSpeakers: process.env.MUTE_PC_SPEAKERS_ON_SESSION !== 'false',
  enableRemoteDesktop: process.env.ENABLE_REMOTE_DESKTOP !== 'false',

  paths: {
    data: path.join(__dirname, 'data'),
    updates: path.join(__dirname, '.updates'),
  },
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[agent] Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}
