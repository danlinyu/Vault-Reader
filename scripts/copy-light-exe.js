const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src-tauri", "target", "release", "vault-reader.exe");
const targetDir = path.join(root, "dist");
const target = path.join(targetDir, "Vault-Reader-light-0.1.0.exe");

if (!fs.existsSync(source)) {
  throw new Error(`Missing Tauri executable: ${source}`);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied ${target}`);
