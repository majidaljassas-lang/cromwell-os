# Reconciliation System Build Plan

## Goal
Build 3 complete registers, match line-by-line, achieve 100% cleared status.

---

## PHASE 1: BUILD THE THREE REGISTERS

### 1. ORDER REGISTER (Customer Requests)
**Status:** NOT STARTED  
**Source:** WhatsApp, Email, Quotations, Customer POs  
**Structure needed:**
```
OrderID | Customer | Site | OrderDate | LineID | ProductDesc | Qty | UnitPrice | LineTotal
```

**Questions:**
- Where are customer orders stored? (Email exports? WhatsApp backups? Spreadsheets?)
- How many October orders do we have?
- Do we have quotations/proposals that became orders?

---

### 2. PURCHASE REGISTER (What We Ordered from Suppliers)
**Status:** NOT STARTED  
**Source:** Our purchase orders to suppliers  
**Structure needed:**
```
POID | Supplier | PODate | LineID | ProductDesc | Qty | UnitCost | LineTotal | OrderIDFulfilled
```

**Questions:**
- Where are our purchase orders tracked? (Email sent to suppliers? Internal system?)
- How do we match our POs to the supplier invoices we receive?
- Is there a PO numbering system?

---

### 3. INVOICE REGISTER (Supplier Invoices - CLEAN)
**Status:** PARTIALLY DONE (23 clean invoices from October)  
**Source:** Supplier invoices received  
**Structure needed:**
```
InvoiceID | Supplier | InvoiceDate | DueDate | LineID | ProductDesc | Qty | UnitCost | LineTotal | POIDMatched | Status
```

**Current state:**
- 23 clean October invoices (deduplicated, cleaned)
- Missing: Structure as formal register, add PO matching field, add status tracking

---

## PHASE 2: LINE-BY-LINE MATCHING

**Once all 3 registers exist:**
```
OrderLine → PurchaseLine → InvoiceLine → Bank Payment
```

Example matching:
```
Order Line: 20 elbows @ £50
  ↓ MATCH
Purchase Line: 50 elbows @ £2.00 (20 allocated)
  ↓ MATCH  
Invoice Line: 50 elbows @ £2.00 from Crosswater
  ↓ MATCH
Bank Payment: £100 to Crosswater
```

---

## PHASE 3: STATUS TRACKING (CLEARED)

All lines must reach one of these states:

**CLEARED:**
- Order line: 100% sourced from purchases
- Purchase line: 100% allocated to orders
- Invoice line: 100% accounted for in bank payment
- Bank payment: 100% matched to invoices

**UNCLEARED (Red Flag):**
- Order line: Only 80% sourced (20% backorder?)
- Purchase line: Only 80% allocated (20% unaccounted?)
- Invoice line: Only 80% in bank payment (20% variance?)
- Bank payment: No matching invoice (overpayment? error?)

---

## PHASE 4: COST ALLOCATION & PROFIT

Once matched, calculate:
```
Per Order Line:
├─ Revenue: £50
├─ Allocated Cost: 20 × £2.00 = £40
├─ Profit: £10
└─ Margin %: 20%
```

---

## IMMEDIATE ACTIONS NEEDED

1. **Understand data sources:**
   - Where are customer orders? (Email? WhatsApp? Sheets?)
   - Where are our purchase orders? (System? Email? Sheets?)
   - How are they currently organized?

2. **October data availability:**
   - How many customer orders in October?
   - How many purchase orders placed in October?
   - Do we have quotations that became orders?

3. **Matching rules:**
   - How do customer orders link to our purchase orders? (By item? By PO number? By date range?)
   - How do our purchase orders link to supplier invoices? (PO number? Email reference?)
   - How do supplier invoices link to bank payments? (Amount? Supplier? Date?)

---

## CURRENT STATE

✅ **Done:**
- Bank Register: 14,314 lines (verified to penny)
- Invoice Register (partial): 23 clean October supplier invoices

❌ **Not done:**
- Order Register: 0 records
- Purchase Register: 0 records
- Complete Invoice Register structure
- Line-by-line matching engine
- Status tracking
- Cost allocation

---

## NEXT STEP

**Answer the three questions above so I can start building the Order Register and Purchase Register.**
