import { defineConfig } from "vitest/config";

// Dedicated Vitest config so the React Router Vite plugin (which expects a
// full app/browser build context) does not interfere with unit tests of the
// pure service/lib logic.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.js"],
    globals: false,
  },
});
