# Project Inventory — siblings under `/Users/christomac/Projects/`

Scanned 2026-05-17. Skipped pure-content folders (Peptide Label, Distributor Scraping system, dosing guide, labels generator, pricing sheet, New Product Protocol, GHL Contacts and Email Templates, Matrix Advanced Solutions Contracts, invoices kaduceus, ClinIQ AIDE new site, Destination Future, KADUCEUS DIRECT TO PATIENT, Muscle Lock, NEW SITE MATRIX, Peptide Training, matrix order savings, matrix-advanced-solutions, matrix-store, new musclelock website, pharmacy onboarding).

Relevance scale: **HIGH** = direct port targets; **MED** = patterns/skills worth pulling; **LOW** = unrelated to 3D Video Gen.

| Project | Purpose | Tech-stack | Has .env? | Size | Last-modified | Relevance |
|---|---|---|---|---|---|---|
| `ai-command-center` | Matrix internal command-center (agents, campaigns, terminal UI, nexus, production) | Next.js 15 / TS / Tailwind | no (gitignored) | 846 M | May 11 2026 | **MED** — terminal/HUD components, motion+speech libs |
| `ai-company-portal` | Internal portal (departments, KB browser, skills browser, leads, workflows) | Next.js / TS | no | 711 M | May 11 2026 | **MED** — skills-browser + KB markdown loader pattern |
| `AI Company` | Knowledge base + skill library hub (huge); contains `_Skills Library/`, `Skill Packs/`, audiobooks, zip stash | Markdown / mixed | 3 `.env.example` only | **16 G** | May 17 2026 | **HIGH** — 100+ curated skills, KB articles, agent patterns |
| `Minority Report` | Hand-tracking gesture → Mac control daemon: 1€ filter, swipe detector, fusion engine, stability gate, BLE glove, voice fusion | Python 3 / cvzone / MediaPipe | none | 915 M | May 5 2026 | **HIGH** — already partly ported; everything reusable for 3D Video Gen |
| `Minority Report copy` (inside this repo) | Working copy of above, currently being ported | Python 3 | none | n/a | May 17 2026 | **HIGH** — destination of port |
| `Matrix Academy` | LMS content + brand docs + Claude sub-agents (`.claude/agents/`) | Node/markdown content site | 1 `.env.local.example` | 717 M | Apr 8 2026 | **MED** — sub-agents (brand-guardian, ui-auditor, reuse-finder, prompt-compressor) reusable |
| `mas-site` | Matrix Advanced Solutions e-com / lead site | Next.js / TS / Supabase / Stripe | **YES — `env.local` w/ real keys** | 741 M | May 1 2026 | LOW (unrelated) — but **SECURITY HOT** |
| `Enterprise Synergy` | Investor decks (HTML/CSS) — v1 + v2 | Static HTML, GSAP | none | 804 M | Mar 24 2026 | LOW — but `CINEMATIC-PRODUCTION-BIBLE.md` is a stylistic reference for 3D motion |
| `Tipsy` | Empty placeholder | — | — | 0 B | Mar 2 2026 | LOW |
| `Tipsy Trivia` | Quiz/trivia app, client+server workspace | pnpm workspace / Docker / Vercel / Railway | **YES — `.env`, `.env.vercel`, `.env.vercel.prod`, `.vercel/.env.development.local`** | 1.8 G | Mar 29 2026 | LOW — **SECURITY HOT** |
| `Final Store and site` | Multi-app store + B2B EMR (4 sub-projects, one duplicated as "copy", HIPAA compliance docs) | Next.js / TS / Supabase / Stripe | **YES — 2 real `env.local`, 1 template** | 2.1 G | May 14 2026 | **MED** — HIPAA compliance doc set (THREAT_MODEL, ACCESS_CONTROL_MATRIX, DATA_MAP, BREACH_NOTIFICATION) reusable; **SECURITY HOT** |
| `Carrie Boyd Onboarding` | Client onboarding docs + Python PDF form generator (`generate_matrix_form.py`) | Python / PDFs | none | 8.7 M | Apr 1 2026 | LOW |
| `Testapel` | Kaduceus contract assets + Python form generator | Python / PDFs / docx | none | 15 M | Mar 30 2026 | LOW |
| `Gentle Reminder` | Health watch app monorepo (apps, packages, services, watch-app), HIPAA, FDA SaMD roadmap | Turborepo / TS / Next.js | 1 `.env.example` only | 1.4 G | Apr 22 2026 | **MED** — `docs/` has reusable HIPAA, FDA-SaMD, algorithm-transparency, cybersecurity templates |

## Notes

- Two `Minority Report` copies exist (`/Projects/Minority Report` original + `/Projects/3d video Gen/Minority Report copy`). Original docs include an extra `security-feature-analysis.md` not yet copied; otherwise the working trees diff-clean on `main.py` and `gestures/air_trackpad.py`.
- `AI Company` has **multiple** skill-pack snapshots that overlap (`_Skills Library/15-cowork-skills/` and `Skill Packs/15-cowork-skills (root snapshot — subset of _Skills Library copy)`). De-dup before promoting.
- Disk footprint is dominated by `node_modules`, audiobooks (`AI Company` has two ~200 MB+ .m4b files), Vercel build caches, and bundled zips. Anything beyond 500 M is mostly transient.
