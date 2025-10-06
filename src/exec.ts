import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export type ExecResult = { stdout: string; stderr: string };

export async function sh(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<ExecResult> {
  const { timeoutMs = 60_000, env = process.env } = opts;
  const { stdout, stderr } = await pexec(cmd, args, {
    timeout: timeoutMs,
    env,
    maxBuffer: 10 * 1024 * 1024
  });
  return { stdout: stdout.toString(), stderr: stderr?.toString() ?? "" };
}
