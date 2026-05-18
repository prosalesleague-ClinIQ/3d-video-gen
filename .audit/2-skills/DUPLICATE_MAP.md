# Duplicate / Near-Duplicate Skill Clusters

For each cluster: **KEEP** = canonical winner. **MERGE** = fold into keep. **DELETE** = redundant.

---

## 1. ElevenLabs (audio) — 9 skills, can shrink to 2

Members: `elevenlabs`, `el-agents`, `el-music`, `el-setup-api-key`, `el-sound-effects`, `el-speech-to-text`, `el-text-to-speech`, `el-voice-isolator`, `elevenlabs-transcribe` (+ standalone `music`, `sound-effects`, `speech-to-text`, `text-to-speech`, `setup-api-key`, `agents` which all duplicate the `el-*` variants).

- **KEEP**: `elevenlabs` (the umbrella skill — covers voiceovers, SFX, music).
- **KEEP**: `el-agents` (this is a distinct product surface — Conversational AI agents).
- **MERGE into `elevenlabs`**: `el-music`, `el-sound-effects`, `el-speech-to-text`, `el-text-to-speech`, `el-voice-isolator`, `el-setup-api-key`, `elevenlabs-transcribe`. These are sub-features of the same API.
- **DELETE (exact aliases)**: `music`, `sound-effects`, `speech-to-text`, `text-to-speech`, `setup-api-key`, `agents` — these are the unprefixed copies of `el-*`. Rationale: same description verbatim. Pick one naming convention (`el-*`) and drop the other.

**Net**: 15 skills -> 2.

---

## 2. Retell AI — 30 skills, can shrink to ~6

Massive bloat. Every conceivable subtopic has its own file with `retellai-*` prefix and copy-pasted intro text. Recommend consolidating into 6 canonical skills.

- **KEEP / MERGE TARGETS**:
  - `retellai-hello-world` (kept as-is — onboarding).
  - `retellai-reference-architecture` (kept — design patterns; merge in `retellai-architecture-variants`, `retellai-sdk-patterns`, `retellai-install-auth`, `retellai-local-dev-loop`, `retellai-multi-env-setup`).
  - `retellai-webhooks-events` (kept; merge in `retellai-data-handling`, `retellai-rate-limits`, `retellai-reliability-patterns`).
  - `retellai-prod-checklist` (kept; merge in `retellai-deploy-integration`, `retellai-ci-integration`, `retellai-policy-guardrails`, `retellai-load-scale`, `retellai-observability`, `retellai-performance-tuning`, `retellai-cost-tuning`, `retellai-incident-runbook`, `retellai-enterprise-rbac`).
  - `retellai-known-pitfalls` (kept; merge in `retellai-common-errors`, `retellai-advanced-troubleshooting`, `retellai-debug-bundle`).
  - `retellai-upgrade-migration` (kept; merge in `retellai-migration-deep-dive`, `retellai-core-workflow-a`, `retellai-core-workflow-b`, `retellai-security-basics`).

- **DELETE outright** (placeholder boilerplate, no unique value): `retellai-core-workflow-a`, `retellai-core-workflow-b` (literally named "Workflow A" / "Workflow B" with no business specifics).

**Net**: 30 skills -> 6. **This is the single highest-yield deduplication.**

---

## 3. Security / Pen-test — 13 skills, can shrink to 4

Members: `security` (broken — folder, no SKILL.md), `security-auditor`, `vulnerability-scanner`, `top-web-vulnerabilities`, `api-security-best-practices`, `backend-security-coder`, `frontend-security-coder`, `ethical-hacking-methodology`, `burp-suite-testing`, `linux-privilege-escalation`, `cloud-penetration-testing`, `fortress-audit`, `cc-skill-security-review`.

