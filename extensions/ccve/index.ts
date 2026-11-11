import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const BRIEF = path.join(import.meta.dir, "brief.md");

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		if (!pi.getActiveTools().includes("goal")) {
			await pi.setActiveTools([...pi.getActiveTools(), "goal"]);
		}
	});

	pi.registerCommand("ccve", {
		description: "Start a CVE hunting session: enter goal mode and begin work",

		handler: async () => {
			pi.sendUserMessage(
				[
					"先建 goal，再开始工作。第一步只做一件事：调用 `goal` 工具，`op` 为 `create`，`objective` 填下面的《任务要求》全文。其余的读文件、选目标、建目录都在 goal 建好之后做。",
					"",
					"# 任务要求",
					"",
					fs.readFileSync(BRIEF, "utf8"),
				].join("\n"),
			);
		},
	});
}
