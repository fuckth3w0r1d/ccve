# CCVE

工作根目录。每个会话挖掘一个目标，目标内容写进 `work/<target>/`，产出写进同级的 `pocs/<target>/`。

多会话并行时各做各的，不读写其他目标的 `work/` 目录。

## 目录

- `work/<target>/` — 当前目标的全部工作内容。
- `pocs/<target>/` — 产出仓库，从 `templates/poc/` 复制。
- `board.md` — 已挖掘目标。
- `extensions/`、`skills/`、`templates/`、`images/` — 框架本身。

## 容器

调试容器用 `container` 工具，不要手写 `docker exec`。目标容器是另一回事，用 shell 起，定义在 `env/`，加 `--cpus 1 --memory 1g`、`--label ccve.target=<target>`，端口绑 `127.0.0.1`。

## 记录

阶段结论写进文件，只在会话里说等于没做。每完成一个阶段覆盖 `state.md`，向 `journal.md` 追加一条。
