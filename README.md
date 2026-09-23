# Material-Replacement-Planning
Cross check material inventory in different status and check if enought for production. 

# MRP Planner

Browser-only Material Requirements Planning tool for SKD vehicle assembly.

## Usage
Open `index.html` (or host the repo with GitHub Pages).

1. **BOM Management** — upload one BOM file per model. Each BOM = parts needed to build **1 vehicle** of that model. Rename each BOM's "model name" so it matches the `Modelo` column in your batch file.
2. **Inventory & Stock** — upload your Batch Sequence CSV. Batches are auto-classified:
   - **Consumed** if `TRIM IN DATE` is past AND `Production = DONE` (excluded from stock).
   - **In Transit** if `Arrival Date` is in the future.
   - **Factory Floor** if `Decanting date` is set and in the past.
   - **Warehouse** otherwise — pick the warehouse manually per batch.
3. **Production Planning** — pick models + quantities, tweak the shortage criteria checkboxes / safety factor, and see the shortage table.

## Data files
- `config.json` — warehouse names, stages, column hints.
- All data lives in memory only; refresh clears everything.

## Limitations & assumptions
See `NOTES.md` (below) — read before relying on numbers.
