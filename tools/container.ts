import * as fs from "node:fs";
import * as path from "node:path";
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";

const TAIL_LINES = 200;
const DEFAULT_TIMEOUT_SECONDS = 600;
const TARGET_ENTRY = "ccve.target";
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

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

	const requireTarget = (ctx: Parameters<typeof readTarget>[0], given?: string): string => {
		const target = given?.trim() || readTarget(ctx);
		if (!target) {
			throw new Error("no target yet. Pass target=<name> on this call to set it for the session.");
		}
		if (!NAME_RE.test(target)) {
			throw new Error(`invalid target name: ${target}`);
		}
		return target;
	};

	return {
		name: "container",
		label: "Container",
		description:
			"Run commands in a debug container for this session's target: gdb, pwndbg, pwntools, ROPgadget, compilers. " +
			"It runs as your host uid and mounts work/<target> at the same absolute path, so files it writes are the same files. " +
			"Each container is identified by an id you choose; a target may have several (e.g. one per distro, one ASan build). " +
			"op=run creates or reuses it from an image of your choice; op=exec runs a command in it. " +
			"Pass target once on the first call; later calls reuse it.",
		loadMode: "essential",
		approval: "exec",
		parameters: pi.zod.object({
			op: pi.zod.enum(["run", "exec", "stop", "rm", "ls"]),
			target: pi.zod.string().optional().describe("Target name under work/. Remembered after the first call"),
			id: pi.zod.string().optional().describe("Container id you choose. Required except for op=ls"),
			image: pi.zod.string().optional().describe("Image for op=run, e.g. ccve-debug:debian-13"),
			cmd: pi.zod.string().optional().describe("Shell command. Required for op=exec"),
			timeout: pi.zod.number().optional().describe("Seconds. Default 600"),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			if (params.op === "ls") {
				const listed = await pi.exec("docker", [
					"ps", "-a", "--filter", "label=ccve.id",
					"--format", "{{.Names}}\t{{.Image}}\t{{.Status}}",
				]);
				return { content: [{ type: "text", text: listed.stdout.trim() || "(none)" }] };
			}

			const target = requireTarget(ctx, params.target);
			const dir = path.join(root, target);
			if (!fs.existsSync(dir)) {
				throw new Error(`no such directory: ${dir}. Create it with state.md and journal.md first.`);
			}
			if (params.target && params.target.trim() !== readTarget(ctx)) {
				ctx.sessionManager?.appendCustomEntry?.(TARGET_ENTRY, { target });
			}

			const id = params.id?.trim();
			if (!id) throw new Error(`op=${params.op} needs id.`);
			if (!NAME_RE.test(id)) throw new Error(`invalid id: ${id}`);

			const name = `ccve-${target}-${id}`;

			if (params.op === "stop" || params.op === "rm") {
				const done = await pi.exec("docker", [params.op, ...(params.op === "rm" ? ["-f"] : []), name]);
				return {
					content: [{ type: "text", text: `${params.op}: ${id} (exit ${done.code})` }],
				};
			}

			const image = params.image?.trim();
			if (params.op === "run" && !image) {
				const available = await pi.exec("docker", [
					"images", "ccve-debug", "--format", "{{.Repository}}:{{.Tag}}",
				]);
				throw new Error(
					`op=run needs image. Available: ${available.stdout.trim().split("\n").filter(Boolean).join(", ") || "(none — run bin/install)"}`,
				);
			}

			const healthy = async (wantImage: string) => {
				const probe = await pi.exec("docker", [
					"inspect", "-f", '{{.State.Running}}|{{index .Mounts 0 "Source"}}|{{.Config.Image}}', name,
				]);
				if (probe.code !== 0) return false;
				const [isRunning, source, usedImage] = probe.stdout.trim().split("|");
				return isRunning === "true" && source === dir && usedImage === wantImage;
			};

			const ensure = async (wantImage: string) => {
				if (await healthy(wantImage)) return;
				await pi.exec("docker", ["rm", "-f", name]);
				const started = await pi.exec("docker", [
					"run", "-d", "--name", name,
					"--label", `ccve.target=${target}`, "--label", `ccve.id=${id}`,
					"--cpus", "1.5", "--memory", "2g",
					"--user", `${uid}:${gid}`,
					"-v", `${dir}:${dir}`,
					"-w", dir,
					"--add-host", "host.docker.internal:host-gateway",
					wantImage, "sleep", "infinity",
				]);
				if (started.code !== 0) {
					throw new Error(`docker run failed: ${started.stderr.trim() || started.stdout.trim() || `exit ${started.code}`}`);
				}
			};

			if (params.op === "run") {
				const check = await pi.exec("docker", ["image", "inspect", image!]);
				if (check.code !== 0) {
					const available = await pi.exec("docker", [
						"images", "ccve-debug", "--format", "{{.Repository}}:{{.Tag}}",
					]);
					throw new Error(
						`image ${image} not found. Available: ${available.stdout.trim().split("\n").filter(Boolean).join(", ") || "(none — run bin/install)"}`,
					);
				}
				await ensure(image!);
				return { content: [{ type: "text", text: `running: ${id} (${image}, ${dir})` }] };
			}

			if (!params.cmd) throw new Error("cmd is required for op=exec");

			const current = await pi.exec("docker", ["inspect", "-f", "{{.Config.Image}}", name]);
			if (current.code !== 0) {
				throw new Error(`no container ${id} for ${target}. Run op=run id=${id} image=<image> first.`);
			}
			await ensure(current.stdout.trim());

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
