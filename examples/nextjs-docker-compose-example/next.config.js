/* global __dirname, module, require */
const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname)
};

module.exports = nextConfig;
