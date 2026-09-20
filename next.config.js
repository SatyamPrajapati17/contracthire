/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "tesseract.js", "pdfjs-dist", "mammoth"],
  // Multiple dev instances on different ports need separate build caches,
  // otherwise they corrupt each other's .next directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

module.exports = nextConfig;
