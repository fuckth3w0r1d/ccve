import * as fs from "node:fs";
import * as path from "node:path";
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";

const TAIL_LINES = 200;
const DEFAULT_TIMEOUT_SECONDS = 600;
const TARGET_ENTRY = "ccve.target";
const TARGET_RE = /^[a-zA-Z0-9._-]+$/;
const ID_RE = /^[a-f0-9]{6,64}$/;

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

	const readTarget = (ctx: {
		sessionManager?: { getEntries(): Array<Record<string, unknown>> };
	}): string | undefined => {
		const entries = ctx.sessionManager?.getEntries() ?? [];
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as { type?: string; customType?: string; data?: { target?: unknown } };
			if (entry.type === "custom" && entry.customType === TARGET_ENTRY) {
				const target = entry.data?.target;
				if (typeof target === "string" && target) return target;
			}
		}
		return undefined;
	};

	const resolveTarget = (ctx: Parameters<typeof readTarget>[0], given?: string): string => {
		const target = given?.trim() || readTarget(ctx);
		if (!target) throw new Error("no target yet. Pass target=<name> on this call to set it.");
		if (!TARGET_RE.test(target)) throw new Error(`invalid target name: ${target}`);
		if (given && given.trim() !== readTarget(ctx)) {
			ctx.sessionManager?.appendCustomEntry?.(TARGET_ENTRY, { target });
		}
		return target;
	};

	const listIds = async (target: string): Promise<string[]> => {
		const listed = await pi.exec("docker", [
			"ps", "-a", "--filter", `label=ccve.target=${target}`, "--format", "{{.ID}}",
		]);
		return listed.stdout.trim().split("\n").filter(Boolean);
	};

	return {
		name: "container",
		label: "Container",
		description:
			"Debug containers for this session's target: gdb, pwndbg, pwntools, ROPgadget, compilers. " +
			"Runs as your host uid and mounts work/<target> at the same absolute path, so files it writes are the same files. " +
			"op=run starts one from an image you pick and returns its docker container id; op=exec runs a command in it by that id. " +
			"A target may have several containers. When it has exactly one, id may be omitted.",
		loadMode: "essential",
		approval: "exec",
		parameters: pi.zod.object({
			op: pi.zod.enum(["run", "exec", "stop", "rm", "ls"]),
			target: pi.zod.string().optional().describe("Target name under work/. Remembered after the first call"),
			id: pi.zod.string().optional().describe("Docker container id. Optional when the target has exactly one container"),
			image: pi.zod.string().optional().describe("Image for op=run, e.g. ccve-debug:debian-13"),
			cmd: pi.zod.string().optional().describe("Shell command. Required for op=exec"),
			timeout: pi.zod.number().optional().describe("Seconds. Default 600"),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			if (params.op === "ls") {
				const filter = params.target ? `label=ccve.target=${params.target}` : "label=ccve.target";
				const listed = await pi.exec("docker", [
					"ps", "-a", "--filter", filter,
					"--format", '{{.ID}}\t{{.Label "ccve.target"}}\t{{.Image}}\t{{.Status}}',
				]);
				return { content: [{ type: "text", text: listed.stdout.trim() || "(none)" }] };
			}

			const target = resolveTarget(ctx, params.target);
			const dir = path.join(root, target);
			if (!fs.existsSync(dir)) {
				throw new Error(`no such directory: ${dir}. Create it with state.md and journal.md first.`);
			}

			if (params.op === "run") {
				const image = params.image?.trim();
				const available = async () => {
					const listed = await pi.exec("docker", [
						"images", "ccve-debug", "--format", "{{.Repository}}:{{.Tag}}",
					]);
					return listed.stdout.trim().split("\n").filter(Boolean).join(", ") || "(none — run bin/install)";
				};
				if (!image) throw new Error(`op=run needs image. Available: ${await available()}`);
				const check = await pi.exec("docker", ["image", "inspect", image]);
				if (check.code !== 0) throw new Error(`image ${image} not found. Available: ${await available()}`);

				const created = await pi.exec("docker", [
					"run", "-d",
					"--label", `ccve.target=${target}`,
					"--cpus", "1.5", "--memory", "2g",
					"--user", `${uid}:${gid}`,
					"-v", `${dir}:${dir}`,
					"-w", dir,
					"--add-host", "host.docker.internal:host-gateway",
					image, "sleep", "infinity",
				]);
				if (created.code !== 0) {
					throw new Error(`docker run failed: ${created.stderr.trim() || created.stdout.trim() || `exit ${created.code}`}`);
				}
				return { content: [{ type: "text", text: `started ${created.stdout.trim().slice(0, 12)} (${image}, ${dir})` }] };
			}

			const ids = await listIds(target);
			if (ids.length === 0) throw new Error(`no container for ${target}. Run op=run image=<image> first.`);

			let id = params.id?.trim();
			if (id) {
				if (!ID_RE.test(id)) throw new Error(`invalid container id: ${id}`);
				if (!ids.includes(id)) throw new Error(`container ${id} does not belong to ${target}. Known: ${ids.join(", ")}`);
			} else {
				if (ids.length > 1) throw new Error(`${target} has ${ids.length} containers, pass id. Known: ${ids.join(", ")}`);
				id = ids[0];
			}

			if (params.op === "stop" || params.op === "rm") {
				const done = await pi.exec("docker", [params.op, ...(params.op === "rm" ? ["-f"] : []), id]);
				return { content: [{ type: "text", text: `${params.op} ${id} (exit ${done.code})` }] };
			}

			if (!params.cmd) throw new Error("cmd is required for op=exec");

			const result = await pi.exec(
				"docker",
				["exec", "-u", `${uid}:${gid}`, "-w", dir, id, "bash", "-lc", params.cmd],
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