- **KEEP**: `security-auditor` (umbrella DevSecOps / compliance).
- **KEEP**: `fortress-audit` (your bespoke repo-scoring tool — unique).
- **KEEP**: `vulnerability-scanner` (OWASP catalog reference).
- **KEEP**: `ethical-hacking-methodology` (pen-test lifecycle — distinct).
- **MERGE into `security-auditor`**: `api-security-best-practices`, `backend-security-coder`, `frontend-security-coder`, `cc-skill-security-review`.
- **MERGE into `ethical-hacking-methodology`**: `burp-suite-testing`, `linux-privilege-escalation`, `cloud-penetration-testing`, `top-web-vulnerabilities`.
- **DELETE**: `security` (broken — folder of aws-* subdirs, no SKILL.md at root; orphaned).

**Net**: 13 -> 4.

---

## 4. Video Generation / Editing — 11 skills, can shrink to 4

- **KEEP**: `ai-video-gen` (multi-provider gateway umbrella).
- **KEEP**: `ffmpeg` (lowest-level, frequently needed).
- **KEEP**: `hyperframes` (your in-house composition system).
- **KEEP**: `seedance-2-0` (your declared premium model).
- **MERGE into `ai-video-gen`**: `ltx2`, `create-video`, `avatar-video`, `faceswap`, `video_toolkit`, `video-translate`.
- **DELETE**: `heygen` (its own description literally says `[DEPRECATED]`).
- **MERGE into `ffmpeg`**: `video-edit`, `video-download`, `video-understand` (small focused tools that overlap).

**Net**: 11 -> 4.

---

## 5. Ads — 18 skills, can shrink to 7

- **KEEP**: `ads` (umbrella audit), `ads-plan` (strategy), `ads-create` (creative brief), `ads-generate` (image creative), `ads-audit` (high-level audit).
- **KEEP** platform-specifics that have unique 20-70 check counts: `ads-google`, `ads-meta`. These are deep and used.
- **MERGE into `ads`** as sub-routines (they share scoring framework): `ads-apple`, `ads-linkedin`, `ads-microsoft`, `ads-tiktok`, `ads-youtube`.
- **MERGE into `ads-create`**: `ads-creative`, `ads-photoshoot`.
- **MERGE into `ads-plan`**: `ads-budget`, `ads-competitor`, `ads-dna`, `ads-landing`.

**Net**: 18 -> 7.

---

## 6. SEO — 7 skills + 2 content overlaps, can shrink to 3

- **KEEP**: `seo-audit` (technical diagnosis), `seo-fundamentals` (theory ref), `seo-content-writer` (content production).
- **MERGE into `seo-audit`**: `seo-cannibalization-detector`, `seo-structure-architect`, `schema-markup`, `programmatic-seo`.
- **MERGE into `seo-content-writer`**: `seo-content-auditor`, `seo-content-planner`, `content-creator`.

**Net**: 9 -> 3.

---

## 7. Email — 8 skills, can shrink to 3

- **KEEP**: `email` (umbrella inbox + marketing), `email-write` (composition), `email-plan` (strategy).
- **MERGE into `email`**: `email-check`, `email-audit`, `email-review`.
- **MERGE into `email-write`**: `email-sequence`, `copywriting` (copywriting is broader but mostly overlaps with email-write).

**Net**: 8 -> 3.

---

## 8. Git / PR workflow — 8 skills, can shrink to 3

- **KEEP**: `commit` (the canonical commit skill — already wired in user defaults), `create-pr` (PR creation), `git-advanced-workflows` (rebase / recovery / clean history).
- **MERGE into `git-advanced-workflows`**: `git-pushing`, `changelog-automation`.
- **MERGE into `create-pr` flow**: `requesting-code-review`, `receiving-code-review`, `code-review-checklist`.

**Net**: 8 -> 3.

---

## 9. Notion — 5 skills, can shrink to 2

- **KEEP**: `notion-automation` (general MCP-based CRUD), `notion-meeting-intelligence` (your highest-value use case).
- **MERGE**: `notion-knowledge-capture`, `notion-research-documentation`, `notion-spec-to-implementation` into `notion-automation` as named workflows.

**Net**: 5 -> 2.

---

