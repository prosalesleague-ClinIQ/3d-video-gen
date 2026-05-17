# Executive Summary — Security + Skills + Extraction Audit

**Branch:** `security-skill-sweep`
**Date:** 2026-05-17
**Scope:** `~/Projects/3d video Gen` (live at https://3d-video-gen.vercel.app + HF Space backend), `~/.claude/skills/` (268 skills), 33 zips dropped in repo root (~880 MB), 13 sibling projects under `~/Projects/`.

---

## 1 · Headline findings

### 🔴 CRITICAL — fix today

| # | Finding | Where | Status |
|---|---------|-------|--------|
| C1 | **Stored XSS** via `surfaces[].name` / `.id` interpolated into `innerHTML` from the unauthenticated project store. Any `player.html?id=<attacker-uuid>` link runs JS in the app origin (webcam access, localStorage, backend calls). | `public/mapper.js:687`, `public/player.js:163`, `public/app.js:1728` | ✅ **PATCHED** — `escHtml()` applied at all 3 sinks |
| C2 | **Unauthenticated CRUD** on `/projection-project`. Anyone can spray malicious projects + share `?id=` links. No auth, no rate-limit, no owner scope. | `demo-service/app.py:579` | ✅ **PATCHED** — 20 writes/60s per-IP rate limit added; strict `SurfaceItem` schema; per-surface URI scheme validation |
| 🚨 | **Supabase `service_role` JWT leaked** in two committed files in sibling projects. Token expires 2036 (effectively non-expiring). | `~/Projects/mas-site/env.local:8`, `~/Projects/Final Store and site/matrix-advanced-solutions/env.local:8` | ⏳ **REQUIRES USER ACTION** — rotate at Supabase dashboard, see `SUPABASE_KEY_ROTATION.md` |

### 🟠 HIGH — fix this week

| # | Finding | Status |
|---|---------|--------|
| H1 | Backend CORS `allow_origins=["*"]` | ✅ **PATCHED** — origin allowlist, env-overridable |
| H2 | Per-surface `uri` not scheme-checked before `<video src>` / `TextureLoader` | ✅ **PATCHED** — client + server side |
| H3 | `surfaces` is `list[dict]` with no per-item schema | ✅ **PATCHED** — `SurfaceItem` Pydantic model |
| H4 | No CSP on any page | ✅ **PATCHED** — `vercel.json` headers block; CSP locks scripts/styles/connect to known origins |
| H5 | No `X-Frame-Options` / `frame-ancestors` | ✅ **PATCHED** — `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| H6 | `public/cam-diag.html` reachable in prod with webcam grant | ⏳ Not removed yet; CSP `frame-ancestors 'none'` mitigates the clickjacking angle |

**Net:** 2/2 CRITICAL patched, 5/6 HIGH patched, 1 HIGH mitigated. See `1-security/SECURITY_FINDINGS.md` for the full MEDIUM/LOW table.

---

## 2 · Skill library state

- **268 skills installed.**
- **30 duplicate / near-duplicate clusters identified** (`2-skills/DUPLICATE_MAP.md`).
- **Worst bloat:** `retellai-*` (30 skills, can consolidate to 6); `ads-*` (18 → 7); `security/security-auditor/vulnerability-scanner/top-web-vulnerabilities` (13 → 4); ElevenLabs verbatim aliases (`agents`/`el-agents`, `music`/`el-music`, etc.) — delete one side of each.
- **Three skills with no `SKILL.md`:** `docs/`, `libreoffice/`, `security/` — remove or reorganize.
- **No prompt-injection risk found** in any SKILL.md (regex hits were benign red-team test fixtures).
- **Recommendation:** 268 → ~150 by deduplication, then → ~110 by pruning unused integrations. A forced 28-skill working core is enumerated in `2-skills/CORE_KEEP_LIST.md`.

---

## 3 · Zip extraction value

33 zips, ~880 MB. Triage in `3-extraction/ZIP_VALUE_MAP.md`:

- **4 GOLD** (browser-runnable, port directly):
  1. `maptasticjs-master/src/maptastic.js` (744 LOC) — drop-in projection-mapping calibration UI; replaces ~600 LOC of bespoke 4-corner code in `mapper.js`
  2. `p5.mapper-main/src/perspective/PerspT.js + numeric.js` (~400 LOC) — pure-JS homography solver; uniform into our WebGL shader for sub-pixel-correct multi-surface warp
  3. `yoha-main/src/core/post_model/post_model.ts` (214 LOC) — temporal pinch-classifier on the same MediaPipe-21-point topology we use; pair with `hand_tracking.js` + `onee_filter.js`
  4. `GazeTracking-master` — eye-tracking enhancement to `head_tracking.js`
- **4 SILVER** — useful patterns but need rewriting
- **17 REFERENCE** — Unity / C++ / inspiration
- **8 SKIP** — including **6 bit-identical duplicate zips** (md5 confirmed; `rm` commands in `3-extraction/DUPLICATE_ZIPS.md`, frees ~19 MB)

**Total port cost:** ~800 LOC ported in, ~600 LOC of bespoke code retired. Estimated 5–8 focused hours.

---

## 4 · Sibling project value

13 projects scanned (`0-inventory/PROJECT_INVENTORY.md`). Highest-value extractions:

1. **`~/Projects/Minority Report/gestures/*.py`** — canonical 1€ filter (already partially ported), swipe detector, stability gate, two-hand detector. Note: `Minority Report copy/` inside this repo is essentially identical — keep one, delete one.
2. **`~/Projects/AI Company/_Skills Library/`** — 21+ curated skills ready to promote into `~/.claude/skills/` after frontmatter check.
3. **`~/Projects/Matrix Academy/.claude/agents/`** — 9 sub-agents; `reuse-finder`, `prompt-compressor`, `ui-auditor` are strongest.
4. **`~/Projects/ai-command-center/src/lib/{motion,speech,mcp}/`** — reusable Framer Motion variants, speech-recognition wrapper, MCP helpers.

---

## 5 · What's still pending (user action required)

1. **🚨 Rotate Supabase `service_role` key** — see `SUPABASE_KEY_ROTATION.md`. Highest urgency.
2. **Deploy patched code** — `vercel --prod` for the frontend, push the HF Space for the backend. CSP enforcement is live the moment the new `vercel.json` deploys.
3. **Remove or gate `public/cam-diag.html`** — not removed yet; either delete from prod or add a noindex + frame-busting check.
4. **Review skill consolidation plan** in `2-skills/DUPLICATE_MAP.md` and `2-skills/CORE_KEEP_LIST.md` — destructive (deletes ~117 skills) so wants your eyes before running.
5. **Decide which GOLD zips to extract** — recommendation order: Maptastic → PerspT → yoha pinch-classifier → GazeTracking.

---

## 6 · Document index

```
.audit/
├── EXECUTIVE_SUMMARY.md        ← you are here
├── ACTION_PLAN.md              ← prioritized punch list
├── SUPABASE_KEY_ROTATION.md    ← step-by-step for the urgent leak
├── 0-inventory/
│   ├── PROJECT_INVENTORY.md
│   ├── EXTRACT_FROM_PROJECTS.md
│   └── SECRET_LEAK_FINDINGS.md     ← redacted, file:line only
├── 1-security/
│   ├── SECURITY_FINDINGS.md        ← 22 findings, CRITICAL→INFO
│   ├── THREAT_MODEL.md             ← STRIDE table
│   ├── CDN_PIN_REPORT.md           ← 13 third-party URLs
│   └── HEADERS_GAP.md              ← what shipped vs. what should
├── 2-skills/
│   ├── SKILL_INVENTORY.md          ← all 268 rows
│   ├── DUPLICATE_MAP.md            ← 30 clusters with keep/merge/delete
│   ├── NAMESPACE_REPORT.md
│   ├── CORE_KEEP_LIST.md           ← ~28 skill working core
│   └── SKILL_RISKS.md
└── 3-extraction/
    ├── ZIP_VALUE_MAP.md            ← all 33 zips triaged
    ├── GOLD_EXTRACTION_PLAN.md     ← 4 GOLD picks with recipes
    └── DUPLICATE_ZIPS.md           ← rm commands
```
