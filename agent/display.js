// Virtual display + physical monitor management.
//
// When a remote session starts, we want the game to render to a virtual
// display that matches the client's resolution/FPS — this offloads the GPU
// from pushing pixels to the local 4K monitors that nobody is watching.
//
// Sunshine has built-in support for "always-on" virtual displays via either
// the IddSampleDriver, Virtual Display Driver, or its built-in Indirect
// Display Driver since 0.21. We just need to (a) ensure the virtual display
// exists, (b) make Windows extend/clone onto it, (c) optionally power off the
// physical monitors via DisplaySwitch.exe or low-level WM_SYSCOMMAND.
//
// When the session ends we reverse the process.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class DisplayManager {
  constructor({ sunshine }) {
    this.sunshine = sunshine;
    this.virtualDisplayActive = false;
    this.physicalMonitorsOff = false;
  }

  async activateVirtual({ width, height, fps }) {
    await this.sunshine.applyStreamConfig({ width, height, fps, bitrate: 20000 });
    // Switch Windows display arrangement to "Second screen only" so all
    // rendering goes to the virtual output Sunshine created. This is the
    // cleanest way to make the game render only to the virtual display.
    try {
      await execAsync('DisplaySwitch.exe /external');
      this.virtualDisplayActive = true;
    } catch (err) {
      console.warn('[display] DisplaySwitch failed:', err.message);
    }
    await this.turnOffPhysicalMonitors();
    return { ok: true };
  }

  async deactivateVirtual() {
    try {
      await execAsync('DisplaySwitch.exe /internal');
    } catch (err) {
      console.warn('[display] DisplaySwitch restore failed:', err.message);
    }
    this.virtualDisplayActive = false;
    await this.turnOnPhysicalMonitors();
    return { ok: true };
  }

  async turnOffPhysicalMonitors() {
    // Send WM_SYSCOMMAND SC_MONITORPOWER (0xF170) with lparam 2 (off) via
    // PowerShell. The signal is honored by all attached physical displays.
    const ps = `powershell -NoProfile -Command "
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Mon {
  [DllImport(\\"user32.dll\\")] public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
}
'@;
      [Mon]::SendMessage((Get-Process -Id $PID).MainWindowHandle, 0x112, 0xF170, 2) | Out-Null
    "`;
    try {
      await execAsync(ps);
      this.physicalMonitorsOff = true;
    } catch (err) {
      console.warn('[display] monitor power-off failed:', err.message);
    }
  }

  async turnOnPhysicalMonitors() {
    // Moving the cursor or sending a key wakes the monitors. We jiggle the mouse.
    const ps = `powershell -NoProfile -Command "
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(100, 100);
      Start-Sleep -Milliseconds 50;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(101, 101);
    "`;
    try {
      await execAsync(ps);
      this.physicalMonitorsOff = false;
    } catch (err) {
      console.warn('[display] monitor wake failed:', err.message);
    }
  }
}
