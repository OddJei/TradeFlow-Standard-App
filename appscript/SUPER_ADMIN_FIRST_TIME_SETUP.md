# Standard TradeFlow — Super Admin & First-Time Setup

## Locked role model

- **Super Admin = business owner.**
- **Admin = manager/administrator assigned to one shop.**
- **Staff = employee assigned to one shop.**
- NDS is not a separate application role. NDS may assist installation/support, but the created top-level application account belongs to the business owner.

Super Admin can see and manage every shop, all Admin/Staff assignments, system status, spreadsheet sources, sessions, audit information, NCPC status, migration/repair, and protected reset. Ordinary Admins cannot open Multi-Shop or Super Admin and cannot request another shop from the backend.

## First-time wizard

1. **Business details** — business name, owner/contact name, shared Phone/WhatsApp, optional email, business type.
2. **Shop count** — 1, 2, or 3.
3. **Configure each shop** — shop name, receipt prefix, Province, District, Town/Settlement, Area/Compound/Township/Village, Landmark/Address details, and Monday–Sunday opening hours. Area is a free-text autocomplete: it suggests researched town-specific areas first, then district locality hints, while always accepting an unlisted local name.
4. **Primary shop** — explicitly choose the main/primary location.
5. **TradeFlow features** — choose POS, Inventory, Barcode, Restocking, Revenue, Expenses, and Customer Orders. Reports stay included.
6. **Super Admin account** — create the business owner's username and password. No Admin/Staff accounts are created during bootstrap.
7. **Review & create** — create the control spreadsheet and every selected shop spreadsheet.

## Product/integration rules

- NCPC is enabled automatically on every Standard installation.
- Ntheemba is configured later as an add-on.
- All shops share the business Phone/WhatsApp line.
- Every shop keeps its own opening hours and operational spreadsheet.
- The embedded V5 location catalogue includes 407 researched town-specific Area suggestions plus 285 district locality hints. The Area field remains manually editable and never blocks an unlisted compound, township, village, estate, section, or neighbourhood.
- Public Ntheemba shop/location/hours APIs expose only safe business data, never control-plane metadata.

## Destructive controls

Reset, migration, architecture repair/import and other whole-workspace maintenance are Super Admin-only. Reset keeps the existing two-stage confirmation: a server-issued challenge plus a typed confirmation phrase.
