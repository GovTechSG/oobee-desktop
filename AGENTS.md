# Home Page Scan-Type UI Logic

This document defines the expected UI behavior for scan type handling in:

- `src/MainWindow/HomePage/InitScanForm.jsx`
- `src/MainWindow/HomePage/AdvancedScanOptions.jsx`

## Scan Types

From `src/common/constants.js`:

1. `Intelligent crawler`
2. `Sitemap crawler`
3. `Website crawler`
4. `Custom flow`
5. `Local file`

---

## Core Rules

- Avoid index-based assumptions when UI options are filtered.
- Prefer explicit scan type labels for conditional rendering in advanced options.
- URL/File mode switching must preserve a valid non-file scan type.
- `Local file` must only be used as file-mode scan type, not cached as URL-mode fallback.

---

## URL vs File Toggle Behavior

### URL mode
- Scan Type options include all except `Local file`.
- URL/File toggle is:
  - shown for all URL-mode scan types except `Custom flow`
  - hidden for `Custom flow`

### File mode
- Scan Type options must be exactly:
  1. `Local file`
  2. `Sitemap crawler`
- URL/File toggle must remain visible so user can switch back to URL.
- Default selection on URL → File toggle is `Local file`.

### Restoring File → URL mode
- Restore the last cached non-file scan type.
- If cached non-file scan type is `Local file`, fallback to `Intelligent crawler`.
- Do not cache `Local file` as `cachedNonFileScanType`.

---

## Control Visibility Matrix

| Control | Intelligent | Sitemap | Website | Custom flow | Local file |
|---|---|---|---|---|---|
| URL/File toggle (URL mode) | Show | Show | Show | Hide | N/A |
| URL/File toggle (File mode) | N/A | N/A | N/A | N/A | Show |
| Capped at N pages | Show | Show | Show | Hide | Hide |
| File Type dropdown | Show | Show | Show | Hide | Show |
| Allow subdomains for scans | Show | Hide | Show | Hide | Hide |
| Slow Scan Mode | Show | Show | Show | Hide | Hide |
| Adhere to robots.txt | Hide (removed) | Hide (removed) | Hide (removed) | Hide (removed) | Hide (removed) |

---

## File-Type Handling in File Mode

- `Local file`: allow webpage/pdf extensions (`.html`, `.htm`, `.shtml`, `.xhtml`, `.pdf`)
- `Sitemap crawler`: allow sitemap extensions (`.xml`, `.txt`)

---

## Guardrails for Future Changes

- If scan type list order changes, behavior must not break.
- Keep conditional logic label-based where options can be filtered.
- When changing file-mode options, retest:
  - URL → File toggle
  - File → URL toggle
  - dropdown persistence
  - visibility matrix above

---
