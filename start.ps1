$BrowserExecutable = "$PSScriptRoot\chromium-win\chrome.exe"
$SessionDir = "$PSScriptRoot\browser-session"

if (-not (Test-Path $BrowserExecutable)) {
    Write-Error "Bundled portable Chrome not found in \chromium-win\"
    exit
}

# Quickly test if port 9222 is already open
$isPortOpen = $false
try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $tcpClient.Connect("127.0.0.1", 9222)
    $isPortOpen = $true
    $tcpClient.Close()
} catch {
    $isPortOpen = $false
}

if ($isPortOpen) {
    Write-Host "Existing Chromium session detected on port 9222. Attaching to it..."
} else {
    Write-Host "Launching Portable Chrome on debugging port 9222..."
    Start-Process $BrowserExecutable -ArgumentList "--remote-debugging-port=9222", "--remote-allow-origins=*", "--user-data-dir=`"$SessionDir`""
    
    Write-Host "1. Log into Cengage in the new browser window."
    Write-Host "2. Open the MindTap textbook."
    Write-Host "3. Navigate to the first page you want to download."
}

Read-Host "Press ENTER in this window when you are ready to start the extraction"

Write-Host "Starting Docker container and executing Playwright..."
docker run -it --rm --add-host=host.docker.internal:host-gateway -v "$PSScriptRoot`:/app" -w /app node:24-slim sh -c "npm install && node downloader.js"