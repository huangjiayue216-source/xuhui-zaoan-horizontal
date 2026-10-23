# =====================================================================
#  早安徐汇 · 本地编辑器服务（纯 PowerShell，无需安装任何东西）
#  用法: 双击「启动.bat」，或在此目录执行  pwsh -File server.ps1
# =====================================================================
param(
    [int]$Port = 5311,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
if ([string]::IsNullOrEmpty($Root)) { $Root = (Get-Location).Path }
$DataDir = Join-Path $Root 'data'
$StateFile = Join-Path $DataDir 'state.json'
$BackupFile = Join-Path $DataDir 'state.backup.json'
$PidFile = Join-Path $DataDir 'server.pid'

$script:Rev = 0
$script:StateJson = '{"rev":0,"updatedAt":null,"assets":{},"project":null}'

function Write-Log([string]$msg) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg)
}

function Load-State {
    if (-not (Test-Path -LiteralPath $StateFile)) { return }
    try {
        $raw = [System.IO.File]::ReadAllText($StateFile, [System.Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($raw)) { return }
        $obj = $raw | ConvertFrom-Json
        $script:Rev = [int]$obj.rev
        $script:StateJson = $raw
        Write-Log ("已载入数据文件  rev={0}  {1:N1} KB" -f $script:Rev, ($raw.Length / 1024))
    } catch {
        Write-Log ("[警告] 数据文件读取失败: {0}" -f $_.Exception.Message)
    }
}

function Save-State([string]$json) {
    if (-not (Test-Path -LiteralPath $DataDir)) {
        New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    }
    if (Test-Path -LiteralPath $StateFile) {
        try { Copy-Item -LiteralPath $StateFile -Destination $BackupFile -Force } catch { }
    }
    $tmp = "$StateFile.tmp"
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $StateFile -Force
}

$MimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.otf'  = 'font/otf'
    '.ttf'  = 'font/ttf'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/markdown; charset=utf-8'
}

function Send-Response($item, [string]$status, [string]$contentType, [byte[]]$body) {
    $head = "HTTP/1.1 $status" + "`r`n" +
            "Content-Type: $contentType" + "`r`n" +
            "Content-Length: $($body.Length)" + "`r`n" +
            "Cache-Control: no-store" + "`r`n" +
            "Connection: close" + "`r`n`r`n"
    $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
    $item.stream.Write($hb, 0, $hb.Length)
    if ($body.Length -gt 0) { $item.stream.Write($body, 0, $body.Length) }
    $item.stream.Flush()
    $item.done = $true
}

function Send-Text($item, [string]$status, [string]$text, [string]$contentType) {
    if (-not $contentType) { $contentType = 'text/plain; charset=utf-8' }
    Send-Response $item $status $contentType ([System.Text.Encoding]::UTF8.GetBytes($text))
}

function Send-Json($item, [string]$status, [string]$json) {
    Send-Response $item $status 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($json))
}

function Get-RevisionInfo {
    return '{"rev":' + $script:Rev + ',"updatedAt":' + ($(if ($null -eq $script:UpdatedAt) { 'null' } else { '"' + $script:UpdatedAt + '"' })) + '}'
}

