$port = 3001
$root = $PSScriptRoot
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$port"
Write-Host "(This only works on this PC. For access from your phone, run server.js with Node instead — see README notes.)"

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.jsx'  = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.ttf'  = 'font/ttf'
    '.webp' = 'image/webp'
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
    } catch {
        break
    }

    $req = $ctx.Request
    $res = $ctx.Response
    $res.KeepAlive = $false

    try {
        $urlPath = $req.Url.LocalPath
        if ($urlPath -eq '/') { $urlPath = '/index.html' }

        $filePath = Join-Path $root ($urlPath.TrimStart('/').Replace('/', '\'))

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.StatusCode = 200
            $res.ContentType = $mime
            $res.ContentLength64 = [long]$bytes.LongLength
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host "200 $urlPath ($($bytes.Length) bytes)"
        } else {
            Write-Host "404 $urlPath"
            $res.StatusCode = 404
            $body = [System.Text.Encoding]::UTF8.GetBytes("Not Found: $urlPath")
            $res.ContentLength64 = [long]$body.LongLength
            $res.OutputStream.Write($body, 0, $body.Length)
        }
    } catch {
        Write-Host "ERROR: $_"
        try { $res.StatusCode = 500 } catch {}
    } finally {
        try { $res.OutputStream.Close() } catch {}
    }
}
