# Saves a PNG of the Seoran window, even when other windows cover it.
# Usage: powershell -File tools/capture-window.ps1 -Out shot.png
param([string]$Out = "seoran.png", [string]$Process = "seoran")

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SeoranWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  // The browser window is the one whose title ends with "Seoran".
  public static IntPtr Find(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.ToString().EndsWith("Seoran")) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[SeoranWin]::SetProcessDPIAware() | Out-Null
$p = Get-Process $Process -ErrorAction Stop | Select-Object -First 1
$h = [SeoranWin]::Find([uint32]$p.Id)
if ($h -eq [IntPtr]::Zero) { throw "Seoran window not found" }
if ([SeoranWin]::IsIconic($h)) {
  [SeoranWin]::ShowWindow($h, 4) | Out-Null  # SW_SHOWNOACTIVATE: restore without stealing focus
  Start-Sleep -Milliseconds 700
}
$r = New-Object SeoranWin+RECT
[SeoranWin]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# 2 = PW_RENDERFULLCONTENT: includes DirectComposition content (WebView2).
[SeoranWin]::PrintWindow($h, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"saved $Out ($w x $hh)"
