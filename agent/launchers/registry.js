// Tiny helper for Windows registry reads via PowerShell, shared by every
// launcher scanner. Returns JSON-parseable arrays/objects from
// Get-ItemProperty / Get-ChildItem so each launcher module can stay tiny.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function ps(command, { timeoutMs = 5000 } = {}) {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "${command.replace(/"/g, '\\"')}"`,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function psJson(command, { timeoutMs = 5000 } = {}) {
  const out = await ps(command, { timeoutMs });
  if (!out) return null;
  try {
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

// Convenience: scan Windows "Uninstall" registry for entries matching a
// publisher predicate. The two hives we care about are 32-bit (WOW6432Node)
// and 64-bit native. Returns deduped list of { DisplayName, InstallLocation,
// UninstallString, DisplayIcon, Publisher }.
export async function uninstallEntries(publisherMatch) {
  const hives = [
    'HKLM:\\\\SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall',
    'HKLM:\\\\SOFTWARE\\\\WOW6432Node\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall',
    'HKCU:\\\\SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall',
  ];
  const all = [];
  for (const hive of hives) {
    const rows = await psJson(
      `Get-ItemProperty -Path '${hive}\\\\*' -ErrorAction SilentlyContinue ` +
      `| Where-Object { $_.Publisher -match '${publisherMatch}' -and $_.DisplayName } ` +
      `| Select-Object DisplayName, InstallLocation, UninstallString, DisplayIcon, Publisher ` +
      `| ConvertTo-Json -Compress`,
    );
    if (rows) all.push(...rows);
  }
  // dedupe by DisplayName
  const seen = new Set();
  return all.filter(r => {
    if (!r.DisplayName) return false;
    const key = r.DisplayName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
