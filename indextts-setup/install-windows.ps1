# =============================================================
#  IndexTTS Windows 一键安装脚本
#  用法：右键 → "使用 PowerShell 运行"
#       或管理员 PowerShell 执行：
#       Set-ExecutionPolicy Bypass -Scope Process -Force
#       .\install-windows.ps1
# =============================================================

param(
    [string]$InstallDir = "C:\IndexTTS"
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "IndexTTS 安装程序"

function Write-Step($msg) {
    Write-Host "`n>>> $msg" -ForegroundColor Cyan
}
function Write-OK($msg) {
    Write-Host "    [OK] $msg" -ForegroundColor Green
}
function Write-Warn($msg) {
    Write-Host "    [!]  $msg" -ForegroundColor Yellow
}
function Write-Fail($msg) {
    Write-Host "    [X]  $msg" -ForegroundColor Red
}

Write-Host @"
╔══════════════════════════════════════════════╗
║        IndexTTS Windows 安装程序             ║
║   语音克隆 & 零样本语音合成  by Bilibili     ║
╚══════════════════════════════════════════════╝
安装目录: $InstallDir
"@ -ForegroundColor Magenta

# ── 1. 检查 Python ──────────────────────────────────────────
Write-Step "检查 Python 版本（需要 3.10 ~ 3.12）"
$pyCmd = $null
foreach ($cmd in @("python", "python3", "py")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match "3\.(1[012])") {
            $pyCmd = $cmd
            Write-OK "$ver"
            break
        }
    } catch {}
}
if (-not $pyCmd) {
    Write-Fail "未找到 Python 3.10/3.11/3.12，请先安装："
    Write-Host "    https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "    安装时勾选「Add Python to PATH」" -ForegroundColor Yellow
    Pause; exit 1
}

# ── 2. 检查 / 安装 Git ──────────────────────────────────────
Write-Step "检查 Git"
try {
    $gitVer = git --version 2>&1
    Write-OK $gitVer
} catch {
    Write-Warn "未找到 Git，正在通过 winget 安装..."
    winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# ── 3. 检查 / 安装 uv ───────────────────────────────────────
Write-Step "检查 uv（Python 包管理器）"
$uvOk = $false
try {
    $uvVer = uv --version 2>&1
    if ($uvVer -match "uv") { $uvOk = $true; Write-OK $uvVer }
} catch {}
if (-not $uvOk) {
    Write-Warn "未找到 uv，正在安装..."
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $env:PATH = "$env:USERPROFILE\.local\bin;" + $env:PATH
    Write-OK "uv 安装完成"
}

# ── 4. Clone IndexTTS 源码 ─────────────────────────────────
Write-Step "下载 IndexTTS 代码"
if (Test-Path "$InstallDir\.git") {
    Write-OK "目录已存在，跳过克隆，执行 git pull..."
    Set-Location $InstallDir
    git pull --ff-only
} else {
    if (Test-Path $InstallDir) {
        Write-Warn "目录存在但不是 git 仓库，将清空并重新克隆"
        Remove-Item $InstallDir -Recurse -Force
    }
    git clone https://github.com/index-tts/index-tts.git $InstallDir
    Set-Location $InstallDir
    Write-OK "克隆完成"
}

# ── 5. 安装 Python 依赖（含 WebUI）─────────────────────────
Write-Step "安装 Python 依赖（首次约 5-10 分钟，需下载 PyTorch+CUDA）"
Write-Warn "Windows 将自动使用 CUDA 版 PyTorch；若无 NVIDIA 显卡请忽略警告"
uv sync --extra webui
Write-OK "依赖安装完成"

# ── 6. 下载模型文件（~5.5 GB）──────────────────────────────
Write-Step "下载 IndexTTS2 模型文件（约 5.5 GB，请耐心等待）"
$ckptDir = Join-Path $InstallDir "checkpoints"
$modelMark = Join-Path $ckptDir ".download_complete"

if (Test-Path $modelMark) {
    Write-OK "模型已下载，跳过"
} else {
    New-Item -ItemType Directory -Force -Path $ckptDir | Out-Null
    Write-Warn "优先从 ModelScope 下载（国内速度更快）..."
    try {
        uv run python -c @"
from modelscope import snapshot_download
import sys
try:
    snapshot_download('IndexTeam/IndexTTS-2', local_dir=r'$ckptDir')
    print('ModelScope 下载成功')
except Exception as e:
    print(f'ModelScope 失败: {e}', file=sys.stderr)
    sys.exit(1)
"@
        New-Item $modelMark -ItemType File -Force | Out-Null
        Write-OK "模型下载完成（ModelScope）"
    } catch {
        Write-Warn "ModelScope 失败，切换到 HuggingFace..."
        uv run huggingface-cli download IndexTeam/IndexTTS-2 --local-dir $ckptDir
        New-Item $modelMark -ItemType File -Force | Out-Null
        Write-OK "模型下载完成（HuggingFace）"
    }
}

# ── 7. 写入 start.bat ──────────────────────────────────────
Write-Step "生成启动脚本 start.bat"
$startBat = @"
@echo off
cd /d "%~dp0"
set NO_PROXY=localhost,127.0.0.1
set PYTHONUNBUFFERED=1

if not exist logs mkdir logs
set LOG_FILE=logs\webui_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%.log
set LOG_FILE=%LOG_FILE: =0%

echo [%date% %time%] 启动 IndexTTS WebUI，日志: %LOG_FILE%
:loop
uv run python webui.py 2>&1 | tee "%LOG_FILE%"
echo [%date% %time%] 进程退出，3 秒后自动重启...
timeout /t 3 /nobreak >nul
goto loop
"@
Set-Content -Path "$InstallDir\start.bat" -Value $startBat -Encoding UTF8
Write-OK "start.bat 已生成"

# ── 8. 创建桌面快捷方式 ─────────────────────────────────────
Write-Step "创建桌面快捷方式"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$env:USERPROFILE\Desktop\IndexTTS.lnk")
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/c `"$InstallDir\start.bat`""
$shortcut.WorkingDirectory = $InstallDir
$shortcut.WindowStyle = 1
$shortcut.IconLocation = "%SystemRoot%\System32\shell32.dll,168"
$shortcut.Description = "启动 IndexTTS 语音合成服务"
$shortcut.Save()
Write-OK "桌面快捷方式已创建"

# ── 完成 ────────────────────────────────────────────────────
Write-Host @"

╔══════════════════════════════════════════════╗
║            安装完成！                        ║
╠══════════════════════════════════════════════╣
║  启动方式：                                  ║
║    双击桌面「IndexTTS」快捷方式              ║
║    或运行：$InstallDir\start.bat
║                                              ║
║  服务启动后访问：http://localhost:7860        ║
║  在协作系统侧边栏点击「语音合成」即可使用    ║
╚══════════════════════════════════════════════╝
"@ -ForegroundColor Green

Pause
