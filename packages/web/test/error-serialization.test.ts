import { describe, expect, it } from "vitest";
import type { DehydratedState } from "@tanstack/react-query";
import { SiteNotFoundError } from "../src/api.js";
import { deserializeErrors, serializeErrors } from "../src/data/error-serialization.js";

/**
 * Minimal dehydrated query state: only the fields our serialization functions
 * touch (`queries[i].state.error`). The rest of the DehydratedState shape is
 * irrelevant to these tests.
 */
function stubState(error: unknown): DehydratedState {
  return {
    mutations: [],
    queries: [{ state: { error } }],
  } as unknown as DehydratedState;
}

describe("serializeErrors", () => {
  it("converts an Error into a plain serialized object", () => {
    const state = stubState(new SiteNotFoundError("nope"));

    serializeErrors(state);

    const err = state.queries[0]!.state.error as unknown as Record<string, unknown>;
    expect(err.__errorName).toBe("SiteNotFoundError");
    expect(err.message).toBe('No Site at "nope".');
  });

  it("leaves a non-Error value unchanged", () => {
    const state = stubState("just a string");

    serializeErrors(state);

    expect(state.queries[0]!.state.error).toBe("just a string");
  });

  it("handles undefined error", () => {
    const state = stubState(undefined);

    serializeErrors(state);

    expect(state.queries[0]!.state.error).toBeUndefined();
  });

  it("handles empty queries array", () => {
    const state = { mutations: [], queries: [] } as DehydratedState;

    // Should not throw
    serializeErrors(state);
  });
});

describe("deserializeErrors", () => {
  it("reconstructs SiteNotFoundError with correct prototype", () => {
    const state = stubState(new SiteNotFoundError("nope"));
    serializeErrors(state);
    // Simulate JSON round-trip: the serialized form is a plain object.
    // `deserializeErrors` receives the post-JSON.parse state.
    deserializeErrors(state);

    const err = state.queries[0]!.state.error;
    expect(err).toBeInstanceOf(SiteNotFoundError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('No Site at "nope".');
    expect((err as Error).name).toBe("SiteNotFoundError");
  });

  it("reconstructs a generic Error", () => {
    const state = stubState(new Error("boom"));
    serializeErrors(state);
    deserializeErrors(state);

    const err = state.queries[0]!.state.error;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("boom");
    expect((err as Error).name).toBe("Error");
  });

  it("leaves an already-deserialized Error unchanged (idempotent)", () => {
    const state = stubState(new SiteNotFoundError("nope"));
    serializeErrors(state);
    deserializeErrors(state);

    // Second deserialize should be a no-op: the error is already an Error instance.
    const before = state.queries[0]!.state.error;
    deserializeErrors(state);
    expect(state.queries[0]!.state.error).toBe(before);
  });

  it("leaves a non-serialized-error value unchanged", () => {
    const state = stubState("just a string");

    deserializeErrors(state);

    expect(state.queries[0]!.state.error).toBe("just a string");
  });
});
