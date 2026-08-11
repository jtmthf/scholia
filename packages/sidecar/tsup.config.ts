import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: false,
  sourcemap: true,
  // false: tsup only owns the JS in dist/ here — the sibling `typecheck`
  // script emits dist/*.d.ts into the same folder, and clean:true would wipe
  // those regardless of which one runs last.
  clean: false,
});
