import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@engine\//, replacement: path.resolve(root, "src") + "/" },
      { find: /^@\//, replacement: path.resolve(root, ".") + "/" },
    ],
  },
  test: { include: ["tests/**/*.test.ts"] },
});
