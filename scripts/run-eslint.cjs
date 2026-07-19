const { registerHooks } = require("node:module");
const { dirname, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { argv } = require("node:process");

// TypeScript 7 is a native compiler and intentionally does not expose the legacy
// JavaScript compiler API that typescript-eslint 8 still imports. Keep that API
// isolated to linting until typescript-eslint supports the native package.
const classicTypeScript = require.resolve("typescript-eslint-compiler");
const classicTypeScriptRoot = dirname(dirname(classicTypeScript));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "typescript") {
      return { url: pathToFileURL(classicTypeScript).href, shortCircuit: true };
    }
    if (specifier.startsWith("typescript/")) {
      const classicSubpath = require.resolve(
        resolve(classicTypeScriptRoot, specifier.slice("typescript/".length))
      );
      return {
        url: pathToFileURL(classicSubpath).href,
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});

const eslintApi = require.resolve("eslint");
const eslintBin = resolve(dirname(dirname(eslintApi)), "bin", "eslint.js");
argv[1] = eslintBin;
require(eslintBin);
