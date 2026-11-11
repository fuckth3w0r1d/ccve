# CCVE

用 [oh-my-pi](https://github.com/can1357/oh-my-pi)（`omp`）在单台 VPS 上并行挖掘多个 CVE 的工作流。一个目标一个会话，会话跑在 goal 模式下自己推进，产出对齐 CNA 审核格式的 PoC 仓库。

## 结构

```
extensions/ccve/         /ccve 命令与任务说明 brief.md
tools/container.ts       调试容器工具，管起停与命令执行
skills/                  五个审计技能
images/debug/            调试镜像，每个发行版一份 Dockerfile
templates/poc/           产出仓库骨架
bin/install              软链技能、工具、扩展，构建镜像
bin/web                  起停 ompweb 的会话宿主与 web 服务
board.md                 已挖掘目标，开工前读
work/<target>/           每个目标的工作目录
```

`work/<target>/` 下分 `state.md`（当前假设与下一步）、`journal.md`（时间线）、`src/`（源码与二进制）、`env/`（复现容器定义）、`notes/`（撞车检查与发现）、`exp/`（利用脚本）、`logs/`。

产出写到与 `ccve` 同级的 `pocs/<target>/`，结构见 `templates/poc/`。

## 部署

Ubuntu 24.04，4 核 8G 起。

```sh
sudo apt install -y docker.io docker-compose-v2 git curl
curl -fsSL https://omp.sh/install | sh -s -- --binary
npm install -g @kahme247/ompweb

git clone <this-repo> ~/project/ccve
cd ~/project/ccve
bin/install
```

`omp` 用预编译二进制，不依赖 JS 运行时。装完跑一次 `omp` 完成模型供应商授权，凭据落在 `~/.omp/agent/agent.db`。

`bin/install` 会构建各发行版的调试镜像：`ccve-debug:ubuntu-26.04`、`ubuntu-24.04`、`debian-13`、`debian-12`，每个约 700MB，镜像里带的是该发行版自己的 libc。

把配置写进 `~/.omp/agent/config.yml`：

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

`goal.continuationModes` 必须含 `rpc`，ompweb 用 RPC 模式起会话，不加这一项 goal 跑完一轮就停。

## 使用

```sh
bin/web
```

拉起 `ompweb host` 与 web 服务，后者监听 `127.0.0.1:30177`。从本地访问走 SSH 隧道：

```sh
ssh -L 30177:127.0.0.1:30177 <vps>
```

浏览器打开 `http://localhost:30177`，在 ccve 目录新建会话，输入框执行 `/ccve`。

会话进入 goal 模式，自己选目标、建 `work/<target>/`、做撞车检查、起调试容器、开始挖掘。关掉浏览器或断开 SSH 都不影响，`ompweb host` 持有会话进程。

任务结束要收摊：

```sh
bin/web stop
```

它停掉 `ompweb host` 与 web 服务，前者是所有 omp 进程的父进程，所以会话一并终止。调试容器独立于 omp，按需清理：

```sh
docker ps -a --filter label=ccve.id -q | xargs -r docker rm -f
```

一个目标占调试容器 1.5 核 2G 加复现容器 1 核 1G，4 核机器上并发两个目标是上限。
