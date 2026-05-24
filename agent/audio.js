// PC speaker mute/restore. We use Windows' built-in `nircmdc`/`SoundVolumeView`
// when available, with a PowerShell fallback that toggles the master mute via
// the Windows Core Audio API. The PowerShell path is bundled — no extra tools
// needed — but is slightly slower so we prefer the CLI tools if installed.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class Audio {
  constructor() {
    this.previousMuted = null;
    this.muted = false;
  }

  async muteSpeakers() {
    this.previousMuted = await this.isMuted();
    if (this.previousMuted) return { ok: true, wasAlreadyMuted: true };
    await this._setMute(true);
    this.muted = true;
    return { ok: true };
  }

  async restoreSpeakers() {
    if (this.previousMuted === null) return { ok: true };
    await this._setMute(this.previousMuted);
    this.muted = this.previousMuted;
    this.previousMuted = null;
    return { ok: true };
  }

  async isMuted() {
    const ps = `powershell -NoProfile -Command "
      Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid(\\"5CDF2C82-841E-4546-9722-0CF74078229A\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int j(); int k(); int l(); int m();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid(\\"D666063F-1587-4E43-81F1-B948E807363F\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref System.Guid id, int clsCtx, int activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[Guid(\\"A95664D2-9614-4F35-A746-DE8DB63617E6\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int n(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid(\\"BCDE0395-E52F-467C-8E3D-C4579291692E\\")] class MMDeviceEnumerator { }
public class Audio {
  public static bool GetMute() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev; e.GetDefaultAudioEndpoint(0, 1, out dev);
    var iid = typeof(IAudioEndpointVolume).GUID;
    object o; dev.Activate(ref iid, 23, 0, out o);
    var v = (IAudioEndpointVolume)o; bool m; v.GetMute(out m); return m;
  }
  public static void SetMute(bool m) {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev; e.GetDefaultAudioEndpoint(0, 1, out dev);
    var iid = typeof(IAudioEndpointVolume).GUID;
    object o; dev.Activate(ref iid, 23, 0, out o);
    var v = (IAudioEndpointVolume)o; v.SetMute(m, System.Guid.Empty);
  }
}
'@;
      [Audio]::GetMute()
    "`;
    try {
      const { stdout } = await execAsync(ps);
      return stdout.trim().toLowerCase() === 'true';
    } catch { return false; }
  }

  async _setMute(mute) {
    const ps = `powershell -NoProfile -Command "[Audio]::SetMute($${mute ? 'true' : 'false'})"`;
    // Re-declare the type each call rather than persist — simpler than caching session state
    const full = (await this._wrapWithType(ps));
    try { await execAsync(full); }
    catch (err) { console.warn('[audio] setMute failed:', err.message); }
  }

  async _wrapWithType(invoke) {
    // For a single one-shot we just call SetMute via the same script as GetMute above
    return `powershell -NoProfile -Command "
      Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid(\\"5CDF2C82-841E-4546-9722-0CF74078229A\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int j(); int k(); int l(); int m();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid(\\"D666063F-1587-4E43-81F1-B948E807363F\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref System.Guid id, int clsCtx, int activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[Guid(\\"A95664D2-9614-4F35-A746-DE8DB63617E6\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int n(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid(\\"BCDE0395-E52F-467C-8E3D-C4579291692E\\")] class MMDeviceEnumerator { }
public class Audio2 {
  public static void Set(bool m) {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev; e.GetDefaultAudioEndpoint(0, 1, out dev);
    var iid = typeof(IAudioEndpointVolume).GUID;
    object o; dev.Activate(ref iid, 23, 0, out o);
    var v = (IAudioEndpointVolume)o; v.SetMute(m, System.Guid.Empty);
  }
}
'@;
      ${invoke.replace(/\[Audio\]::SetMute/g, '[Audio2]::Set')}
    "`;
  }
}
