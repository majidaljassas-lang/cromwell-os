import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// CSV Parser — handles Barclays SmartBusiness formats
// ---------------------------------------------------------------------------

interface ParsedRow {
  date: Date;
  description: string;
  amount: number;
  balance: number | null;
  type: string;
}

function parseBarclaysCSV(csvText: string): ParsedRow[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Detect header format
  const header = lines[0].toLowerCase();
  const rows: ParsedRow[] = [];

  // Format 1: Date, Description, Amount, Balance
  // Format 2: Date, Type, Description, Money In, Money Out, Balance
  // Format 3: Number, Date, Account, Amount, Subcategory, Memo (generic)
  const isFormat2 =
    header.includes("money in") || header.includes("money out");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    if (cols.length < 3) continue;

    try {
      if (isFormat2) {
        // Format 2: Date, Type, Description, Money In, Money Out, Balance
        const date = parseDate(cols[0]);
        if (!date) continue;

        const type = cols[1]?.trim() || "OTHER";
        const description = cols[2]?.trim() || "";
        const moneyIn = parseAmount(cols[3]);
        const moneyOut = parseAmount(cols[4]);
        const balance = cols.length > 5 ? parseAmount(cols[5]) : null;

        // Money In is positive, Money Out is negative
        const amount = moneyIn > 0 ? moneyIn : -moneyOut;
        if (amount === 0 && moneyIn === 0 && moneyOut === 0) continue;

        rows.push({
          date,
          description,
          amount,
          balance,
          type: mapTransactionType(type, amount),
        });
      } else {
        // Format 1: Date, Description, Amount, Balance
        const date = parseDate(cols[0]);
        if (!date) continue;

        const description = cols[1]?.trim() || "";
        const amount = parseAmount(cols[2]);
        const balance = cols.length > 3 ? parseAmount(cols[3]) : null;

        if (amount === 0) continue;

        rows.push({
          date,
          description,
          amount,
          balance,
          type: mapTransactionType("", amount),
        });
      }
    } catch {
      // Skip malformed rows
      continue;
    }
  }

  return rows;
}

/** Parse a single CSV line respecting quoted fields */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/** Parse date in DD/MM/YYYY, YYYY-MM-DD, or DD-MM-YYYY format */
function parseDate(str: string): Date | null {
  const s = str.trim().replace(/"/g, "");
  if (!s) return null;

  // DD/MM/YYYY
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    // If day > 12, it's definitely DD/MM/YYYY. Otherwise assume DD/MM/YYYY (UK format)
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) return d;
  }

  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse amount, handling commas and currency symbols */
function parseAmount(str: string | undefined): number {
  if (!str) return 0;
  const cleaned = str.replace(/[^0-9.\-]/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

/** Map bank type string to our transaction types */
function mapTransactionType(type: string, amount: number): string {
  const t = type.toUpperCase();
  if (t.includes("TRANSFER") || t.includes("TFR")) return "TRANSFER";
  if (t.includes("CHARGE") || t.includes("FEE")) return "BANK_CHARGE";
  if (t.includes("INTEREST") || t.includes("INT")) return "INTEREST";
  return amount >= 0 ? "DEPOSIT" : "WITHDRAWAL";
}

// ---------------------------------------------------------------------------
// POST /api/finance/bank/import-csv
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const bankAccountId = formData.get("bankAccountId") as string | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }
    if (!bankAccountId) {
      return Response.json({ error: "bankAccountId is required" }, { status: 400 });
    }

    // Verify bank account exists
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });
    if (!bankAccount) {
      return Response.json({ error: "Bank account not found" }, { status: 404 });
    }

    // Read and parse CSV
    const csvText = await file.text();
    const rows = parseBarclaysCSV(csvText);

    if (rows.length === 0) {
      return Response.json(
        { error: "No valid transactions found in CSV" },
        { status: 400 }
      );
    }

    // Deduplicate against existing transactions
    const existing = await prisma.bankTransaction.findMany({
      where: { bankAccountId },
      select: {
        transactionDate: true,
        amount: true,
        description: true,
      },
    });

    // Build a set of existing transaction keys for fast lookup
    const existingKeys = new Set(
      existing.map(
        (e) =>
          `${e.transactionDate.toISOString().slice(0, 10)}|${Number(e.amount)}|${e.description}`
      )
    );

    const newRows = rows.filter((row) => {
      const key = `${row.date.toISOString().slice(0, 10)}|${row.amount}|${row.description}`;
      return !existingKeys.has(key);
    });

    if (newRows.length === 0) {
      return Response.json({
        imported: 0,
        skipped: rows.length,
        message: "All transactions already exist",
      });
    }

    // Insert new transactions
    const now = new Date();
    const created = await prisma.bankTransaction.createMany({
      data: newRows.map((row, idx) => ({
        bankAccountId,
        transactionDate: row.date,
        amount: row.amount,
        transactionType: row.type,
        description: row.description,
        runningBalance: row.balance,
        reconciliationStatus: "UNRECONCILED",
        // Generate a fitId from the CSV data for uniqueness
        fitId: `csv-${row.date.toISOString().slice(0, 10)}-${idx}-${Math.abs(row.amount).toFixed(2)}`,
        importedAt: now,
      })),
      skipDuplicates: true,
    });

    // Update bank account balance if we have a balance from the last row
    const lastRowWithBalance = [...newRows].reverse().find((r) => r.balance !== null);
    if (lastRowWithBalance?.balance !== null && lastRowWithBalance?.balance !== undefined) {
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: lastRowWithBalance.balance },
      });
    }

    return Response.json({
      imported: created.count,
      skipped: rows.length - newRows.length,
      total: rows.length,
      message: `Imported ${created.count} transactions, skipped ${rows.length - newRows.length} duplicates`,
    });
  } catch (error) {
    console.error("CSV import failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "CSV import failed" },
      { status: 500 }
    );
  }
}
