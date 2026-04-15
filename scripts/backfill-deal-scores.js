/**
 * Backfill deal-relevance scores for existing InboxThread rows.
 *
 * Run once after deploying the deal-scorer. The live ingest scores threads
 * as they arrive; this fills in everything that was already there.
 *
 * Usage: node scripts/backfill-deal-scores.js [--limit N]
 */
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const ts = require("typescript");
const Module = require("module");

require.extensions[".ts"] = function (module, filename) {
  const src = fs.readFileSync(filename, "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
    fileName: filename,
  });
  module._compile(out.outputText, filename);
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) {
    return origResolve.call(this, path.join(__dirname, "..", "src", request.slice(2)), parent, ...rest);
  }
  return origResolve.call(this, request, parent, ...rest);
};

const { PrismaClient } = require("../src/generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const { scoreDealRelevance } = require("../src/lib/inbox/deal-scorer.ts");

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });

const GREEN = "\x1b[32m", DIM = "\x1b[2m", RESET = "\x1b[0m";

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit"));
  const limit = limitArg ? Number(limitArg.split("=")[1] || process.argv[process.argv.indexOf(limitArg) + 1]) : undefined;

  console.log("Loading Site catalogue…");
  const sites = await prisma.site.findMany({ where: { isActive: true }, select: { siteName: true, aliases: true } });
  const knownSiteNames = [];
  for (const s of sites) {
    if (s.siteName) knownSiteNames.push(s.siteName.toLowerCase());
    for (const a of s.aliases || []) {
      if (a) knownSiteNames.push(a.toLowerCase());
    }
  }
  console.log(`  ${knownSiteNames.length} site name(s) / aliases`);

  console.log("Fetching threads…");
  const threads = await prisma.inboxThread.findMany({
    select: { id: true, subject: true, lastSnippet: true },
    take: limit,
  });
  console.log(`  ${threads.length} threads to score`);

  let high = 0, medium = 0, low = 0;
  for (const t of threads) {
    const messages = await prisma.inboxThreadMessage.findMany({
      where: { threadId: t.id },
      orderBy: { occurredAt: "desc" },
      take: 20,
      select: { snippet: true },
    });
    const text = [t.lastSnippet ?? "", ...messages.map((m) => m.snippet ?? "")].filter(Boolean).join("\n");
    const { score, reasons } = scoreDealRelevance({ text, subject: t.subject, knownSiteNames });
    await prisma.inboxThread.update({ where: { id: t.id }, data: { dealScore: score, dealReasons: reasons } });
    if (score >= 70) high++;
    else if (score >= 40) medium++;
    else low++;
  }

  console.log(`\n${GREEN}Done.${RESET} HIGH=${high}  MEDIUM=${medium}  LOW=${low}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Backfill crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
