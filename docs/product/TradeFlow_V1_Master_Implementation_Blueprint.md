# TradeFlow V1 - Master Implementation Blueprint

## Project Vision

TradeFlow is a business visibility, inventory planning, and restocking management system designed around the client's existing workflow.

The goal is NOT to force POS operations or individual sales recording.

### Goals

- Revenue visibility
- Expense visibility
- Inventory visibility
- Restocking planning
- Budget planning
- Business performance monitoring

---

# Core System Philosophy

## Non-Negotiable Rules

- NO POS
- NO mandatory sales transaction recording
- NO automatic stock deduction from sales
- NO increase in employee workload
- System must align with existing business processes

---

# Current Business Workflow

## Supplier Deliveries

1. Supplier arrives.
2. Employee receives stock.
3. Employee records quantity and supplier cost.
4. Stock is added immediately to inventory.

## Owner Restocking

1. Owner inspects stock.
2. Owner identifies low-stock products.
3. System generates shopping list and budget.
4. Owner purchases stock.
5. Owner records actual purchase quantities and costs.
6. Status becomes Pending Receipt.
7. Employee counts stock received.
8. Employee confirms quantities received.
9. System automatically updates inventory using owner's recorded costs.

---

# User Roles

## Owner

- Full Dashboard Access
- Revenue Management
- Expense Management
- Product Management
- Inventory Management
- Stock Adjustments
- Shop Inspection
- Budget Builder
- Reports
- Settings
- User Management

## Employee

Default Permissions:

- Revenue Entry
- Expense Entry
- Supplier Stock Receiving
- Confirm Owner Restocks

---

# Product Management

## Required Fields

- Product Name
- Category
- Unit Type
- Cost Price
- Selling Price
- Max Stock Level

## Unit Types

- Pieces
- Bottles
- Packs
- Loaves
- Kg
- Grams
- Litres

---

# Inventory Strategy

## Max Stock Level

Recommended Restock = Max Stock Level - Current Stock

## Low Stock Alerts

Products below target stock levels are flagged automatically.

---

# Dual-Path Stock Receiving

## Path A: Supplier Delivery

Employee:

- Select product
- Enter quantity
- Enter supplier cost
- Save delivery

System:

- Adds stock immediately
- Updates inventory
- Updates last cost price
- Records receiving employee

## Path B: Owner Restock

### Step 1: Inspection

Owner performs stock inspection.

### Step 2: Budget Creation

System generates:

- Shopping List
- Budget Estimate

Status: Draft

### Step 3: Purchase Recording

Owner records:

- Quantity Purchased
- Actual Cost Price

Status: Pending Receipt

### Step 4: Stock Receipt Confirmation

Employee:

- Counts stock received
- Confirms quantities received

Employee DOES NOT:

- Edit costs
- Edit budgets
- Edit purchase values

### Step 5: Inventory Update

System:

- Adds stock automatically
- Uses owner's recorded costs
- Updates inventory value
- Updates last cost price
- Records receiving employee

Status: Received

---

# Partial Receipt Handling

Example:

Expected = 20

Received = 18

Variance = -2

Status = Partially Received

---

# Restock Statuses

1. Draft
2. Pending Purchase
3. Pending Receipt
4. Partially Received
5. Received
6. Cancelled

---

# Stock Adjustments

Reasons:

- Damaged
- Expired
- Missing
- Counting Error
- Other

---

# Revenue Management

- Daily Revenue Entry
- Revenue History
- Daily Reports
- Weekly Reports
- Monthly Reports

---

# Expense Management

- Expense Entry
- Expense Categories
- Expense History
- Expense Reports

---

# Inventory Valuation

Inventory Value = Current Stock × Cost Price

---

# Estimated Profitability

Estimated Profit = Revenue - (Expenses + Restocking Costs)

Always label as:

**Estimated Profit**

---

# Dashboard

- Revenue Today
- Revenue This Month
- Expenses This Month
- Inventory Value
- Estimated Profit
- Restocking Cost Summary
- Low Stock Count

---

# Reports

## Revenue Reports

- Daily
- Weekly
- Monthly

## Expense Reports

- By Category
- By Date Range

## Inventory Reports

- Current Stock Levels
- Inventory Valuation
- Low Stock Products

## Restocking Reports

- Budget History
- Supplier Purchases
- Restocking Trends
- Cost Trends

---

# Suggested Development Phases

## Phase 1

- Database Design
- Authentication
- User Roles
- Product Management

## Phase 2

- Revenue Module
- Expense Module

## Phase 3

- Inventory Module
- Supplier Deliveries
- Stock Adjustments

## Phase 4

- Shop Inspection
- Budget Builder
- Restocking Workflow

## Phase 5

- Dashboard
- Reports

## Phase 6

- Barcode Scanning
- Voice Entry

---

# Project Investment

- Total Cost: K3,500
- Deposit: K1,000
- Completion Balance: K2,500
- Timeline: 2–4 Weeks
- Platform: Google Apps Script

---

# Final TradeFlow V1 Definition

TradeFlow V1 is a business visibility and restocking management system designed around real-world small shop operations without requiring POS operations or individual sales recording.
