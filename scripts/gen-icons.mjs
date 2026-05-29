import sharp from 'sharp'
import { readFileSync } from 'fs'

// SVG source for the icon
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="80" fill="#0f172a"/>
  <rect x="96" y="128" width="320" height="36" rx="12" fill="#f1f5f9"/>
  <rect x="96" y="208" width="224" height="28" rx="10" fill="#475569"/>
  <rect x="96" y="272" width="256" height="28" rx="10" fill="#475569"/>
  <rect x="96" y="336" width="176" height="28" rx="10" fill="#475569"/>
  <rect x="96" y="400" width="200" height="28" rx="10" fill="#334155"/>
</svg>`

const svgBuf = Buffer.from(svg)

await sharp(svgBuf).resize(512, 512).png().toFile('public/icon-512.png')
console.log('✓ icon-512.png')

await sharp(svgBuf).resize(192, 192).png().toFile('public/icon-192.png')
console.log('✓ icon-192.png')

await sharp(svgBuf).resize(180, 180).png().toFile('public/apple-touch-icon.png')
console.log('✓ apple-touch-icon.png')
