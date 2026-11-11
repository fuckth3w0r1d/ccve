# <target> <component> <vulnerability class>

> 占位符：`<target>` 目标名，`<component>` 组件名，`<distro>` 发行版标签（如 `bookworm`、`noble`），`<port>` 服务端口，`<hostport>` 宿主上用 127.0.0.1 暴露的端口。

<一段话：缺陷是什么、影响哪些版本、攻击者拿到什么。>

## Reproduce

```sh
sh poc-<distro>/run.sh
```

`CMD` 可替换在目标容器内执行的命令：

```sh
CMD='id' sh poc-<distro>/run.sh
```

## Contents

| 路径 | 内容 |
| --- | --- |
| `docs/report.md` | 完整分析：漏洞成因、影响、利用分析、修复建议 |
| `docs/report-en.md` | 英文版 |
| `poc-<distro>/` | 该发行版的镜像与利用脚本 |
| `img/` | 复现截图 |
