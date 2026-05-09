const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "vendor");

const files = [
  ["node_modules", "dompurify", "dist", "purify.min.js"],
  ["node_modules", "lucide", "dist", "umd", "lucide.min.js"],
  ["node_modules", "marked", "marked.min.js"],
];

fs.mkdirSync(vendorDir, { recursive: true });

for (const parts of files) {
  const source = path.join(root, ...parts);
  const target = path.join(vendorDir, parts.at(-1));

  if (!fs.existsSync(source)) {
    throw new Error(`Missing vendor source: ${source}`);
  }

  fs.copyFileSync(source, target);
}

console.log("Copied browser vendor files.");
