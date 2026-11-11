# MRP Planner — System Architecture & Context Document

## 0. How to use this file
If you are an AI assistant reading this: This document contains the complete architecture, data models, recent bug fixes, and UI logic for a local-only, client-side JavaScript application called **MRP Planner**. 
Please use this context to answer questions, write new features, or debug issues without needing the full conversation history. The core files are `index.html`, `style.css`, `app.js`, and `config.json`.

---

## 1. Core App Overview
- **Type**: Single-Page Application (SPA), fully client-side.
- **Tech Stack**: Vanilla JavaScript (ES6+), HTML5, CSS3, SheetJS (`xlsx.full.min.js`).
- **Storage**: Uses `localStorage` for simple configs/scrap, and `IndexedDB` to persist `FileSystemFileHandle` and `FileSystemDirectoryHandle` objects for the File System Access (FSA) API.
- **Data Privacy**: No data leaves the browser.

---

## 2. Global State (`STATE`)
The application relies on a massive global `STATE` object (exposed as `window.MRP`):
- `STATE.config`: Warehouses, stages, conversion table (Batch Model → BOM).
- `STATE.boms`: Array of parsed BOM objects.
- `STATE.batches`: Array of shipment/production batch objects.
- `STATE.inventory`: Computed material availability per part.
- `STATE.partIndex`: Aggregated index of all parts across all BOMs.
- `STATE.production`: Contains `records` (VINs), `batches` (Map), and period filters.
- `STATE.mrpStock`: Holds `demands` array for the Material Availability Calculator.

---

## 3. The BOM Hierarchy & Composite Keys (CRITICAL)
**Recent Major Refactor**: A "Spec" can have multiple production ways (SKD, CKD) or model years, resulting in different Material Codes. 
We use a **4-level hierarchy** for BOMs:
1. **Spec**: Derived from `specKeyOf(vehicleMatNo)` (first 7 chars, e.g., `T7150U5`).
2. **Material Code Family**: Derived from `matFamilyOf(vehicleMatNo)` (colour code replaced with `XX`, e.g., `T7150U5XXNG0901`).
3. **Colour**: Derived from `colorCodeOf(vehicleMatNo)` (chars 8-9, e.g., `CL`).
4. **BOM ID** (`BOM 1`, `BOM 2`): Generated per `(family + colour)` combination.
5. **Sales Batches**: Linked to the BOM.

**Composite Key**: Because `BOM 1` can exist for both `NG0901` and `NG1001`, we NEVER look up a BOM by `bomId` alone. We use `familyKey::colorCode::bomId` (see `stockVariantKey`).

---

## 4. Key Modules & Functions

### 4.1 File System Access (FSA) & Persistence
- **FSA API**: Used to pick files/folders (`showDirectoryPicker`, `showOpenFilePicker`).
- **IndexedDB (`mrp.fileHandles.v2`)**: Stores file handles to auto-reload on next visit.
- **Browser Limitation**: `requestPermission()` requires a user gesture. 
- **Restore Banner**: `showRestoreSessionBanner()` detects if handles exist but permission is `prompt`, showing a yellow banner for the user to click and re-authorize. 
- **Reload logic**: `reloadBatchFromHandle`, `reloadProductionFromHandle` update the UI text (`#prodFilePath`, `#prodFileInfo`) AND load the data.

### 4.2 Production Monitoring
- **Parsing**: Large CSVs are parsed using a chunked, streaming parser (`parseProductionCSV`) yielding to the UI via `yieldToUI()`.
- **VIN Tracking**: `PROD_STAGES` array defines 005 De-vanning up to Compound Gate-out.
- **Filtering**: Period filters (From/To dates) and Stage (e.g., "Apply on: 020 Trim-in") are staged in `pendingPeriod` and applied via the "Apply" button.

### 4.3 Material Availability Calculator (Multi-Demand)
- **Logic**: Solves how many vehicles can be built based on stock, OR calculates shortages for a specific target.
- **Multi-Model/Multi-Variant**: Users can add multiple independent demands (`{ model, familyKey, colorCode, bomId, qty }`).
- **Aggregation**: `aggregateDemands()` walks all demands, sums the required parts, and compares against the uploaded stock file.
- **UI**: Uses `<optgroup>` in `#stockBom` to group by Material Family. The demand list displays the Material Family badge with the `XX` highlighted.

---

## 5. Recent Bug Fixes & UI Enhancements
- **Duplicate DOM IDs**: Removed duplicate `#sheetPickerModal`, `#batchStats`, `#compTable`, and duplicate `#prodProgressWrap`. Moved `#fileChip-productionFile` from the Planning tab into the Production Monitoring tab.
- **CSS Blue Ramp**: The BOM list hierarchy was redesigned to use a single unified blue palette (no purple/amber) for better contrast without being harsh:
  - Spec: Deep blue gradient (`#1e40af` to `#3b82f6`), white text.
  - Family: Pale blue gradient (`#eff6ff` to `#dbeafe`), dark blue text, solid blue badge (`#1e40af`), `XX` in light blue (`#93c5fd`).
  - Colour: Slate header, 3px blue rail (`#60a5fa`).
  - BOM: Near-white header, 3px light blue rail (`#93c5fd`).
- **Matching**: `openBomDisplay()` now requires `bomId`, `familyKey`, and `colorCode` to accurately target the exact BOM, preventing cross-family overlaps.

---

## 6. File Structure Summary
- `index.html`: Contains the 8 tabs (BOM List, Material List, Production, Inventory, Comparison, Planning, Stored Files, Settings).
- `style.css`: Contains the unified blue ramp for the hierarchy, table styles, and layout.
- `app.js`: Contains all state management, parsers, calculation logic, and DOM wiring.
- `config.json` (optional): Overrides default warehouses and conversion tables.

---

## 7. Development Guidelines for AI
1. **DO NOT** break the composite key logic. Always pass `familyKey` and `colorCode` alongside `bomId` when resolving a BOM.
2. **Always** ensure `querySelector` targets the correct unique ID (the HTML has been cleaned of duplicates).
3. Use `escapeHtml()` for any user-generated text inserted into the DOM to prevent XSS.
4. If modifying the BOM list CSS, stick to the established blue ramp variables. 
5. When writing FSA interactions, remember that `showDirectoryPicker` and `requestPermission` MUST be triggered by a direct user click.

*End of Context Document.*