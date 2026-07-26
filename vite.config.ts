// PROTOTYPE (#17) — Vite+ trial config. Throwaway.
//
// No `defineConfig` import: `vite` is a devDependency of @scholia/web, not of the
// workspace root, so importing it here would not resolve.
//
// Vite+ caches tasks declared in this file by default but leaves package.json
// scripts UNCACHED ("⊘ cache disabled"), which is the opposite of Turborepo's
// behaviour. Since this trial deliberately orchestrates the existing scripts
// rather than rewriting them as Vite+ tasks, caching has to be turned on here or
// `vp run` is just a slower `pnpm -r`.
export default {
  run: {
    cache: {
      tasks: true,
      scripts: true,
    },
  },
};
