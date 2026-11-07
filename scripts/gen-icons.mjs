import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// 輪郭をSVG一か所に揃え、ホーム画面とブラウザーで別の形にならないようにする。
const svg = await readFile(new URL('../public/favicon.svg', import.meta.url))
for (const [file, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  await sharp(svg).resize(size, size).png().toFile(fileURLToPath(new URL(`../public/${file}`, import.meta.url)))
  console.log(`生成しました：${file}`)
}
