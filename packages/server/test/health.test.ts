import { describe, test, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("health check", () => {
  test("GET /health returns ok", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("collab-server");
  });
});
