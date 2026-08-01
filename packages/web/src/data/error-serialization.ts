import type { DehydratedState } from "@tanstack/react-query";
import { SiteNotFoundError } from "../api.js";

/**
 * Error shape after serialization: an `Error` loses its prototype and non-enumerable
 * fields through `JSON.stringify`, so we store just enough to reconstruct it.
 */
interface SerializedError {
  __errorName: string;
  message: string;
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function isSerializedError(value: unknown): value is SerializedError {
  return (
    typeof value === "object" && value !== null && "__errorName" in value && "message" in value
  );
}

/**
 * Walk the dehydrated query cache and convert every Error on a query state into
 * a plain serializable object. Called before `JSON.stringify` on the server, so
 * that errors survive the trip to the client.
 */
export function serializeErrors(state: DehydratedState): void {
  for (const query of state.queries) {
    if (isError(query.state.error)) {
      (query.state as { error: unknown }).error = {
        __errorName: query.state.error.name,
        message: query.state.error.message,
      } satisfies SerializedError;
    }
  }
}

/**
 * Walk the dehydrated query cache and convert serialized error objects back into
 * proper Error instances. Called after `JSON.parse` on the client, before the
 * cache is hydrated, so `instanceof` checks and `.message` access work as expected.
 */
export function deserializeErrors(state: DehydratedState): void {
  for (const query of state.queries) {
    const err = query.state.error;
    if (isSerializedError(err)) {
      (query.state as { error: unknown }).error = reconstructError(err);
    }
  }
}

function reconstructError(err: SerializedError): Error {
  const error = new Error(err.message);
  error.name = err.__errorName;

  // Restore the class prototype so `instanceof` checks match.
  // `SiteNotFoundError` extends Error and the viewer checks `instanceof
  // SiteNotFoundError` to branch between "not found" and generic error views.
  if (err.__errorName === "SiteNotFoundError") {
    Object.setPrototypeOf(error, SiteNotFoundError.prototype);
  }

  return error;
}
