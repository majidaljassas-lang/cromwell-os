/**
 * Pure scoring test for the auto-linker — no DB, no HTTP. Imports the exact
 * scoring function used by resolveLink() / autoLinkThread() and runs three
 * scenarios against a fabricated ticket to assert HIGH/MEDIUM/LOW thresholds.
 *
 * We exercise `scoreAgainstTicket` directly because it is the load-bearing
 * piece: both the InboundEvent-level path (resolveLink) and the InboxThread-
 * level path (autoLinkThread → scoreOpenTicketsForText) call into it, so if
 * the math is correct here, both ingestion paths behave correctly.
 *
 * Run: node scripts/test-auto-link-scoring.js
 */

// The link-resolver is .ts, which means we need to go through the compiled
// module via Next's build — or, simpler, register tsx/ts-node. We instead
// re-implement nothing and just transpile on the fly via a minimal loader.
// The cleanest no-dep approach: require the file through Next's runtime is
// too heavy; use a tiny inline scorer copy that mirrors the source would
// drift. So we load via the already-built Next .next dir if present, else
// evaluate the TS via a small require hook.
//
// Since this repo has allowJs + tsc available, we simply compile the single
// file on demand using the project's TypeScript.

const path = require("path");
const fs = require("fs");
const ts = require("typescript");
const Module = require("module");

// Register a `.ts` require hook that transpiles with the project's tsconfig.
require.extensions[".ts"] = function (module, filename) {
  const src = fs.readFileSync(filename, "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
      resolveJsonModule: true,
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
    fileName: filename,
  });
  module._compile(out.outputText, filename);
};

// Map @/ → src/ so the file's imports resolve. We only need link-resolver's
// own non-prisma logic; the prisma import is unused for scoreAgainstTicket.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) {
    return origResolve.call(this, path.join(__dirname, "..", "src", request.slice(2)), parent, ...rest);
  }
  return origResolve.call(this, request, parent, ...rest);
};

// Shim @/lib/prisma so importing link-resolver doesn't try to connect.
require.cache[require.resolve("../src/lib/prisma.ts")] = {
  exports: { prisma: new Proxy({}, { get: () => () => { throw new Error("prisma not expected in this test"); } }) },
};

const { scoreAgainstTicket } = require("../src/lib/ingestion/link-resolver.ts");

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";
function ok(m) { console.log(`${GREEN}✓${RESET} ${m}`); }
function fail(m) { console.log(`${RED}✗${RESET} ${m}`); }
function info(m) { console.log(`${DIM}  ${m}${RESET}`); }

// Tier thresholds (mirror of link-resolver.ts + thread-builder.ts)
const HIGH = 70;
const MEDIUM = 40;

function tierOf(score) {
  if (score >= HIGH) return "HIGH";
  if (score >= MEDIUM) return "MEDIUM";
  return "LOW";
}

// Fabricated open ticket — all fields scoreAgainstTicket reads.
const now = new Date();
const ticket = {
  id: "ticket-under-test",
  title: "Supply copper pipe to Brompton Court",
  siteId: "site-1",
  payingCustomerId: "cust-1",
  status: "CAPTURED",
  updatedAt: now,
  site: { siteName: "Brompton Court Development", aliases: [] },
  payingCustomer: { name: "Acme Plumbing Services" },
  requestedByContact: null,
  actingOnBehalfOfContact: null,
  lines: [{ normalizedItemName: "22mm copper pipe", productCode: "CU22" }],
};

const scenarios = [
  {
    name: "HIGH",
    text: "Brompton site update — ref TK-12345, need extra 22mm copper pipe today please",
    subject: "Update",
    expected: "HIGH",
    expectedMin: 70,
  },
  {
    name: "MEDIUM",
    text: "Brompton site — Acme Plumbing team on the way at 10am",
    subject: "Morning",
    expected: "MEDIUM",
    expectedMin: 40,
    expectedMax: 69,
  },
  {
    name: "LOW",
    text: "Hi there, hope you're well. Thanks!",
    subject: null,
    expected: "LOW",
    expectedMax: 39,
  },
];

console.log(`${YELLOW}▶ Auto-link scoring unit test (no DB/HTTP)${RESET}\n`);

const results = [];
for (const s of scenarios) {
  const input = {
    eventType: "WHATSAPP_MESSAGE",
    sourceType: "WHATSAPP",
    sender: "Test Sender",
    senderPhone: "+447700000000",
    receivedAt: now,
    rawText: s.text,
    subject: s.subject,
  };
  const { score, reasons } = scoreAgainstTicket(input, ticket);
  const tier = tierOf(score);
  const tierOk = tier === s.expected;
  const minOk = s.expectedMin == null || score >= s.expectedMin;
  const maxOk = s.expectedMax == null || score <= s.expectedMax;
  const pass = tierOk && minOk && maxOk;

  if (pass) {
    ok(`${s.name}: score=${score} tier=${tier}`);
    info(`reasons: ${reasons.join("; ")}`);
  } else {
    fail(`${s.name}: expected tier=${s.expected} (min=${s.expectedMin ?? "-"}, max=${s.expectedMax ?? "-"})`);
    info(`got score=${score} tier=${tier}`);
    info(`reasons: ${reasons.join("; ")}`);
  }
  results.push(pass);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed === results.length ? GREEN : RED}${passed}/${results.length} passed${RESET}`);
process.exit(passed === results.length ? 0 : 1);
