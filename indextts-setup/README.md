# IndexTTS 安装包

> 本目录包含在 **Windows** 和 **macOS** 上一键安装、启动 IndexTTS 语音合成服务所需的全部脚本。
> 安装完成后，在米伽米协作系统侧边栏点击「语音合成」即可使用。

---

## 文件说明

| 文件 | 用途 |
|------|------|
| `install-windows.ps1` | Windows 一键安装脚本（自动安装依赖 + 下载模型） |
| `install-mac.sh` | macOS 一键安装脚本（自动安装依赖 + 下载模型） |
| `start.bat` | Windows 启动脚本（安装后复制到 IndexTTS 目录使用） |
| `start.sh` | macOS 启动脚本（安装后复制到 IndexTTS 目录使用） |

---

## 系统要求

| 项目 | Windows | macOS |
|------|---------|-------|
| 操作系统 | Windows 10 / 11 (64位) | macOS 12+ |
| Python | 3.10 / 3.11 / 3.12 | 3.10 / 3.11 / 3.12 |
| 显卡（推荐） | NVIDIA GPU (CUDA 12.x) | 无要求（CPU 推理） |
| 磁盘空间 | 约 10 GB（代码 + 模型 + 依赖） | 约 10 GB |
| 内存 | 8 GB+ | 8 GB+ |
| 网络 | 首次安装需下载约 5.5 GB 模型 | 同左 |

---

## Windows 安装步骤

### 前置条件

1. 安装 **Python 3.10 ~ 3.12**（勾选「Add Python to PATH」）
   👉 https://www.python.org/downloads/

2. 安装 **Git for Windows**
   👉 https://git-scm.com/download/win

### 一键安装

1. 下载本分支：点击右上角 **Code → Download ZIP**，解压
2. 进入解压目录，**右键** `install-windows.ps1` → **「使用 PowerShell 运行」**
   - 如果弹出权限提示，以管理员身份打开 PowerShell，粘贴执行：
     ```powershell
     Set-ExecutionPolicy Bypass -Scope Process -Force
     .\install-windows.ps1
     ```
3. 脚本会自动完成：
   - 安装 `uv` 包管理器
   - 克隆 IndexTTS 源码到 `C:\IndexTTS`
   - 安装所有 Python 依赖（含 PyTorch CUDA 版）
   - 从 ModelScope 下载 5.5 GB 模型文件
   - 生成桌面快捷方式

> **安装时长**：首次约 20~60 分钟（取决于网速和下载渠道）

### 启动服务

- 双击桌面 **「IndexTTS」** 快捷方式
- 或在 `C:\IndexTTS` 目录双击 `start.bat`
- 看到 `Running on local URL: http://localhost:7860` 即启动成功

---

## macOS 安装步骤

### 前置条件

1. 安装 **Python 3.10 ~ 3.12**（推荐 Homebrew）：
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install python@3.11
   ```

### 一键安装

```bash
# 1. 下载脚本（或 git clone 本仓库后进入目录）
# 2. 添加执行权限并运行
chmod +x install-mac.sh
./install-mac.sh
```

脚本会自动完成：
- 检查 Python / Git 环境
- 安装 `uv` 包管理器
- 克隆 IndexTTS 源码到 `~/IndexTTS`
- 安装所有 Python 依赖（CPU 版 PyTorch）
- 从 ModelScope 下载 5.5 GB 模型文件
- 生成 `start.sh` 启动脚本

> **安装时长**：首次约 20~60 分钟

### 启动服务

```bash
~/IndexTTS/start.sh
```

看到 `Running on local URL: http://localhost:7860` 即启动成功。

---

## 在协作系统中使用

服务启动后：
1. 打开 [米伽米协作系统](https://tracker.megami-tech.com)
2. 侧边栏点击 **「语音合成」**
3. 系统会自动检测本机服务状态，就绪后直接使用

---

## 常见问题

### Q: 安装时提示 "git 不是内部命令"
**A（Windows）**：请先安装 Git for Windows，安装后重新打开 PowerShell。

### Q: 模型下载失败 / 速度很慢
**A**：脚本会自动从 ModelScope（国内）或 HuggingFace（国际）下载。
如果两者都慢，可手动到 ModelScope 下载：
👉 https://modelscope.cn/models/IndexTeam/IndexTTS-2
下载所有文件放到安装目录的 `checkpoints/` 文件夹。

### Q: 启动后访问 localhost:7860 没有响应
**A**：模型加载需要 30~90 秒，等待片刻后刷新页面。

### Q: Windows 提示 "无法加载文件，脚本已禁用"
**A**：以管理员身份打开 PowerShell，执行：
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
```

### Q: 想更改安装目录
**A（Windows）**：
```powershell
.\install-windows.ps1 -InstallDir "D:\MyIndexTTS"
```
**A（macOS）**：
```bash
INDEXTTS_DIR="$HOME/Desktop/IndexTTS" ./install-mac.sh
```

### Q: 之后重新启动服务
每次重启电脑后，需要再次运行启动脚本：
- Windows：双击桌面快捷方式或 `C:\IndexTTS\start.bat`
- macOS：`~/IndexTTS/start.sh`

---

## 技术信息

- **来源项目**：[index-tts/index-tts](https://github.com/index-tts/index-tts)（B站 IndexTTS 团队）
- **模型版本**：IndexTTS 2.0
- **依赖管理**：[uv](https://docs.astral.sh/uv/)
- **Web 框架**：Gradio 5.x，运行在 `http://localhost:7860`
- **模型下载源**：[ModelScope](https://modelscope.cn/models/IndexTeam/IndexTTS-2) / [HuggingFace](https://huggingface.co/IndexTeam/IndexTTS-2)
