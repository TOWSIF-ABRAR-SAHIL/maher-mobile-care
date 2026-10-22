/* Upgrade/repair checks for the v1.1.3 expense-code change.
 *
 * Runs against the suite's throwaway database (provided by run-tests.js).
 * Exercises the first-run normalizer, the backfill script, and audit-money.ts
 * without ever pointing at the live shop database.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_FILE = process.env.MAHER_DB_PATH;
if (!DB_FILE) throw new Error("MAHER_DB_PATH is required");

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

function openDb() {
  const db = new Database(DB_FILE);
  db.pragma("foreign_keys = ON");
  return db;
}

function insertRow(db, overrides = {}) {
  const now = new Date().toISOString();
  const row = {
    customerName: "Expense Upgrade",
    phone: "01700000999",
    model: "Upgrade Model",
    technician: "NURUL",
    problem: "Upgrade probe",
    totalBill: 2000,
    advance: 500,
    due: 1500,
    status: "Pending",
    shopExpense: null,
    expenseAmount: 0,
    partsShop: null,
    returnedAt: null,
    refundAmount: 0,
    refundNote: null,
    damageLoss: 0,
    damageNote: null,
    serviceDate: now,
    archived: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO Service
       (customerName, phone, model, technician, problem, totalBill, advance, due,
        status, shopExpense, expenseAmount, partsShop, returnedAt, refundAmount,
        refundNote, damageLoss, damageNote, serviceDate, archived, createdAt, updatedAt)
       VALUES
       (@customerName, @phone, @model, @technician, @problem, @totalBill, @advance, @due,
        @status, @shopExpense, @expenseAmount, @partsShop, @returnedAt, @refundAmount,
        @refundNote, @damageLoss, @damageNote, @serviceDate, @archived, @createdAt, @updatedAt)`
    )
    .run(row);
  return Number(info.lastInsertRowid);
}

function readRow(db, id) {
  return db.prepare("SELECT * FROM Service WHERE id = ?").get(id);
}

function runTsx(args, label) {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), ...args],
    {
      cwd: ROOT,
      env: { ...process.env },
      encoding: "utf8",
      timeout: 120000,
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (${result.status}): ${result.stdout}\n${result.stderr}`
    );
  }
  return `${result.stdout}\n${result.stderr}`;
}

(async () => {
  const db = openDb();
  let numericId;
  let codeId;
  let amountOnlyId;
  let returnedId;
  let invalidId;
  let negativeId;
  let oversizedId;
  let staleRefundId;
  try {
    numericId = insertRow(db, {
      shopExpense: "1500",
      expenseAmount: 0,
      due: 999,
    });
    codeId = insertRow(db, {
      shopExpense: "*B#",
      expenseAmount: 0,
    });
    amountOnlyId = insertRow(db, {
      shopExpense: null,
      expenseAmount: 700,
      totalBill: 700,
      advance: 0,
      due: 700,
    });
    returnedId = insertRow(db, {
      status: "Returned",
      totalBill: 1000,
      advance: 400,
      due: 400,
      refundAmount: 0,
      returnedAt: new Date().toISOString(),
    });
    invalidId = insertRow(db, {
      shopExpense: "AB$",
      expenseAmount: 0,
    });
    negativeId = insertRow(db, {
      shopExpense: null,
      expenseAmount: -50,
      totalBill: 0,
      advance: 0,
      due: 0,
    });
    oversizedId = insertRow(db, {
      shopExpense: null,
      expenseAmount: 2_000_000_000,
      totalBill: 0,
      advance: 0,
      due: 0,
    });
    staleRefundId = insertRow(db, {
      refundAmount: 50,
    });

    const { normalizeExpenseRows } = await import(
      pathToFileURL(path.join(ROOT, "scripts", "first-run.mjs")).href
    );
    const normalized = normalizeExpenseRows(db);
    const numeric = readRow(db, numericId);
    const code = readRow(db, codeId);
    const amountOnly = readRow(db, amountOnlyId);
    const invalid = readRow(db, invalidId);
    const negative = readRow(db, negativeId);
    const oversized = readRow(db, oversizedId);
    check(
      "U1",
      "first-run converts numeric row and repairs its amount",
      normalized.changed >= 3 &&
        numeric.shopExpense === "*J#" &&
        numeric.expenseAmount === 1500,
      JSON.stringify({ normalized, numeric })
    );
    check(
      "U2",
      "first-run keeps a typed code and repairs its amount",
      code.shopExpense === "*B#" && code.expenseAmount === 1200,
      JSON.stringify(code)
    );
    check(
      "U3",
      "first-run rebuilds a code for an amount-only row",
      amountOnly.shopExpense === "P#" && amountOnly.expenseAmount === 700,
      JSON.stringify(amountOnly)
    );
    check(
      "U4",
      "first-run leaves an invalid code for manual review",
      invalid.shopExpense === "AB$" && invalid.expenseAmount === 0,
      JSON.stringify(invalid)
    );
    check(
      "U4b",
      "first-run never zeroes an empty code with a negative amount",
      negative.shopExpense === null && negative.expenseAmount === -50,
      JSON.stringify(negative)
    );
    check(
      "U4c",
      "first-run leaves an oversized amount-only row for the audit",
      oversized.shopExpense === null &&
        oversized.expenseAmount === 2_000_000_000,
      JSON.stringify(oversized)
    );
  } finally {
    db.close();
  }

  const dryRun = runTsx(["scripts/audit-money.ts"], "audit dry-run");
  const dbAfterDry = openDb();
  const returnedAfterDry = readRow(dbAfterDry, returnedId);
  const staleAfterDry = readRow(dbAfterDry, staleRefundId);
  const negativeAfterDry = readRow(dbAfterDry, negativeId);
  const oversizedAfterDry = readRow(dbAfterDry, oversizedId);
  dbAfterDry.close();
  check(
    "U5",
    "audit dry-run reports returned ledger repair without writing",
    dryRun.includes("Rows with safe repairs: 2") &&
      returnedAfterDry.due === 400 &&
      returnedAfterDry.refundAmount === 0 &&
      staleAfterDry.refundAmount === 50 &&
      negativeAfterDry.expenseAmount === -50 &&
      oversizedAfterDry.expenseAmount === 2_000_000_000,
    dryRun.slice(-700)
  );

  const confirmed = runTsx(
    ["scripts/audit-money.ts", "--confirm"],
    "audit --confirm"
  );
  const dbAfterConfirm = openDb();
  const returnedAfterConfirm = readRow(dbAfterConfirm, returnedId);
  const staleAfterConfirm = readRow(dbAfterConfirm, staleRefundId);
  const invalidAfterConfirm = readRow(dbAfterConfirm, invalidId);
  const negativeAfterConfirm = readRow(dbAfterConfirm, negativeId);
  const oversizedAfterConfirm = readRow(dbAfterConfirm, oversizedId);
  dbAfterConfirm.close();
  check(
    "U6",
    "audit --confirm fixes returned due/refund and preserves manual issues",
    confirmed.includes("Updated 2 row(s)") &&
      returnedAfterConfirm.due === 0 &&
      returnedAfterConfirm.refundAmount === 400 &&
      staleAfterConfirm.refundAmount === 50 &&
      invalidAfterConfirm.shopExpense === "AB$" &&
      negativeAfterConfirm.expenseAmount === -50 &&
      oversizedAfterConfirm.expenseAmount === 2_000_000_000,
    JSON.stringify({ returnedAfterConfirm, staleAfterConfirm, invalidAfterConfirm })
  );

  const backfillDb = openDb();
  const backfillId = insertRow(backfillDb, {
    shopExpense: "800",
    expenseAmount: 0,
    totalBill: 800,
    advance: 0,
    due: 800,
  });
  backfillDb.close();
  const backfillDry = runTsx(
    ["scripts/backfill-expense-codes.ts"],
    "backfill dry-run"
  );
  const beforeBackfillDb = openDb();
  const beforeBackfill = readRow(beforeBackfillDb, backfillId);
  beforeBackfillDb.close();
  check(
    "U7",
    "backfill dry-run lists the numeric row but writes nothing",
    backfillDry.includes("Needs change: 1") &&
      beforeBackfill.shopExpense === "800" &&
      beforeBackfill.expenseAmount === 0,
    backfillDry.slice(-600)
  );
  runTsx(
    ["scripts/backfill-expense-codes.ts", "--confirm"],
    "backfill --confirm"
  );
  const afterBackfillDb = openDb();
  const afterBackfill = readRow(afterBackfillDb, backfillId);
  afterBackfillDb.close();
  check(
    "U8",
    "backfill --confirm writes the canonical code and amount",
    afterBackfill.shopExpense === "T#" && afterBackfill.expenseAmount === 800,
    JSON.stringify(afterBackfill)
  );

  console.log(results.join("\n"));
})().catch((error) => {
  console.error("EXPENSE UPGRADE SUITE CRASH:", error.stack || error);
  failed = true;
  process.exitCode = 1;
}).finally(() => {
  if (failed) process.exitCode = 1;
});
