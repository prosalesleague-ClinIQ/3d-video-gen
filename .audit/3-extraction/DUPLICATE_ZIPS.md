# Duplicate Zips — Safe to Delete

Confirmed via `md5` — all six files below pair to two unique zips. The four "(1)" / "(2)" copies are bit-identical to their canonical version.

| File | md5 | Status |
|---|---|---|
| `Kinect360-TouchDesigner-macOS-arm64.zip` | `d75cd37d9fcbae6fd2ed27b453cdb871` | **KEEP** |
| `Kinect360-TouchDesigner-macOS-arm64 (1).zip` | `d75cd37d9fcbae6fd2ed27b453cdb871` | delete |
| `Kinect360-TouchDesigner-macOS-arm64 (2).zip` | `d75cd37d9fcbae6fd2ed27b453cdb871` | delete |
| `shape-mapper-main.zip` | `3622e61f249457bf88fa6e423805f837` | **KEEP** |
| `shape-mapper-main (1).zip` | `3622e61f249457bf88fa6e423805f837` | delete |
| `shape-mapper-main (2).zip` | `3622e61f249457bf88fa6e423805f837` | delete |

Note: there are also extension-less duplicates `Kinect360-TouchDesigner-macOS-arm64` and `shape-mapper-main` (no `.zip` suffix) — same md5 as the canonical versions. They were already untracked sitting next to the `.zip` files in the project root. Delete them too unless you intentionally renamed something.

## Cleanup commands

```bash
cd "/Users/christomac/Projects/3d video Gen"

# remove the bracketed duplicates
rm "Kinect360-TouchDesigner-macOS-arm64 (1).zip"
rm "Kinect360-TouchDesigner-macOS-arm64 (2).zip"
rm "shape-mapper-main (1).zip"
rm "shape-mapper-main (2).zip"

# (optional) remove the extension-less duplicates — verify they aren't intentional first
ls -la "Kinect360-TouchDesigner-macOS-arm64" "shape-mapper-main" 2>/dev/null
# rm "Kinect360-TouchDesigner-macOS-arm64" "shape-mapper-main"
```

Frees ~19 MB total (~2.9 MB Kinect × 2 + ~16 MB shape-mapper × 2).

## After GOLD extraction is complete

Once `public/lib/maptastic.js`, `public/lib/perspt.js`, `public/hand_filters.js`, and `public/gaze_tracking.js` are in place and verified, the source zips are no longer needed in the project root. Consider moving all 33 zips to `.audit/3-extraction/source-zips/` (or out of the repo entirely) to declutter `git status`. They are already untracked, so no `.gitignore` change is required — but a single `mv *.zip .audit/3-extraction/source-zips/` keeps the project root clean.
