const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const webDist = path.join(root, "web-dist");

require("./copy-vendor");

fs.rmSync(webDist, { recursive: true, force: true });
fs.mkdirSync(path.join(webDist, "vendor"), { recursive: true });

for (const file of ["index.html", "app.js", "styles.css", "favicon.svg"]) {
  fs.copyFileSync(path.join(root, file), path.join(webDist, file));
}

for (const file of fs.readdirSync(path.join(root, "vendor"))) {
  fs.copyFileSync(path.join(root, "vendor", file), path.join(webDist, "vendor", file));
}

console.log("Built web-dist.");
