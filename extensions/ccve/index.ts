import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const read = (name: string) => fs.readFileSync(path.join(import.meta.dir, name), "utf8");

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		if (!pi.getActiveTools().includes("goal")) {
			await pi.setActiveTools([...pi.getActiveTools(), "goal"]);
		}
	});

	pi.registerCommand("ccve", {
		description: "Start CVE hunting on a self-chosen target",

		handler: async () => {
			pi.sendUserMessage(
				[
					"先建 goal，再开始工作。第一步只做一件事：调用 `goal` 工具，`op` 为 `create`，`objective` 填下面的《任务要求》全文。其余的选目标、建目录都在 goal 建好之后做。",
					"",
					"# 任务要求",
					"",
					read("brief.md"),
				].join("\n"),
			);
		},
	});

	pi.registerCommand("ppoc", {
		description: "Package a verified exploit chain into the poc repo",

		handler: async () => {
			pi.sendUserMessage(
				[
					"把已经验证过的利用链打包。目标从当前会话的 work/ 目录取，先读 journal.md 与 notes/ 确认结论。",
					"",
					"# 打包要求",
					"",
					read("pack.md"),
				].join("\n"),
			);
		},
	});
}
