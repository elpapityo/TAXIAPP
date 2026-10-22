# TAXIAPP PR #119 development preview, Windows built-in PowerShell only.
# Serves local static files; does not deploy, configure Firebase, or edit user data.
$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$RootPrefix = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$Port = 8787
$Url = 'http://localhost:8787/?adminFirestorePreview=1&build=v0.3.127-pr119'
$Allowed = @('.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp')
$Mime = @{
    '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8'
    '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8'
    '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'
    '.jpeg'='image/jpeg'; '.webp'='image/webp'
}
function Send-LocalResponse {
    param([System.IO.Stream]$Stream, [int]$Status, [string]$Type, [byte[]]$Body, [bool]$HeadOnly)
    $Reason = @{200='OK'; 400='Bad Request'; 403='Forbidden'; 404='Not Found'; 405='Method Not Allowed'; 500='Internal Server Error'}[$Status]
    if ($null -eq $Body) { $Body = [byte[]]@() }
    $Header = "HTTP/1.1 $Status $Reason`r`nContent-Type: $Type`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
    $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($Header)
    $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
    if (-not $HeadOnly -and $Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

Write-Host 'TAXIAPP v0.3.127 - development PR #119'
Write-Host 'Local server: Windows PowerShell (no Python or Node.js needed)'
$Listener = $null
try {
    $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $Listener.Start()
    Write-Host "SERVER READY: $Url"
    Write-Host 'Keep this window open during testing. Press Ctrl+C to stop.'
    Write-Host 'If the browser does not open, copy the SERVER READY URL.'
    try { Start-Process $Url -ErrorAction Stop } catch { Write-Host ('Browser launch failed: ' + $_.Exception.Message) }
    while ($true) {
        $Client = $Listener.AcceptTcpClient()
        try {
            $Client.ReceiveTimeout = 5000
            $Client.SendTimeout = 5000
            $Stream = $Client.GetStream()
            $Reader = [System.IO.StreamReader]::new($Stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
            $Line = $Reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($Line)) { continue }
            $Fields = $Line.Split(' ')
            $Method = $Fields[0]
            $HeadOnly = $Method -eq 'HEAD'
            if ($Fields.Count -lt 2) {
                Send-LocalResponse $Stream 400 'text/plain' ([System.Text.Encoding]::ASCII.GetBytes('Bad request')) $HeadOnly
                continue
            }
            if ($Method -ne 'GET' -and $Method -ne 'HEAD') {
                Send-LocalResponse $Stream 405 'text/plain' ([System.Text.Encoding]::ASCII.GetBytes('Method not allowed')) $false
                continue
            }
            $Pathname = [System.Uri]::UnescapeDataString(($Fields[1] -split '\?', 2)[0])
            if ($Pathname -eq '/') { $Pathname = '/index.html' }
            $Relative = $Pathname.TrimStart([char]'/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $File = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Root, $Relative))
            $Extension = [System.IO.Path]::GetExtension($File).ToLowerInvariant()
            if (-not $File.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or $Extension -notin $Allowed) {
                Send-LocalResponse $Stream 403 'text/plain' ([System.Text.Encoding]::ASCII.GetBytes('Forbidden')) $HeadOnly
                continue
            }
            if (-not [System.IO.File]::Exists($File)) {
                Send-LocalResponse $Stream 404 'text/plain' ([System.Text.Encoding]::ASCII.GetBytes('Not found')) $HeadOnly
                continue
            }
            $Body = [System.IO.File]::ReadAllBytes($File)
            Send-LocalResponse $Stream 200 $Mime[$Extension] $Body $HeadOnly
        } catch {
            Write-Host ('Request error: ' + $_.Exception.Message)
        } finally {
            if ($null -ne $Client) { $Client.Close() }
        }
    }
} catch {
    Write-Host ('SERVER START/OPERATION ERROR: ' + $_.Exception.Message)
    Write-Host 'If port 8787 is occupied, close the previous TAXIAPP local server.'
    exit 1
} finally {
    if ($null -ne $Listener) { $Listener.Stop() }
}