function Handle-ApiState($item, [string]$method, [byte[]]$body) {
    if ($method -eq 'GET' -or $method -eq 'HEAD') {
        Send-Json $item '200 OK' $script:StateJson
        return
    }
    if ($method -eq 'DELETE') {
        $script:Rev = $script:Rev + 1
        $script:UpdatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $script:StateJson = '{"rev":' + $script:Rev + ',"updatedAt":"' + $script:UpdatedAt + '","assets":{},"project":null}'
        Save-State $script:StateJson
        Send-Json $item '200 OK' (Get-RevisionInfo)
        Write-Log '数据已清空'
        return
    }
    if ($method -ne 'PUT' -and $method -ne 'POST') {
        Send-Text $item '405 Method Not Allowed' 'Method Not Allowed'
        return
    }

    $text = [System.Text.Encoding]::UTF8.GetString($body)
    if ([string]::IsNullOrWhiteSpace($text)) {
        Send-Text $item '400 Bad Request' '{"error":"empty body"}' 'application/json; charset=utf-8'
        return
    }

    $m = [regex]::Match($text, '"baseRev"\s*:\s*(-?\d+)')
    $baseRev = $null
    if ($m.Success) { $baseRev = [int]$m.Groups[1].Value }
    if ($null -ne $baseRev -and $baseRev -ne $script:Rev) {
        Send-Json $item '409 Conflict' ('{"error":"conflict","rev":' + $script:Rev + '}')
        return
    }

    $script:Rev = $script:Rev + 1
    $script:UpdatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

    # 直接沿用客户端提交的原文（只去掉最外层花括号），避免大对象反复序列化，
    # 也不会受 JSON 键顺序影响。
    $inner = $text.Trim()
    if (-not $inner.StartsWith('{') -or -not $inner.EndsWith('}')) {
        Send-Text $item '400 Bad Request' '{"error":"bad json"}' 'application/json; charset=utf-8'
        return
    }
    $inner = $inner.Substring(1, $inner.Length - 2)
    $newState = '{"rev":' + $script:Rev + ',"updatedAt":"' + $script:UpdatedAt + '",' + $inner + '}'

    $script:StateJson = $newState
    try {
        Save-State $newState
        Send-Json $item '200 OK' (Get-RevisionInfo)
        Write-Log ("已保存  rev={0}  {1:N1} KB" -f $script:Rev, ($newState.Length / 1024))
    } catch {
        Send-Text $item '500 Internal Server Error' ('{"error":"save failed"}') 'application/json; charset=utf-8'
        Write-Log ("[错误] 保存失败: {0}" -f $_.Exception.Message)
    }
}

function Serve-Static($item, [string]$path) {
    $rel = [System.Uri]::UnescapeDataString($path)
    if ($rel -eq '/' -or [string]::IsNullOrEmpty($rel)) { $rel = '/index.html' }
    $parts = $rel.Split('/') | Where-Object { $_ -ne '' }
    foreach ($p in $parts) {
        if ($p.StartsWith('.') -or $p -eq 'data' -or $p -eq 'tools' -or $p -eq 'server.ps1' -or $p -eq 'server.js') {
            Send-Text $item '403 Forbidden' 'Forbidden'
            return
        }
    }
    $full = Join-Path $Root ($parts -join [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Text $item '404 Not Found' 'Not Found'
        return
    }
    $ext = [System.IO.Path]::GetExtension($full).ToLower()
    $type = $MimeTypes[$ext]
    if (-not $type) { $type = 'application/octet-stream' }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        Send-Response $item '200 OK' $type $bytes
    } catch {
        Send-Text $item '500 Internal Server Error' 'Read error'
    }
}

function Handle-Request($item) {
    $method = $item.method
    $path = $item.path
    $body = New-Object byte[] 0
    if ($item.contentLength -gt 0) {
        $all = $item.buffer.ToArray()
        $len = [Math]::Min($item.contentLength, $all.Length - $item.headerEnd)
        $body = New-Object byte[] $len
        [Array]::Copy($all, $item.headerEnd, $body, 0, $len)
    }
    if ($path -eq '/api/rev' -and ($method -eq 'GET' -or $method -eq 'HEAD')) {
        Send-Json $item '200 OK' (Get-RevisionInfo)
        return
    }
    if ($path -eq '/api/health') {
        Send-Json $item '200 OK' '{"ok":true}'
        return
    }
    if ($path -eq '/api/state') {
        Handle-ApiState $item $method $body
        return
    }
    if ($method -ne 'GET' -and $method -ne 'HEAD') {
        Send-Text $item '405 Method Not Allowed' 'Method Not Allowed'
        return
    }
    Serve-Static $item $path
}

