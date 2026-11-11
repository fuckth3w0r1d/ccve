# CCVE

用 [oh-my-pi](https://github.com/can1357/oh-my-pi)（`omp`）在一台 VPS 上并行挖掘多个 CVE 的工作流。一个目标一个会话，会话跑在 goal 模式下自己往下走，产出对齐 CNA 审核格式的 PoC 仓库。

这套东西不实现 agent，也不实现 web UI——它们用现成的。这里只有让 omp 对准"挖 CVE"这件事所需的那部分：任务说明、一个容器工具、五个审计技能、一个调试镜像、一份产出模板。

## 需要什么

一台 Ubuntu 24.04 的 VPS，4 核 8G 起。另需：

```sh
sudo apt install -y docker.io docker-compose-v2 git curl
curl -fsSL https://omp.sh/install | sh -s -- --binary
npm install -g @kahme247/ompweb
```

`omp` 用预编译二进制，不依赖 JS 运行时。`ompweb` 是社区为 omp 写的 web UI，负责在后台持有会话。

装完跑一次 `omp`，完成模型供应商授权。凭据落在 `~/.omp/agent/agent.db`。

## 装

```sh
git clone <this-repo> ~/project/ccve
cd ~/project/ccve
bin/install
```

`bin/install` 做三件事：把技能软链到 `~/.omp/agent/skills/`，把 `container` 工具软链到 `~/.omp/agent/tools/`，把 `/ccve` 命令软链到 `~/.omp/agent/extensions/`，然后构建调试镜像 `ccve-debug`。

还需要把下面的配置写进 `~/.omp/agent/config.yml`：

```yaml
goal:
  enabled: true
  continuationModes:
    - interactive
    - rpc
task:
  maxConcurrency: 4
  workerThreads: 2
startup:
  checkUpdate: false
tools:
  approvalMode: yolo
```

`goal.continuationModes` 必须含 `rpc`，否则 goal 跑完一轮就停——ompweb 用 RPC 模式起会话。

## 用

```sh
bin/web
```

拉起 `ompweb host`（会话宿主）和 web 服务。从本地访问走 SSH 隧道，VPS 不开入站端口：

```sh
ssh -L 30177:127.0.0.1:30177 <vps>
```

浏览器打开 `http://localhost:30177`，在 ccve 目录新建会话，输入框执行：

```
/ccve
```

会话进入 goal 模式，自己选目标、建 `work/<target>/`、做撞车检查、绑定调试容器、开始挖掘。产出写到同级的 `pocs/<target>/`。

关掉浏览器不影响挖掘，断开 SSH 也不影响——`ompweb host` 持有会话进程。

## 结构

```
AGENTS.md                常驻规则，会话启动自动加载
extensions/ccve/         /ccve 命令与任务说明
tools/container.ts       调试容器工具
skills/                  五个审计技能
images/debug/Dockerfile  调试镜像：gdb、pwndbg、pwntools、ROPgadget 等
templates/poc/           产出骨架
bin/install              安装
bin/web                  起 web UI
board.md                 已挖掘目标，开工前读
work/<target>/           每个目标的工作目录
```

`work/<target>/` 里的内容：

```
state.md     当前假设、已排除的方向、下一步
journal.md   时间线，只追加
src/         上游或发行版源码
env/         目标容器的 Dockerfile 与 compose
notes/       撞车检查、发现、利用链
exp/         利用脚本
logs/        容器日志、core、复现输出
```

## 工作流

1. **选目标** — 按 `extensions/ccve/brief.md` 里的硬性门槛筛：仍在维护、有 CNA 上报渠道、有网络输入入口、核心逻辑在 native 代码。
2. **撞车检查** — 检索 NVD、上游 issue、发行版公告、公开披露，确认这个方向还没人报过。
3. **建环境** — 在 `env/` 里写目标容器，从发行版官方源装包，覆盖 Debian、Ubuntu、Fedora、AlmaLinux 等主线版本。
4. **审计与利用** — 源码审计定位缺陷，在调试容器里把它做成可用的利用链。
5. **验收** — ASLR/PIE 等保护保持发行版默认值，二进制来自官方源包，攻击者只需能连上端口，重建容器后跑两次都成功。
6. **产出** — 按 `templates/poc/` 输出 README 与中英双份 report。

## 调试容器

`container` 工具管一个目标的调试容器，挂载 `work/<target>` 到同一绝对路径，以宿主 UID 运行，所以容器里写的文件就是宿主上的那些文件。文件读写用 omp 原生的工具，只有执行需要进容器。

| op | 用途 |
| --- | --- |
| `bind` | 绑定目标，每个会话一次 |
| `exec` | 跑命令，`timeout` 按秒 |
| `run` | 重建 |
| `stop` / `rm` | 停止 / 删除 |
| `ls` | 列出 ccve 容器 |

## 产出格式

```
README.md            一段话概述 + 怎么跑 + 目录说明
docs/report.md       完整分析，中文
docs/report-en.md    英文
poc-<distro>/        该发行版的镜像与利用脚本
img/                 复现截图
```

report 四个板块：漏洞成因、影响、利用分析、修复建议。

## 性能

一个目标占调试容器 1.5 核 2G 加目标容器 1 核 1G。4 核机器上并发两个目标是上限。
