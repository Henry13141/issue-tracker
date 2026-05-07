#!/bin/bash
# =============================================================
#  IndexTTS macOS 一键安装脚本
#  用法：打开终端，cd 到本脚本所在目录，执行：
#       chmod +x install-mac.sh && ./install-mac.sh
# =============================================================

set -e

INSTALL_DIR="${INDEXTTS_DIR:-$HOME/IndexTTS}"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

step()  { echo -e "\n${CYAN}>>> $*${NC}"; }
ok()    { echo -e "    ${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "    ${YELLOW}[!] ${NC} $*"; }
fail()  { echo -e "    ${RED}[X] ${NC} $*"; exit 1; }

echo -e "${YELLOW}
╔══════════════════════════════════════════════╗
║        IndexTTS macOS 安装程序               ║
║   语音克隆 & 零样本语音合成  by Bilibili     ║
╚══════════════════════════════════════════════╝
安装目录: $INSTALL_DIR
${NC}"

# ── 1. 检查 Python ──────────────────────────────────────────
step "检查 Python 版本（需要 3.10 ~ 3.12）"
PY_CMD=""
for cmd in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$cmd" &>/dev/null; then
        ver=$($cmd --version 2>&1 | grep -oE "3\.(1[012])\.[0-9]+")
        if [ -n "$ver" ]; then
            PY_CMD="$cmd"
            ok "$cmd $ver"
            break
        fi
    fi
done
if [ -z "$PY_CMD" ]; then
    fail "未找到 Python 3.10/3.11/3.12\n请安装：https://www.python.org/downloads/\n或使用 Homebrew：brew install python@3.11"
fi

# ── 2. 检查 / 安装 Homebrew（可选，仅用于安装 git）─────────
step "检查 Git"
if ! command -v git &>/dev/null; then
    warn "未找到 git，尝试安装 Xcode Command Line Tools..."
    xcode-select --install 2>/dev/null || true
    sleep 3
    if ! command -v git &>/dev/null; then
        fail "请手动安装 git：https://git-scm.com/"
    fi
fi
ok "$(git --version)"

# ── 3. 检查 / 安装 uv ───────────────────────────────────────
step "检查 uv（Python 包管理器）"
if ! command -v uv &>/dev/null; then
    warn "未找到 uv，正在安装..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    # 写入 shell 配置
    for RC in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
        [ -f "$RC" ] && grep -q '.local/bin' "$RC" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$RC"
    done
fi
ok "$(uv --version)"

# ── 4. Clone IndexTTS 源码 ─────────────────────────────────
step "下载 IndexTTS 代码"
if [ -d "$INSTALL_DIR/.git" ]; then
    ok "目录已存在，执行 git pull..."
    cd "$INSTALL_DIR" && git pull --ff-only
else
    [ -d "$INSTALL_DIR" ] && { warn "目录存在但非 git 仓库，清空重建..."; rm -rf "$INSTALL_DIR"; }
    git clone https://github.com/index-tts/index-tts.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    ok "克隆完成"
fi
cd "$INSTALL_DIR"

# ── 5. 安装 Python 依赖（含 WebUI）─────────────────────────
step "安装 Python 依赖（首次约 5-10 分钟）"
warn "macOS 使用 CPU 版 PyTorch（无 CUDA），推理速度较 Windows NVIDIA 慢"
uv sync --extra webui
ok "依赖安装完成"

# ── 6. 下载模型文件（~5.5 GB）──────────────────────────────
step "下载 IndexTTS2 模型文件（约 5.5 GB，请耐心等待）"
CKPT_DIR="$INSTALL_DIR/checkpoints"
MARK="$CKPT_DIR/.download_complete"

if [ -f "$MARK" ]; then
    ok "模型已下载，跳过"
else
    mkdir -p "$CKPT_DIR"
    warn "优先从 ModelScope 下载（国内速度更快）..."
    if uv run python -c "
from modelscope import snapshot_download
try:
    snapshot_download('IndexTeam/IndexTTS-2', local_dir='$CKPT_DIR')
    print('ModelScope 下载成功')
except Exception as e:
    import sys; print(f'失败: {e}', file=sys.stderr); sys.exit(1)
" 2>/dev/null; then
        touch "$MARK"
        ok "模型下载完成（ModelScope）"
    else
        warn "ModelScope 失败，切换到 HuggingFace..."
        uv run huggingface-cli download IndexTeam/IndexTTS-2 --local-dir "$CKPT_DIR"
        touch "$MARK"
        ok "模型下载完成（HuggingFace）"
    fi
fi

# ── 7. 写入 start.sh ───────────────────────────────────────
step "生成启动脚本 start.sh"
cat > "$INSTALL_DIR/start.sh" << 'STARTSCRIPT'
#!/bin/bash
cd "$(dirname "$0")"
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
export PYTHONUNBUFFERED=1

LOG_DIR="$(dirname "$0")/logs"
mkdir -p "$LOG_DIR"

while true; do
    LOG_FILE="$LOG_DIR/webui_$(date +%Y%m%d_%H%M%S).log"
    echo "$(date): 启动 IndexTTS WebUI，日志: $LOG_FILE"
    uv run python -u webui.py 2>&1 | tee "$LOG_FILE"
    EXIT_CODE=${PIPESTATUS[0]}
    echo "$(date): 进程退出（退出码 $EXIT_CODE），3 秒后自动重启..."
    sleep 3
done
STARTSCRIPT
chmod +x "$INSTALL_DIR/start.sh"
ok "start.sh 已生成"

# ── 完成 ────────────────────────────────────────────────────
echo -e "${GREEN}
╔══════════════════════════════════════════════╗
║            安装完成！                        ║
╠══════════════════════════════════════════════╣
║  启动方式：                                  ║
║    $INSTALL_DIR/start.sh
║                                              ║
║  服务启动后访问：http://localhost:7860        ║
║  在协作系统侧边栏点击「语音合成」即可使用    ║
╚══════════════════════════════════════════════╝
${NC}"
