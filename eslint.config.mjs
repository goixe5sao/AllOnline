import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The realtime 3D room deliberately keeps 10 Hz movement data in mutable refs/stores that
    // are read inside the render loop (useFrame) instead of React state, to avoid re-rendering
    // the whole scene on every position update. The React-Compiler purity rules flag exactly
    // that pattern, so they are relaxed for these files only.
    files: ["src/components/room/**"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**"]),
]);

export default eslintConfig;
