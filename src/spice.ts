import { existsSync, accessSync, constants } from "node:fs";
import { execFile } from "node:child_process";
import { BoxesError } from "./errors.js";
import { parseEnvironmentInteger } from "./validation.js";
import type { DisplayEndpoint } from "./display.js";

export interface SpiceHelperRequest {
  version: 1;
  id: string;
  operation: string;
  domain: string;
  display: { uri: string };
  arguments: Record<string, unknown>;
}

export interface SpiceHelperResponse {
  version: 1;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

export function spiceHelperPath(): string | undefined {
  const configured = process.env.BOXES_SPICE_HELPER?.trim();
  if (!configured || !existsSync(configured)) return undefined;
  try {
    accessSync(configured, constants.X_OK);
    return configured;
  } catch {
    return undefined;
  }
}

export function spiceHelperConfigured(): boolean {
  return spiceHelperPath() !== undefined;
}

function helperError(response: SpiceHelperResponse): BoxesError {
  const code = response.error?.code;
  const supported = new Set([
    "SPICE_AGENT_DISCONNECTED",
    "SPICE_CAPABILITY_MISSING",
    "SPICE_UNAVAILABLE",
    "OPERATION_TIMEOUT"
  ]);
  const mapped = supported.has(code || "") ? code as BoxesError["code"] : "SPICE_UNAVAILABLE";
  return new BoxesError(mapped, response.error?.message || "SPICE helper operation failed");
}

export async function callSpiceHelper(
  operation: string,
  domain: string,
  endpoint: DisplayEndpoint,
  argumentsValue: Record<string, unknown>
): Promise<unknown> {
  const helper = spiceHelperPath();
  if (!helper) throw new BoxesError("SPICE_UNAVAILABLE", "BOXES_SPICE_HELPER is not configured or executable");
  const id = `boxes-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request: SpiceHelperRequest = {
    version: 1,
    id,
    operation,
    domain,
    display: { uri: endpoint.display },
    arguments: argumentsValue
  };
  const timeoutMs = parseEnvironmentInteger("BOXES_SPICE_OPERATION_TIMEOUT_MS", 30_000, 100, 300_000);

  return await new Promise((resolve, reject) => {
    const child = execFile(
      helper,
      [],
      {
        shell: false,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024
      },
      (error, stdout) => {
        if (error) {
          const timedOut = (error as NodeJS.ErrnoException & { killed?: boolean }).code === "ETIMEDOUT"
            || (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
          reject(timedOut
            ? new BoxesError("OPERATION_TIMEOUT", "SPICE helper operation timed out", { cause: error })
            : new BoxesError("SPICE_UNAVAILABLE", "SPICE helper failed before responding", { cause: error }));
          return;
        }

        const line = stdout.toString().trim();
        if (line.length === 0 || line.length > 4 * 1024 * 1024) {
          reject(new BoxesError("SPICE_UNAVAILABLE", "SPICE helper returned no bounded response"));
          return;
        }

        let response: SpiceHelperResponse;
        try {
          response = JSON.parse(line) as SpiceHelperResponse;
        } catch (parseError) {
          reject(new BoxesError("SPICE_UNAVAILABLE", "SPICE helper returned invalid JSON", { cause: parseError }));
          return;
        }
        if (response.version !== 1 || response.id !== id) {
          reject(new BoxesError("SPICE_UNAVAILABLE", "SPICE helper response did not match the request"));
          return;
        }
        if (!response.ok) reject(helperError(response));
        else resolve(response.result);
      }
    );
    child.stdin?.end(`${JSON.stringify(request)}\n`);
  });
}