function Process-Client($item) {
    if ($item.done) { return }
    $buf = New-Object byte[] 262144
    $read = $item.stream.Read($buf, 0, $buf.Length)
    if ($read -le 0) { $item.closed = $true; return }
    $item.buffer.Write($buf, 0, $read)
    $item.last = Get-Date

    if (-not $item.headerParsed) {
        $txt = [System.Text.Encoding]::ASCII.GetString($item.buffer.ToArray())
        $sep = $txt.IndexOf("`r`n`r`n")
        if ($sep -lt 0) {
            if ($item.buffer.Length -gt 262144) { $item.closed = $true }
            return
        }
        $headLines = $txt.Substring(0, $sep).Split("`r`n")
        $reqLine = $headLines[0].Split(' ')
        if ($reqLine.Length -lt 2) { $item.closed = $true; return }
        $item.method = $reqLine[0].ToUpper()
        # 去掉查询串（例如 /index.html?offline=1）
        $item.path = ($reqLine[1] -split '\?')[0]
        $cl = 0
        foreach ($line in $headLines) {
            if ($line -match '^(?i)Content-Length:\s*(\d+)') { $cl = [int]$Matches[1] }
        }
        if ($cl -gt 200MB) { Send-Text $item '413 Payload Too Large' 'Too large'; return }
        $item.contentLength = $cl
        $item.headerEnd = $sep + 4
        $item.headerParsed = $true
    }

    if ($item.buffer.Length -ge ($item.headerEnd + $item.contentLength)) {
        Handle-Request $item
    }
}

# ------------------------------- 启动 -------------------------------
Load-State

$listener = $null
$boundPort = $Port
for ($i = 0; $i -lt 20; $i++) {
    try {
        $try = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, ($Port + $i))
        $try.Start()
        $listener = $try
        $boundPort = $Port + $i
        break
    } catch {
        Write-Log ("端口 {0} 被占用，尝试下一个…" -f ($Port + $i))
    }
}
if ($null -eq $listener) {
    Write-Host '[错误] 找不到可用端口，请手动指定：pwsh -File server.ps1 -Port 8080'
    Read-Host '按回车退出'
    exit 1
}

if (-not (Test-Path -LiteralPath $DataDir)) { New-Item -ItemType Directory -Force -Path $DataDir | Out-Null }
[System.IO.File]::WriteAllText($PidFile, [string]$PID, (New-Object System.Text.UTF8Encoding($false)))

$url = "http://127.0.0.1:$boundPort/"
Write-Host ''
Write-Host '  ============================================'
Write-Host '   早安徐汇 · 图片文字编辑器'
Write-Host "   访问地址: $url"
Write-Host "   数据文件: $StateFile"
Write-Host '   关闭本窗口即可停止服务（或运行 停止.bat）'
Write-Host '  ============================================'
Write-Host ''

if (-not $NoBrowser) {
    try { Start-Process $url | Out-Null } catch { }
}

$clients = New-Object System.Collections.ArrayList
$idleLimit = (Get-Date).AddSeconds(-20)

try {
    while ($true) {
        while ($listener.Pending()) {
            $client = $listener.AcceptTcpClient()
            $client.NoDelay = $true
            $stream = $client.GetStream()
            [void]$clients.Add([pscustomobject]@{
                client        = $client
                stream        = $stream
                buffer        = (New-Object System.IO.MemoryStream)
                method        = ''
                path          = ''
                contentLength = 0
                headerEnd     = 0
                headerParsed  = $false
                done          = $false
                closed        = $false
                last          = (Get-Date)
            })
        }

        for ($i = $clients.Count - 1; $i -ge 0; $i--) {
            $item = $clients[$i]
            if (-not $item.closed -and -not $item.done) {
                try {
                    if ($item.stream.DataAvailable) { Process-Client $item }
                } catch {
                    $item.closed = $true
                }
            }
            $stale = ((Get-Date) - $item.last).TotalSeconds -gt 25
            if ($item.done -or $item.closed -or ($stale -and -not $item.headerParsed)) {
                try { $item.stream.Close(); $item.client.Close() } catch { }
                $clients.RemoveAt($i)
            }
        }
        Start-Sleep -Milliseconds 4
    }
} finally {
    try { $listener.Stop() } catch { }
    try { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue } catch { }
    Write-Log '服务已停止'
}
