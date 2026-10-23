# =====================================================================
#  换底图：把新的整版模板换成网站默认底图
#  - 只换背景模板（assets 里的底图文件），不会动用户上传的照片
#  - 自动识别新底图里的透明照片区，同步更新默认取景框
#  - 自动改模板版本号（避免浏览器缓存旧图）
#  - 自动 git 提交并推送到 GitHub
#  用法：双击「换底图.bat」，或把图片拖到「换底图.bat」上
# =====================================================================
param(
    [string]$ImagePath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$Root = $PSScriptRoot
if ([string]::IsNullOrEmpty($Root)) { $Root = (Get-Location).Path }
$StorePath = Join-Path $Root 'js\store.js'
$AssetsDir = Join-Path $Root 'assets'

function Say($s) { Write-Host $s }

Say ''
Say '================================================='
Say '  换底图：把新的整版模板换成网站默认底图'
Say '  （只换背景模板，不会动用户上传的照片）'
Say '================================================='
Say ''

if (-not (Test-Path -LiteralPath $StorePath)) {
    Say '[错误] 找不到 js\store.js，请把本脚本放在项目文件夹里运行。'
    Read-Host '按回车退出'
    exit 1
}

# ---------------------------- 1. 选底图 ----------------------------
if ([string]::IsNullOrWhiteSpace($ImagePath)) {
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = '选择新的底图（整张模板，建议 1276 x 2846 的 PNG，中间留透明区）'
    $dlg.Filter = '图片文件|*.png;*.jpg;*.jpeg|所有文件|*.*'
    $dlg.CheckFileExists = $true
    if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        Say '已取消。'
        exit 0
    }
    $ImagePath = $dlg.FileName
}
if (-not (Test-Path -LiteralPath $ImagePath)) {
    Say ("[错误] 找不到文件: " + $ImagePath)
    Read-Host '按回车退出'
    exit 1
}
Say ('  新底图文件 : ' + $ImagePath)

# ---------------------------- 2. 读图 + 找透明照片区 ----------------------------
$img = $null
try { $img = [System.Drawing.Image]::FromFile($ImagePath) } catch { }
if ($null -eq $img) {
    Say '[错误] 这张图读不出来，请另存为 PNG 或 JPG 再试。'
    Read-Host '按回车退出'
    exit 1
}
$imgW = $img.Width
$imgH = $img.Height
Say ("  图片尺寸   : {0} x {1}" -f $imgW, $imgH)
if ([Math]::Abs($imgW - 1276) -gt 2 -or [Math]::Abs($imgH - 2846) -gt 2) {
    Say '  [提示] 与画布 1276x2846 不一致：页面里会等比缩放铺满，画面可能被裁掉一部分。'
}

$hole = $null
$scanCode = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class TemplateScan {
  public static int[] Hole(string path) {
    using (Bitmap src = new Bitmap(path)) {
      int w = src.Width, h = src.Height;
      using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
        using (Graphics g = Graphics.FromImage(bmp)) { g.Clear(Color.Transparent); g.DrawImage(src, 0, 0, w, h); }
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int[] buf = new int[w * h];
        Marshal.Copy(d.Scan0, buf, 0, buf.Length);
        bmp.UnlockBits(d);
        int minx = int.MaxValue, miny = int.MaxValue, maxx = -1, maxy = -1, n = 0;
        for (int i = 0; i < buf.Length; i++) {
          if (((buf[i] >> 24) & 255) < 16) {
            int x = i % w, y = i / w;
            n++;
            if (x < minx) minx = x;
            if (x > maxx) maxx = x;
            if (y < miny) miny = y;
            if (y > maxy) maxy = y;
          }
        }
        return new int[] { minx, miny, maxx, maxy, n };
      }
    }
  }
}
'@
try {
    Add-Type -TypeDefinition $scanCode -ReferencedAssemblies System.Drawing -ErrorAction Stop
    $r = [TemplateScan]::Hole($ImagePath)
    if ($r[4] -gt 500) { $hole = @{ x = $r[0]; y = $r[1]; w = ($r[2] - $r[0] + 1); h = ($r[3] - $r[1] + 1); n = $r[4] } }
} catch {
    Say '  （透明区自动识别不可用，将保留原来的照片区设置）'
}

