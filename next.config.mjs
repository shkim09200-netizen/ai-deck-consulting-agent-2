/** @type {import('next').NextConfig} */
const nextConfig = {
  // Engine libs are Node-only; don't bundle them into the server build.
  serverExternalPackages: [
    "@anthropic-ai/sdk",
    "docx",
    "pptxgenjs",
    "mammoth",
    "unpdf",
    "xlsx",
    "jsdom",
    "@mozilla/readability",
  ],
  webpack: (config) => {
    // Let engine's NodeNext ".js" import specifiers resolve to ".ts" sources.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
