# 轻量服务器基础设施（Caddy + Uptime Kuma + Redis + Webhook 中继）

本目录实现「分阶段搭建计划」中的可部署资产：在服务器 `/opt/infra` 用 Docker Compose 一键拉起，Caddy 自动 HTTPS，子域名示例：

- `status.megami-tech.com` → Uptime Kuma  
- `hook.megami-tech.com` → Webhook 中继（Redis 队列 + 重试转发企微机器人）

## 前置条件

1. 泛域名或单独 A 记录指向服务器公网 IP（如 `status`、`hook` → `122.51.219.134`）。
2. 腾讯云轻量 **防火墙** 放行 **80、443**（22 仅管理 IP）。
3. 服务器 Ubuntu，可 `sudo`。

## 部署到 /opt/infra（顺序不能乱）

### 0a）一键从 Mac 同步并安装（推荐）

在你**自己的电脑**上（已能 `ssh root@服务器IP` 登录）：

```bash
cd /path/to/issue-tracker/deploy/infra
chmod +x bootstrap-remote.sh
REMOTE_HOST=122.51.219.134 REMOTE_USER=root ./bootstrap-remote.sh
```

第一次运行若自动生成了 `/opt/infra/.env`，请按提示 SSH 上去改好三个变量后**再执行一次**同一脚本。

### 0b）或手动把本仓库的 `deploy/infra` 拷到服务器

**空目录里不会有 `install-docker.sh`。** 任选一种方式：

**A. 在你自己的电脑上执行（推荐）** — 把本地 `issue-tracker/deploy/infra` 同步到服务器：

```bash
# 在 Mac 上，进入仓库里的 deploy/infra 目录后执行（把 root@你的服务器IP 换成实际）
rsync -avz --delete ./ root@122.51.219.134:/opt/infra/
```

或用 `scp`：

```bash
cd /path/to/issue-tracker/deploy
scp -r infra root@122.51.219.134:/opt/infra-tmp
# 再到服务器上: sudo rm -rf /opt/infra/* && sudo mv /opt/infra-tmp/* /opt/infra/
```

**B. 在服务器上 `git clone` 仓库**（需服务器能访问 Git 远程）：

```bash
sudo mkdir -p /opt/infra
sudo git clone --depth 1 <你的仓库HTTPS或SSH地址> /tmp/issue-tracker
sudo cp -a /tmp/issue-tracker/deploy/infra/. /opt/infra/
sudo rm -rf /tmp/issue-tracker
```

**拷完后在服务器上检查**（应能看到 `docker-compose.yml`、`install-docker.sh`）：

```bash
ls -la /opt/infra
```

### 1）安装 Docker

```bash
cd /opt/infra
sudo chmod +x install-docker.sh backup/scripts/backup.sh scripts/ufw-harden.sh
sudo bash install-docker.sh
# 若脚本不存在，说明第 0 步没做对；也可直接用官方脚本：
# curl -fsSL https://get.docker.com | sudo sh
# 重新登录 SSH 后 docker 组生效（若脚本把你的用户加入了 docker 组）
```

### 2）环境变量并启动

```bash
cd /opt/infra
sudo cp .env.example .env
sudo chmod 600 .env
sudo nano .env   # 填写 CADDY_EMAIL、REDIS_PASSWORD、WECOM_WEBHOOK_URL
sudo docker compose build webhook-relay
sudo docker compose up -d
```

### 常见错误

| 现象 | 原因 |
|------|------|
| `install-docker.sh: No such file or directory` | `/opt/infra` 里还没有同步仓库里的 `deploy/infra` 文件 |
| `cp: cannot stat '.env.example'` | 同上，或当前目录不是 `/opt/infra` |
| `docker: command not found` | 尚未安装 Docker，先完成第 1 步 |
| `dial tcp ... registry-1.docker.io ... i/o timeout` | 国内访问 Docker Hub 不稳定，在服务器执行 `sudo bash /opt/infra/scripts/apply-docker-mirror-cn.sh` 后重试 `docker compose pull` |
| `webhook-relay` 用 `image: node:22-alpine` 直接跑 `server.mjs` | 粘贴的 compose 不完整；应使用仓库里的 `build: ./webhook`，并从本机 `rsync` 完整 `deploy/infra`（含 `webhook/package-lock.json`） |

### 国内拉镜像失败（Docker Hub 超时）

在服务器上：

```bash
sudo bash /opt/infra/scripts/apply-docker-mirror-cn.sh
cd /opt/infra && sudo docker compose pull && sudo docker compose up -d --build
```

若仍失败，在腾讯云控制台确认轻量实例的**公网带宽**正常，或稍后重试。

查看状态：

```bash
sudo docker compose ps
sudo docker compose logs -f caddy
```

首次访问 `https://status.megami-tech.com` 创建 Kuma 管理员账号。监控项见 [UPTIME_MONITORS.md](./UPTIME_MONITORS.md)。

## 本机防火墙（UFW，可选）

**务必先设置 `YOUR_SSH_IP`，避免把自己锁在 SSH 外。**

```bash
cd /opt/infra/scripts
sudo YOUR_SSH_IP=你的公网IP bash ufw-harden.sh
```

Squid **3128** 请按实际出口 IP 单独 `ufw allow from <CIDR> to any port 3128`，勿对全网开放。

## Webhook 中继用法

- 健康检查：`GET https://hook.megami-tech.com/health`
- 入队转发：`POST https://hook.megami-tech.com/relay/wecom`  
  Body：与直接调用企微机器人 Webhook 相同的 JSON（如 `{"msgtype":"text","text":{"content":"hi"}}`）

应用侧把原来的机器人 URL 换成 `https://hook.megami-tech.com/relay/wecom` 即可经队列异步投递（带 3 次指数退避重试）。

## 自动备份

依赖：`/opt/infra/.env` 中存在 `REDIS_PASSWORD`，且容器名为 `infra-redis`（与本 `docker-compose.yml` 一致）。

```bash
sudo crontab -e
# 每天 03:00
0 3 * * * INFRA_ROOT=/opt/infra /opt/infra/backup/scripts/backup.sh >> /var/log/infra-backup.log 2>&1
```

备份输出：`/opt/infra/backup/output/`，默认保留 30 天（`KEEP_DAYS` 可改）。

## 目录说明

| 路径 | 说明 |
|------|------|
| `docker-compose.yml` | 编排 |
| `caddy/Caddyfile` | 反向代理与 TLS |
| `uptime-kuma/data` | Kuma 持久化 |
| `redis/data` | Redis RDB |
| `webhook/` | 中继服务源码与镜像构建 |
| `backup/scripts/backup.sh` | 备份脚本 |

## 与现有 Squid 的关系

Squid 若仍监听宿主机 **3128**，与本栈 **80/443** 无端口冲突。Caddy 仅在 Docker 映射 80/443；若宿主机已有 Nginx 占 80/443，需停掉其一或改 Caddy 映射端口。
