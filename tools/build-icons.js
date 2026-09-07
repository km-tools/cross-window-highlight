// icons/icon.svg から 16/32/48/128px の PNG を生成する
// 実行: node tools/build-icons.js
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "src", "icons", "icon.svg");
const svg = fs.readFileSync(src);

(async () => {
  for (const size of [16, 32, 48, 128]) {
    const out = path.join(root, "src", "icons", `icon${size}.png`);
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out);
    console.log("wrote", path.relative(root, out));
  }
})();