## 10. Firecrawl — 8 skills, can shrink to 2

- **KEEP**: `firecrawl-cli` (the high-level umbrella), `firecrawl-agent` (autonomous extraction — distinct mode).
- **MERGE into `firecrawl-cli`**: `firecrawl-scrape`, `firecrawl-crawl`, `firecrawl-map`, `firecrawl-download`, `firecrawl-search`, `firecrawl-interact`.

**Net**: 8 -> 2.

---

## 11. GHL — 10 skills, KEEP ALL

Each one provisions a distinct GHL surface (calendar, pipeline, store, snippets, team, compliance, workflows, convai, rep onboarding, website connector). They are operational and unique. **No dedup.**

---

## 12. Chaos Engine — 9 skills, KEEP ALL

`chaos-engine` orchestrates the others (`chaos-prospect`, `discovery`, `proposal`, `onboard`, `onboard-docs`, `mockup`, `delivery`, `status`). They are pipeline phases, not duplicates. **No dedup.**

---

## 13. GSAP — 8 skills, can shrink to 2

Eight separately-namespaced GSAP refs. Useful but extremely granular.

- **KEEP**: `gsap-core` (API), `gsap-scrolltrigger` (the most-used plugin).
- **MERGE into `gsap-core`**: `gsap-timeline`, `gsap-utils`, `gsap-performance`, `gsap-react`, `gsap-frameworks`, `gsap-plugins`.

**Net**: 8 -> 2.

---

## 14. HIPAA — 3 skills, can shrink to 1

