export type BoxesErrorCode =
  | "DOMAIN_NOT_FOUND"
  | "DOMAIN_NOT_RUNNING"
  | "BACKEND_UNAVAILABLE"
  | "UNSUPPORTED_DISPLAY"
  | "QMP_UNAVAILABLE"
  | "QMP_COMMAND_UNSUPPORTED"
  | "SPICE_UNAVAILABLE"
  | "SPICE_AGENT_DISCONNECTED"
  | "SPICE_CAPABILITY_MISSING"
  | "INVALID_ARGUMENT"
  | "INVALID_KEY"
  | "INVALID_COORDINATES"
  | "ARTIFACT_TOO_LARGE"
  | "CLIPBOARD_TOO_LARGE"
  | "TRANSFER_PATH_DENIED"
  | "TRANSFER_TOO_LARGE"
  | "OPERATION_CANCELLED"
  | "OPERATION_TIMEOUT";

/** Error with a stable code suitable for MCP clients and tests. */
export class BoxesError extends Error {
  public readonly code: BoxesErrorCode;

  public constructor(code: BoxesErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BoxesError";
    this.code = code;
  }
}

export function errorCode(error: unknown): BoxesErrorCode {
  return error instanceof BoxesError ? error.code : "BACKEND_UNAVAILABLE";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
