import { describe, expect, test, vi } from "vitest";
import { createLiveReloadGate } from "../src/client/live-reload.js";

// The rule the gate exists for (issue #29): while the reader is composing, the
// ground does not move under them. Everything here is about *when* the swap
// runs, never about what it does — which is why the swap is injected.

/** A swap whose completion the test controls, so "in flight" is observable. */
function deferredSwap() {
  let release!: () => void;
  const calls: Array<() => void> = [];
  const perform = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        calls.push(resolve);
        release = resolve;
      }),
  );
  return { perform, release: () => release(), calls };
}

describe("createLiveReloadGate", () => {
  test("applies a change straight away when nothing is held", async () => {
    const perform = vi.fn(() => Promise.resolve());
    const gate = createLiveReloadGate(perform);

    gate.notify();
    await Promise.resolve();

    expect(perform).toHaveBeenCalledTimes(1);
    expect(gate.pending()).toBe(false);
  });

  test("holds the swap while composing, and says an update is waiting", async () => {
    const perform = vi.fn(() => Promise.resolve());
    const gate = createLiveReloadGate(perform);
    const seen: boolean[] = [];
    gate.subscribe(() => seen.push(gate.pending()));

    gate.setHold(true);
    gate.notify();
    await Promise.resolve();

    expect(perform).not.toHaveBeenCalled();
    expect(gate.pending()).toBe(true);
    expect(seen).toEqual([true]);
  });

  test("a run of changes while held collapses into one swap on release", async () => {
    const perform = vi.fn(() => Promise.resolve());
    const gate = createLiveReloadGate(perform);

    gate.setHold(true);
    gate.notify();
    gate.notify();
    gate.notify();
    expect(perform).not.toHaveBeenCalled();

    gate.setHold(false);
    await Promise.resolve();

    expect(perform).toHaveBeenCalledTimes(1);
    expect(gate.pending()).toBe(false);
  });

  test("releasing with nothing waiting swaps nothing", async () => {
    const perform = vi.fn(() => Promise.resolve());
    const gate = createLiveReloadGate(perform);

    gate.setHold(true);
    gate.setHold(false);
    await Promise.resolve();

    expect(perform).not.toHaveBeenCalled();
  });

  test("take() applies the waiting update without ending the hold", async () => {
    const perform = vi.fn(() => Promise.resolve());
    const gate = createLiveReloadGate(perform);

    gate.setHold(true);
    gate.notify();
    gate.take();
    await Promise.resolve();

    expect(perform).toHaveBeenCalledTimes(1);
    expect(gate.pending()).toBe(false);

    // Still composing, so the next change waits exactly as the first one did.
    gate.notify();
    await Promise.resolve();
    expect(perform).toHaveBeenCalledTimes(1);
    expect(gate.pending()).toBe(true);
  });

  test("take() with nothing waiting does nothing", async () => {
    const perform = vi.fn(() => Promise.resolve());
    const gate = createLiveReloadGate(perform);

    gate.take();
    await Promise.resolve();

    expect(perform).not.toHaveBeenCalled();
  });

  test("a change arriving mid-swap is folded into one follow-up swap", async () => {
    const swap = deferredSwap();
    const gate = createLiveReloadGate(swap.perform);

    gate.notify();
    expect(swap.perform).toHaveBeenCalledTimes(1);

    // Two more writes land while the first swap is still fetching.
    gate.notify();
    gate.notify();
    expect(swap.perform).toHaveBeenCalledTimes(1);

    swap.calls[0]!();
    await new Promise((r) => setTimeout(r, 0));

    expect(swap.perform).toHaveBeenCalledTimes(2);
  });

  test("a change arriving mid-swap waits when the reader started composing", async () => {
    const swap = deferredSwap();
    const gate = createLiveReloadGate(swap.perform);

    gate.notify();
    gate.notify();
    gate.setHold(true);

    swap.calls[0]!();
    await new Promise((r) => setTimeout(r, 0));

    expect(swap.perform).toHaveBeenCalledTimes(1);
    expect(gate.pending()).toBe(true);
  });

  // The reader is composing, so the change is already theirs to take — telling
  // them only once the swap in flight happens to settle would be a notice that
  // arrives late for no reason the reader can see.
  test("a change arriving mid-swap while held is announced straight away", () => {
    const swap = deferredSwap();
    const gate = createLiveReloadGate(swap.perform);

    gate.notify();
    gate.setHold(true);
    gate.notify();

    expect(gate.pending()).toBe(true);
  });

  test("a swap that throws leaves the gate listening", async () => {
    const perform = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const gate = createLiveReloadGate(perform);

    gate.notify();
    await new Promise((r) => setTimeout(r, 0));
    gate.notify();
    await new Promise((r) => setTimeout(r, 0));

    expect(perform).toHaveBeenCalledTimes(2);
  });

  test("unsubscribing stops the listener", async () => {
    const gate = createLiveReloadGate(() => Promise.resolve());
    const listener = vi.fn();
    const off = gate.subscribe(listener);

    gate.setHold(true);
    gate.notify();
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    gate.take();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