- **KEEP**: `hipaa-industrial-health-app-builder-v2` (latest, richest — has scripts, assets, examples, refs).
- **DELETE**: `hipaa-health-app-builder`, `hipaa-industrial-health-app-builder` (v1's — superseded).

**Net**: 3 -> 1.

---

## 15. Image generation — 4 skills, can shrink to 2

- **KEEP**: `banana` (Gemini Nano — has scripts and refs, your primary), `flux-best-practices` (FLUX reference).
- **MERGE into `flux-best-practices`**: `bfl-api`.
- **KEEP**: `grok-media` (different vendor — xAI).

**Net**: 4 -> 3.

---

## 16. Office docs — 6 skills, can shrink to 4

- **KEEP**: `docx-official`, `xlsx-official`, `pptx-official`, `pdf-official` (each has Python scripts and is well-developed).
- **DELETE**: `office-productivity` (umbrella with no unique content).
- **DELETE**: `libreoffice` (broken — folder of subdirs, no SKILL.md).

**Net**: 6 -> 4.

---

## 17. Hubspot — 2 skills, can shrink to 1

- **KEEP**: `hubspot-integration` (richer patterns guide).
- **MERGE**: `hubspot-automation` (Rube MCP cheat sheet) as a section.

**Net**: 2 -> 1.

---

## 18. Stripe — 2 skills, can shrink to 1

- **KEEP**: `stripe-integration` (deep patterns).
- **MERGE**: `stripe-automation` (Rube MCP CRUD).

**Net**: 2 -> 1.

---

## 19. RAG — 2 skills, can shrink to 1

- **KEEP**: `rag-engineer` (richer).
- **DELETE**: `rag-implementation` (description is almost identical, lighter content).

**Net**: 2 -> 1.

---

## 20. Hyperframes — 3 skills, KEEP ALL

- `hyperframes` (composition authoring), `hyperframes-cli` (CLI commands), `hyperframes-registry` (add command). These are genuinely distinct surfaces of one product. **No dedup.**

---

## 21. Test — 4 skills, can shrink to 2

- **KEEP**: `test-driven-development` (methodology), `e2e-testing-patterns` (E2E patterns).
- **MERGE into `test-driven-development`**: `test-fixing`.
- **KEEP**: `playwright-recording` — actually about screen-recording, mis-namespaced. Rename `screen-recording`.

**Net**: 4 -> 3.

---

## 22. Google Sheets — 2 near-exact dupes

- **KEEP**: `google-sheets-automation` (standalone OAuth, no MCP needed — more portable).
- **DELETE**: `googlesheets-automation` (MCP-only variant; weaker).

**Net**: 2 -> 1.

---

## 23. Vercel — 2 skills, KEEP BOTH

- `vercel-composition-patterns` and `vercel-react-best-practices` cover distinct topics (composition vs perf). **No dedup.**

---

## 24. Prompt — 2 skills, KEEP BOTH

- `prompt-caching` (caching strategy) vs `prompt-engineering` (general prompting). Distinct.

---

## 25. Observability — 5 skills, can shrink to 2

- **KEEP**: `observability-engineer` (umbrella), `incident-responder` (operations).
- **MERGE into `observability-engineer`**: `distributed-tracing`, `slo-implementation`, `postmortem-writing`.

**Net**: 5 -> 2.

---

## 26. Startup / KPI — 5 skills, can shrink to 2

- **KEEP**: `business-analyst` (richest), `startup-financial-modeling` (financials specifically).
- **MERGE into `business-analyst`**: `startup-metrics-framework`, `kpi-dashboard-design`, `market-sizing-analysis`.

**Net**: 5 -> 2.

---

## 27. Design — 7 skills, can shrink to 3

- **KEEP**: `design` (rich umbrella — has scripts and refs), `frontend-design` (engineering side), `banner-design` (concrete output type).
- **MERGE into `design`**: `design-system`, `canvas-design`, `visual-style`, `ui-styling`.

**Net**: 7 -> 3.

---

## 28. Auth / API keys — 3 skills, can shrink to 1

- **KEEP**: `auth-implementation-patterns` (real auth patterns).
- **DELETE**: `setup-api-key` and `el-setup-api-key` (both are the same ElevenLabs key-setup tutorial; covered by ElevenLabs umbrella).

**Net**: 3 -> 1.

---

## 29. Manim — 3 skills, KEEP ALL

`manim-composer` (high-level) plus `manimce-best-practices` / `manimgl-best-practices` (distinct libraries). **No dedup.**

---

## 30. Brand voice / writing — assorted

- **KEEP**: `brand` (rich umbrella — has scripts/refs), `humanizer` (distinct purpose: anti-AI writing patterns).
- `copy-editing`, `copywriting`, `content-creator` are covered above (merged into email-write / seo-content-writer).

---

# Tally

Aggregating the reductions above:

| Cluster | From | To | Saved |
|---|---|---|---|
| ElevenLabs | 15 | 2 | 13 |
| Retell AI | 30 | 6 | 24 |
| Security | 13 | 4 | 9 |
| Video gen/edit | 11 | 4 | 7 |
| Ads | 18 | 7 | 11 |
| SEO | 9 | 3 | 6 |
| Email | 8 | 3 | 5 |
| Git workflow | 8 | 3 | 5 |
| Notion | 5 | 2 | 3 |
| Firecrawl | 8 | 2 | 6 |
| GSAP | 8 | 2 | 6 |
| HIPAA | 3 | 1 | 2 |
| Image gen | 4 | 3 | 1 |
| Office | 6 | 4 | 2 |
| Hubspot | 2 | 1 | 1 |
| Stripe | 2 | 1 | 1 |
| RAG | 2 | 1 | 1 |
| Test | 4 | 3 | 1 |
| Sheets | 2 | 1 | 1 |
| Observability | 5 | 2 | 3 |
| Startup/KPI | 5 | 2 | 3 |
| Design | 7 | 3 | 4 |
| Auth | 3 | 1 | 2 |
| **Subtotal removable** | | | **117** |

**Bottom line**: ~117 skills can be deleted or merged. Library shrinks from **268 -> ~151**.

If you also drop the bottom 30-40 singletons you never trigger (deepgram-voice-optimizer, plaid-fintech, zendesk-automation, sendgrid-automation, paypal-integration, lottie-bodymovin, framer-motion, d3-viz, etc.), you can hit a clean **~100-110 skill core**.
