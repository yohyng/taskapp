import sharp from 'sharp'

// Lightning bolt icon
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="80" fill="#0f172a"/>
  <polygon points="300,60 160,280 248,280 212,452 352,232 264,232" fill="#facc15" stroke="#fbbf24" stroke-width="6" stroke-linejoin="round"/>
</svg>`

const svgBuf = Buffer.from(svg)

await sharp(svgBuf).resize(512, 512).png().toFile('public/icon-512.png')
console.log('✓ icon-512.png')

await sharp(svgBuf).resize(192, 192).png().toFile('public/icon-192.png')
console.log('✓ icon-192.png')

await sharp(svgBuf).resize(180, 180).png().toFile('public/apple-touch-icon.png')
console.log('✓ apple-touch-icon.png')
