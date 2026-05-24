// PC speaker mute/restore via Windows Core Audio COM API.
//
// Driven through inline C# via PowerShell's Add-Type. The trick with this
// interface is that IAudioEndpointVolume::SetMute is the 12th vtable entry
// and GetMute is the 13th, so the interface declaration MUST stub out the
// preceding 11 methods (RegisterControlChangeNotify through
// GetChannelVolumeLevelScalar) — otherwise the call lands on the wrong
// slot and Windows returns "Value does not fall within the expected range."
//
// Earlier versions of this file only stubbed 9 methods, which is why mute
// was silently failing.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// The same script is reused for both get-mute and set-mute. PowerShell here
// is single-quoted in our JS source so $ and \ are passed through literally;
// inside PowerShell we use here-string (@'...'@) for the C# block so the C#
// quoting doesn't fight with PowerShell quoting either.
const SCRIPT = (op) => `powershell -NoProfile -Command "
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid(\\"5CDF2C82-841E-4546-9722-0CF74078229A\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float l, Guid c);
  int SetMasterVolumeLevelScalar(float l, Guid c);
  int GetMasterVolumeLevel(out float l);
  int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint ch, float l, Guid c);
  int SetChannelVolumeLevelScalar(uint ch, float l, Guid c);
  int GetChannelVolumeLevel(uint ch, out float l);
  int GetChannelVolumeLevelScalar(uint ch, out float l);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid c);
  int GetMute(out bool m);
}
[Guid(\\"D666063F-1587-4E43-81F1-B948E807363F\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid id, int c, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[Guid(\\"A95664D2-9614-4F35-A746-DE8DB63617E6\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int f, uint s, out IntPtr c);
  int GetDefaultAudioEndpoint(int f, int r, out IMMDevice e);
}
[ComImport, Guid(\\"BCDE0395-E52F-467C-8E3D-C4579291692E\\")]
public class MMDeviceEnumerator { }
public static class Audio {
  static IAudioEndpointVolume Endpoint() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d);
    var iid = typeof(IAudioEndpointVolume).GUID;
    object o; d.Activate(ref iid, 23, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static bool GetMute() {
    bool m; Endpoint().GetMute(out m); return m;
  }
  public static void SetMute(bool m) { Endpoint().SetMute(m, Guid.Empty); }
}
'@
${op}
"`;

export class Audio {
  constructor() {
    this.previousMuted = null;
    this.muted = false;
  }

  async muteSpeakers() {
    try {
      this.previousMuted = await this.isMuted();
      if (this.previousMuted) return { ok: true, wasAlreadyMuted: true };
      await this._setMute(true);
      this.muted = true;
      return { ok: true };
    } catch (err) {
      console.warn('[audio] muteSpeakers failed:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async restoreSpeakers() {
    try {
      // If we never tracked a previous state, default to unmuted — better to
      // leave speakers on than to leave the user staring at silent meters.
      const target = this.previousMuted ?? false;
      await this._setMute(target);
      this.muted = target;
      this.previousMuted = null;
      return { ok: true };
    } catch (err) {
      console.warn('[audio] restoreSpeakers failed:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async isMuted() {
    const { stdout } = await execAsync(SCRIPT('[Audio]::GetMute()'), { timeout: 5000 });
    return stdout.trim().toLowerCase() === 'true';
  }

  async _setMute(mute) {
    await execAsync(SCRIPT(`[Audio]::SetMute(\$${mute ? 'true' : 'false'})`), { timeout: 5000 });
  }
}
