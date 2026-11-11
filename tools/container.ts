import * as fs from "node:fs";
import * as path from "node:path";
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";

const TAIL_LINES = 200;
const DEFAULT_TIMEOUT_SECONDS = 600;
const BIND_ENTRY = "ccve.target";

function tail(text: string, lines: number): string {
	const all = text.split("\n");
	if (all.length <= lines) return text.trim();
	return `...(${all.length - lines} lines omitted; redirect to logs/ for the full output)\n${all.slice(-lines).join("\n")}`;
}

function workRoot(cwd: string): string {
	return path.basename(cwd) === "work" ? path.dirname(cwd) : path.join(cwd, "work");
}

const factory: CustomToolFactory = (pi) => {
	const uid = typeof process.getuid === "function" ? process.getuid() : 0;
	const gid = typeof process.getgid === "function" ? process.getgid() : 0;
	const root = workRoot(pi.cwd);

	const readBound = (ctx: { sessionManager?: { getEntries(): Array<Record<string, unknown>> } }): string | undefined => {
		const entries = ctx.sessionManager?.getEntries() ?? [];
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as { type?: string; customType?: string; data?: { target?: unknown } };
			if (entry.type === "custom" && entry.customType === BIND_ENTRY) {
				const target = entry.data?.target;
				if (typeof target === "string" && target) return target;
			}
		}
		return undefined;
	};

	return {
		name: "container",
		label: "Container",
		description:
			"Run commands in this session's debug container: gdb, pwndbg, pwntools, ROPgadget, compilers. " +
			"It runs as your host uid and mounts the bound target directory at the same absolute path, so files it writes are the same files. " +
			"Start with op=bind target=<name> once the target is chosen; every other op uses that binding.",
		loadMode: "essential",
		approval: "exec",
		parameters: pi.zod.object({
			op: pi.zod.enum(["bind", "exec", "run", "stop", "rm", "ls"]),
			target: pi.zod.string().optional().describe("Target name under work/. Required for op=bind"),
			cmd: pi.zod.string().optional().describe("Shell command. Required for op=exec"),
			timeout: pi.zod.number().optional().describe("Seconds. Default 600"),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			if (params.op === "ls") {
				const listed = await pi.exec("docker", [
					"ps", "-a", "--filter", "label=ccve.target",
					"--format", "{{.Names}}\t{{.Status}}",
				]);
				return { content: [{ type: "text", text: listed.stdout.trim() || "(none)" }] };
			}

			if (params.op === "bind") {
				const target = params.target?.trim();
				if (!target || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target)) {
					throw new Error("op=bind needs target: a name matching [a-zA-Z0-9][a-zA-Z0-9._-]*");
				}
				const dir = path.join(root, target);
				if (!fs.existsSync(dir)) {
					throw new Error(`no such directory: ${dir}. Create it with state.md and journal.md first.`);
				}
				ctx.sessionManager?.appendCustomEntry?.(BIND_ENTRY, { target });
				return { content: [{ type: "text", text: `bound: ${target} -> ${dir}` }] };
			}

			const target = params.op === "bind" ? params.target : readBound(ctx);
			if (!target) {
				throw new Error(`no target bound to this session. Run op=bind target=<name> first.`);
			}
			const dir = path.join(root, target);
			const name = `ccve-${target}-debug`;

			const healthy = async () => {
				const probe = await pi.exec("docker", [
					'inspect', '-f', '{{.State.Running}}|{{index .Mounts 0 "Source"}}', name,
				]);
				if (probe.code !== 0) return false;
				const [isRunning, source] = probe.stdout.trim().split("|");
				return isRunning === "true" && source === dir;
			};

			const ensure = async () => {
				if (await healthy()) return;
				await pi.exec("docker", ["rm", "-f", name]);
				const started = await pi.exec("docker", [
					"run", "-d", "--name", name, "--label", `ccve.target=${target}`,
					"--cpus", "1.5", "--memory", "2g",
					"--user", `${uid}:${gid}`,
					"-v", `${dir}:${dir}`,
					"-w", dir,
					"--add-host", "host.docker.internal:host-gateway",
					"ccve-debug", "sleep", "infinity",
				]);
				if (started.code !== 0) {
					throw new Error(`docker run failed: ${started.stderr.trim() || started.stdout.trim() || `exit ${started.code}`}`);
				}
			};

			if (params.op === "run") {
				await ensure();
				return { content: [{ type: "text", text: `running: ${name} (${dir})` }] };
			}

			if (params.op === "stop" || params.op === "rm") {
				const done = await pi.exec("docker", [params.op, ...(params.op === "rm" ? ["-f"] : []), name]);
				return { content: [{ type: "text", text: `${params.op}: ${name} (exit ${done.code})` }] };
			}

			if (!params.cmd) throw new Error("cmd is required for op=exec");
			await ensure();
			const result = await pi.exec(
				"docker",
				["exec", "-u", `${uid}:${gid}`, "-w", dir, name, "bash", "-lc", params.cmd],
				{ signal, timeout: (params.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000 },
			);
			const body = `${result.stdout}${result.stderr}`;
			const text = tail(body, TAIL_LINES) || "(no output)";
			return {
				content: [{ type: "text", text: result.code === 0 ? text : `${text}\nexit ${result.code}` }],
				isError: result.code !== 0,
			};
		},
	};
};

export default factory;
