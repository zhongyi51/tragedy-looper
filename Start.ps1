param([switch]$Offline, [int]$Port = 4317)
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeExecutable = $nodeCommand.Source }
else {
    $nodeExecutable = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw '需要 Node.js 24 或更新版本。' }
}
$previousKey = $env:DEEPSEEK_API_KEY
$previousPort = $env:PORT
$locationPushed = $false
try {
    if ($Offline) { $env:DEEPSEEK_API_KEY = '' }
    elseif (-not $env:DEEPSEEK_API_KEY) {
        $secret = Read-Host 'DeepSeek API Key（隐藏输入；直接回车使用离线练习模式）' -AsSecureString
        if ($secret.Length -gt 0) {
            $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
            try { $env:DEEPSEEK_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
        }
    }
    $env:PORT = [string]$Port
    Push-Location $PSScriptRoot
    $locationPushed = $true
    Write-Host "浏览器打开 http://127.0.0.1:$Port 。关闭服务请按 Ctrl+C。"
    & $nodeExecutable 'src/server.mjs'
}
finally {
    $env:DEEPSEEK_API_KEY = $previousKey
    $env:PORT = $previousPort
    if ($secret) { $secret.Dispose() }
    if ($locationPushed) { Pop-Location }
}
