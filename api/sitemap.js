// api/sitemap.js
// Vercel serverless function — generates sitemap.xml on request by scanning
// the actual routes on disk (home, /blog/, and every blog/<slug>/index.html),
// so new blog posts show up automatically without hand-editing a static file.
// Wired to /sitemap.xml via the rewrite in vercel.json.

const fs = require("fs");
const path = require("path");

const SITE_URL = "https://igc-leisurelearning.com";

function isoDate(mtime) {
  return mtime.toISOString().slice(0, 10);
}

function collectRoutes() {
  const blogDir = path.join(process.cwd(), "blog");
  const rootIndex = path.join(process.cwd(), "index.html");
  const blogIndex = path.join(blogDir, "index.html");

  const routes = [
    { loc: "/", file: rootIndex, changefreq: "weekly", priority: "1.0" },
    { loc: "/blog/", file: blogIndex, changefreq: "weekly", priority: "0.8" },
  ];

  const entries = fs.readdirSync(blogDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const postIndex = path.join(blogDir, entry.name, "index.html");
    if (!fs.existsSync(postIndex)) continue;
    routes.push({
      loc: `/blog/${entry.name}/`,
      file: postIndex,
      changefreq: "monthly",
      priority: "0.6",
    });
  }

  return routes;
}

module.exports = async function handler(req, res) {
  const routes = collectRoutes();

  const urls = routes
    .map(({ loc, file, changefreq, priority }) => {
      const lastmod = isoDate(fs.statSync(file).mtime);
      return `  <url>
    <loc>${SITE_URL}${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600");
  res.status(200).send(xml);
};
