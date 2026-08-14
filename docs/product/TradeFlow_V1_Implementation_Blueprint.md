# TradeFlow V1 - Implementation Blueprint

## Project Vision

TradeFlow is a business visibility, inventory planning, and restocking management system designed around the client's existing workflow.

The goal is NOT to force POS operations or individual sales recording.

The goal is to improve:

- Revenue visibility
- Expense visibility
- Inventory visibility
- Restocking planning
- Budget planning
- Business performance monitoring

while maintaining the current workflow.

---

# Current Business Workflow

## Stock Sources

### Supplier Deliveries

Fast-moving products are delivered directly by suppliers.

Examples:

- Bread
- Frequently supplied products

Workflow:

1. Supplier delivers stock.
2. Stock is recorded.
3. Stock is added to inventory.

### Owner Restocking

Owner performs physical inspections.

Workflow:

1. Owner visits shop.
2. Identifies low stock items.
3. Purchases replacement stock.
4. Records quantities and costs.

---

## Daily Operations

Employees focus on:

- Selling products
- Serving customers

Employees DO NOT record individual sales.

End of day:

1. Cash counted.
2. Cash handed to owner.
3. Daily revenue recorded.
4. Expenses recorded.

---

## Monthly Review

Owner reviews:

- Revenue
- Expenses
- Stock purchases
- Supplier costs
- Business performance

---

# Core System Philosophy

NO POS.

NO mandatory sales transaction recording.

NO employee workload increase.

System must align with existing business processes.

---

# User Roles

## Owner

Permissions:

- Full dashboard access
- Revenue management
- Expense management
- Product management
- Stock management
- Restocking management
- Reports
- Settings
- User management
- Barcode scanning
- Voice entry

---

## Employee

Default permissions:

- Revenue entry
- Expense entry
- Shop inspection
- Barcode scanning
- Voice entry

---

## Permission Configuration

Owner can enable:

- Add products
- Edit products
- Add stock
- Record restocking

from Settings.

---

# Product Management

## Product Fields

Required:

- Product Name
- Category
- Cost Price
- Selling Price
- Max Stock Level

---

## Profit Margin

Margin:

Selling Price - Cost Price

Example:

Cost Price = K18

Selling Price = K25

Margin = K7

Store:

- Cost Price
- Selling Price
- Margin
- Margin Percentage

---

# Inventory Strategy

## Max Stock Level

Every product has a configured desired stock level.

Example:

Sugar

Max Stock Level = 50

This becomes the target inventory level.

---

# Shop Inspection Mode

Primary inventory workflow.

Owner walks around shop inspecting stock.

---

## Inspection Process

Select Product:

Sugar

Configured Max:

50

Current Stock:

10

System calculates:

Recommended Restock = 40

---

## Override Capability

Owner can accept recommendation OR enter own quantity.

Example:

Current Stock = 10

Recommended Restock = 40

Owner chooses:

Actual Restock = 10

System uses actual quantity for budgeting.

---

# Restock Budget Builder

TradeFlow automatically builds purchasing budgets.

Example:

Sugar

Restock Quantity = 10

Last Cost Price = K18

Budget:

10 x K18 = K180

---

## Budget Summary

Example:

Sugar = K180

Rice = K400

Kapenta = K750

Bread = K300

Total Budget = K1,630

---

# Shopping List Generation

System generates:

- Product
- Quantity Needed

Example:

Sugar - 10

Rice - 20

Kapenta - 15

Bread - 30

---

# Stock Tracking Reality

Because individual sales are NOT recorded:

Automatic stock deduction is not possible.

TradeFlow relies on:

- Physical inspections
- Restocking records
- Inventory adjustments

This is an accepted business decision.

---

# Revenue Management

Features:

- Daily revenue entry
- Revenue history
- Daily summaries
- Weekly summaries
- Monthly summaries
- Revenue reports

---

# Expense Management

Features:

- Expense entry
- Expense categories
- Expense history
- Expense reports

---

# Stock Management

Features:

- Supplier stock recording
- Restocking records
- Stock balances
- Inventory valuation
- Stock history

---

# Inventory Value

Formula:

Inventory Value = Current Stock × Cost Price

---

# Profitability Approach

Exact accounting profit is NOT possible because sales transactions are not recorded.

Client business logic:

Revenue

- Expenses
- Restocking Costs

= Estimated Profit

TradeFlow will use this approach.

Label clearly as:

Estimated Profit

not

Exact Profit

---

# Dashboard

Cards:

- Revenue Today
- Revenue This Month
- Expenses This Month
- Inventory Value
- Estimated Profit
- Restocking Cost Summary

---

# Reports

## Revenue Reports

- Daily
- Weekly
- Monthly

## Expense Reports

- By category
- By period

## Inventory Reports

- Inventory value
- Current stock levels

## Restocking Reports

- Restocking history
- Supplier purchases
- Budget trends

---

# Bonus Features (Under Promise, Over Deliver)

These are not part of the formal proposal but may be included.

## Barcode Scanning

Uses device camera.

Possible uses:

- Product lookup
- Stock entry
- Inspection assistance

---

## Voice Entry

Examples:

"Revenue today 4500"

"Add 20 bottles of Coke"

System converts speech into form data.

---

# Suggested Build Order

Phase 1

1. Database
2. Product Management

Phase 2

1. Revenue Module
2. Expense Module

Phase 3

1. Stock Management
2. Restocking Management

Phase 4

1. Shop Inspection Mode
2. Budget Builder

Phase 5

1. Dashboard
2. Reports

Phase 6

1. Barcode Scanning
2. Voice Entry

---

# TradeFlow V1 Definition

TradeFlow V1 is a business visibility and restocking management system designed around real-world small shop operations.

Primary strengths:

- Revenue tracking
- Expense tracking
- Product catalog management
- Inventory visibility
- Shop inspection workflow
- Restock planning
- Budget planning
- Inventory valuation
- Estimated profitability
- Dashboard reporting

without requiring POS operations.
