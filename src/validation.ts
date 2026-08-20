import { BoxesError } from "./errors.js";

export type CoordinateSpace = "normalized" | "pixels";

export interface CoordinateRequest {
  x: number;
  y: number;
  coordinateSpace: CoordinateSpace;
  width?: number;
  height?: number;
}

export function asRecord(value: unknown, context = "arguments"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BoxesError("INVALID_ARGUMENT", `${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireString(
  value: unknown,
  field: string,
  code: "INVALID_ARGUMENT" | "INVALID_KEY" | "TRANSFER_PATH_DENIED" = "INVALID_ARGUMENT"
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BoxesError(code, `${field} must be a non-empty string`);
  }
  return value;
}

export function requireNameOrUuid(args: Record<string, unknown>): string {
  const nameOrUuid = requireString(args.nameOrUuid, "nameOrUuid");
  if (nameOrUuid.startsWith("-") || /[\u0000\r\n]/.test(nameOrUuid)) {
    throw new BoxesError("INVALID_ARGUMENT", "nameOrUuid contains an invalid argument prefix or control character");
  }
  return nameOrUuid;
}

export function optionalString(args: Record<string, unknown>, field: string): string | undefined {
  const value = args[field];
  if (value === undefined) return undefined;
  return requireString(value, field);
}

export function boundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  defaultValue?: number
): number {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new BoxesError(
      "INVALID_ARGUMENT",
      `${field} must be an integer between ${minimum} and ${maximum}`
    );
  }
  return value;
}

export function boundedNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  defaultValue?: number
): number {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new BoxesError(
      "INVALID_ARGUMENT",
      `${field} must be a finite number between ${minimum} and ${maximum}`
    );
  }
  return value;
}

export function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  code: "INVALID_ARGUMENT" | "INVALID_COORDINATES" = "INVALID_ARGUMENT",
  defaultValue?: T
): T {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new BoxesError(code, `${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function parseCoordinates(args: Record<string, unknown>): CoordinateRequest {
  const coordinateSpace = enumValue(
    args.coordinateSpace,
    "coordinateSpace",
    ["normalized", "pixels"] as const,
    "INVALID_COORDINATES",
    "normalized"
  );
  const x = coordinateSpace === "pixels"
    ? boundedInteger(args.x, "x", 0, Number.MAX_SAFE_INTEGER)
    : boundedNumber(args.x, "x", 0, 1);
  const y = coordinateSpace === "pixels"
    ? boundedInteger(args.y, "y", 0, Number.MAX_SAFE_INTEGER)
    : boundedNumber(args.y, "y", 0, 1);

  if (coordinateSpace === "pixels") {
    const width = boundedInteger(args.width, "width", 1, 1_000_000);
    const height = boundedInteger(args.height, "height", 1, 1_000_000);
    if (x > width || y > height) {
      throw new BoxesError("INVALID_COORDINATES", "pixel coordinates must fit within width and height");
    }
    return { x, y, coordinateSpace, width, height };
  }

  return { x, y, coordinateSpace };
}

export function normalizedCoordinate(value: number, maximum: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * maximum);
}

export function parseEnvironmentInteger(
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return defaultValue;
  return parsed;
}
