import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "out/**"] },
  ...compat.extends("next/core-web-vitals").map((config) => ({
    ...config,
    files: ["**/*.{js,jsx,mjs}"],
    ...(config.languageOptions?.parser
      ? {
          languageOptions: {
            ...config.languageOptions,
            parser: {
              ...config.languageOptions.parser,
              meta: config.languageOptions.parser.meta || {
                name: "next-babel-parser",
                version: "15",
              },
            },
          },
        }
      : {}),
  })),
];

export default eslintConfig;
