// PC stats collector. Uses `systeminformation` for cross-vendor stats. For
// NVIDIA-specific data (GPU temp, utilization, fan speeds) we fall back to
// `nvidia-smi` when present — it ships with every NVIDIA driver and gives
// reliable numbers without needing NVAPI bindings.

import si from 'systeminformation';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class Stats {
  constructor() {
    this.lastNvidiaSnapshot = null;
    this.lastNvidiaAt = 0;
    this.lastFailedNvidia = 0;
  }

  async snapshot() {
    const [cpu, mem, gpu, currentLoad] = await Promise.all([
      si.cpuTemperature().catch(() => null),
      si.mem().catch(() => null),
      this._gpu(),
      si.currentLoad().catch(() => null),
    ]);

    return {
      cpu: {
        usage: currentLoad?.currentLoad ?? null,
        temp: cpu?.main ?? null,
      },
      ram: {
        used: mem ? mem.used : null,
        total: mem ? mem.total : null,
        percent: mem ? Math.round((mem.used / mem.total) * 100) : null,
      },
      gpu,
      fans: gpu?.fans ?? null,
      timestamp: Date.now(),
    };
  }

  async _gpu() {
    // Try NVIDIA first
    const nvidia = await this._nvidiaSmi().catch(() => null);
    if (nvidia) return nvidia;

    // Fall back to systeminformation's graphics block
    const graphics = await si.graphics().catch(() => null);
    const primary = graphics?.controllers?.[0];
    if (!primary) return null;
    return {
      vendor: primary.vendor,
      model: primary.model,
      usage: primary.utilizationGpu ?? null,
      temp: primary.temperatureGpu ?? null,
      memoryUsed: primary.memoryUsed ?? null,
      memoryTotal: primary.memoryTotal ?? null,
    };
  }

  async _nvidiaSmi() {
    if (Date.now() - this.lastFailedNvidia < 60_000) return null;
    try {
      const { stdout } = await execAsync(
        'nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,fan.speed --format=csv,noheader,nounits',
        { timeout: 2000 },
      );
      const line = stdout.trim().split('\n')[0];
      if (!line) return null;
      const [name, usage, temp, memUsed, memTotal, fan] = line.split(',').map(s => s.trim());
      return {
        vendor: 'NVIDIA',
        model: name,
        usage: Number(usage),
        temp: Number(temp),
        memoryUsed: Number(memUsed) * 1024 * 1024,
        memoryTotal: Number(memTotal) * 1024 * 1024,
        fans: fan === '[Not Supported]' ? null : [{ speed: Number(fan) }],
      };
    } catch (err) {
      this.lastFailedNvidia = Date.now();
      return null;
    }
  }
}