if ($hole) {
    Say ("  透明照片区 : x {0}  y {1}  宽 {2}  高 {3}" -f $hole.x, $hole.y, $hole.w, $hole.h)
} else {
    Say '  透明照片区 : 没找到透明区（新底图可能没有留透明背景）'
    Say '              → 会保留原来的照片区位置；如果照片贴歪了，说明新底图需要留透明区。'
}

# ---------------------------- 3. 生成新底图文件 ----------------------------
$srcText = [System.IO.File]::ReadAllText($StorePath, [System.Text.Encoding]::UTF8)
$m = [regex]::Match($srcText, 'A\.TEMPLATE_VERSION\s*=\s*(\d+)')
$oldVer = 1
if ($m.Success) { $oldVer = [int]$m.Groups[1].Value }
$newVer = $oldVer + 1
$newName = 'template-v' + $newVer + '.png'
$newPath = Join-Path $AssetsDir $newName

if (-not (Test-Path -LiteralPath $AssetsDir)) { New-Item -ItemType Directory -Force -Path $AssetsDir | Out-Null }
$img.Save($newPath, [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
Say ("  已生成     : assets\{0}  ({1:N0} KB)" -f $newName, ((Get-Item $newPath).Length / 1KB))

# ---------------------------- 4. 更新代码里的默认底图 ----------------------------
Copy-Item -LiteralPath $StorePath -Destination ($StorePath + '.bak') -Force
$srcText = [regex]::Replace($srcText, 'A\.TEMPLATE_VERSION\s*=\s*\d+', ('A.TEMPLATE_VERSION = ' + $newVer))
$srcText = [regex]::Replace($srcText, "A\.TEMPLATE_SRC\s*=\s*'[^']*'", ("A.TEMPLATE_SRC = 'assets/" + $newName + "'"))
if ($hole) {
    $srcText = [regex]::Replace($srcText, 'A\.FRAME_DEFAULT\s*=\s*\{[^}]*\}',
        ('A.FRAME_DEFAULT = { x: ' + $hole.x + ', y: ' + $hole.y + ', w: ' + $hole.w + ', h: ' + $hole.h + ' }'))
}
[System.IO.File]::WriteAllText($StorePath, $srcText, (New-Object System.Text.UTF8Encoding($false)))
Say ("  已更新代码 : 模板版本 {0} → {1}" -f $oldVer, $newVer)

# ---------------------------- 5. git 提交并推送 ----------------------------
$pushed = $false
if (Test-Path -LiteralPath (Join-Path $Root '.git')) {
    Say ''
    Say '  正在提交到 Git ...'
    & git -C $Root add -A | Out-Null
    & git -C $Root commit -m ("换底图 v" + $newVer) | Out-Null
    Say '  正在推送到 GitHub ...'
    $proxyArg = @()
    try {
        $ie = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
        if ($ie -and $ie.ProxyEnable -eq 1 -and $ie.ProxyServer) {
            $p = [string]$ie.ProxyServer
            if ($p -notmatch '^https?://') { $p = 'http://' + $p }
            $proxyArg = @('-c', ('http.proxy=' + $p), '-c', ('https.proxy=' + $p))
        }
    } catch { }
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & git -C $Root @proxyArg push 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = $oldEap
    if ($code -eq 0) {
        $pushed = $true
        Say '  推送成功。'
    } else {
        Say '  [提示] 推送失败（网络或代理问题），本地已经改好了，稍后可手动执行 git push。'
        Say ('         ' + $out.Trim())
    }
} else {
    Say '  [提示] 这个文件夹不是 Git 仓库，已跳过提交与推送（本地使用不受影响）。'
}

Say ''
Say '================================================='
Say '  换底图完成！'
Say ''
Say '  · 本地版：刷新浏览器（Ctrl+F5）就能看到新底图'
if ($pushed) {
    Say '  · 线上版：GitHub Pages 大约 1~2 分钟后自动更新，'
    Say '            因为文件名带版本号，不受缓存影响。'
} else {
    Say '  · 线上版：等推送成功后约 1~2 分钟自动更新。'
}
Say '  · 旧底图文件仍保留在 assets 里，需要的话可以手动删除。'
Say '================================================='
Say ''
