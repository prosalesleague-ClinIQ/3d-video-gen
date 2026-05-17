# Namespace Report

Skills grouped by prefix (token before first `-`). 268 total skills, distributed across ~30 named namespaces + 116 singletons.

## Multi-member namespaces, ranked by size

| Namespace | Count | Recommendation |
|---|---|---|
| `retellai-*` | 30 | **Consolidate to 6** canonical files. Massive boilerplate duplication — every subtopic was given its own SKILL.md with copy-pasted intro paragraphs. See DUPLICATE_MAP cluster 2. |
| `ads-*` | 18 | **Consolidate to 7.** Platform-specific files (`ads-apple`, `ads-tiktok`, `ads-microsoft`, `ads-linkedin`, `ads-youtube`) share scoring framework and should be sub-routines of `ads`. Keep `ads-google` and `ads-meta` separate (deepest, most-used). See cluster 5. |
| `ghl-*` | 10 | **Keep all 10.** Each provisions a distinct GHL surface (calendar, pipeline, store, snippets, team, workflows, etc.). Operational and unique. |
| `chaos-*` | 9 | **Keep all 9.** They are pipeline phases of the Chaos Engine orchestrator, not duplicates. |
| `firecrawl-*` | 8 | **Consolidate to 2** (`firecrawl-cli` + `firecrawl-agent`). The crawl/scrape/map/download/search/interact splits create artificial fragmentation of one CLI. |
| `gsap-*` | 8 | **Consolidate to 2** (`gsap-core` + `gsap-scrolltrigger`). Eight ref files for one library is overkill; merge timeline/utils/react/perf/plugins/frameworks into core. |
| `el-*` | 7 | **Consolidate to 2** (`elevenlabs` + `el-agents`). Also delete the 6 unprefixed aliases (`music`, `sound-effects`, `text-to-speech`, `speech-to-text`, `agents`, `setup-api-key`) which duplicate `el-*` verbatim. |
| `email-*` | 7 | **Consolidate to 3** (`email`, `email-write`, `email-plan`). Audit/check/review/sequence fold into the three keepers. |
| `seo-*` | 7 | **Consolidate to 3** (`seo-audit`, `seo-fundamentals`, `seo-content-writer`). |
| `notion-*` | 5 | **Consolidate to 2** (`notion-automation`, `notion-meeting-intelligence`). Knowledge-capture / research-doc / spec-to-impl are workflows of automation. |
| `video-*` | 4 | **Consolidate to 1** alongside `ffmpeg`. `video-edit` / `video-download` / `video-translate` / `video-understand` are thin wrappers. |
| `google-*` | 3 | Keep; calendar/sheets/slides automations are genuinely separate APIs. Note: `googlesheets-automation` is a near-dup of `google-sheets-automation` (one extra hyphen). Delete the un-hyphenated one. |
| `hipaa-*` | 3 | **Consolidate to 1** (`hipaa-industrial-health-app-builder-v2`). V1 + non-industrial are superseded. |
| `hyperframes-*` | 3 | **Keep all 3** — `hyperframes` (composition), `hyperframes-cli` (CLI), `hyperframes-registry` (block install). Genuinely distinct surfaces. |
| `ai-*` | 2 | Keep both. |
| `content-*` | 2 | Keep `content-engine`; merge `content-creator` into seo-content-writer. |
| `create-*` | 2 | Keep both (`create-pr`, `create-video`). |
| `design-*` | 2 | Merge `design-system` into `design`. |
| `elevenlabs-*` | 2 | Merge `elevenlabs-transcribe` into `elevenlabs`. |
| `frontend-*` | 2 | Keep both (design vs security — distinct). |
| `git-*` | 2 | Keep `git-advanced-workflows`; merge `git-pushing`. |
| `hubspot-*` | 2 | Merge `hubspot-automation` into `hubspot-integration`. |
| `prompt-*` | 2 | Keep both (caching vs engineering). |
| `rag-*` | 2 | Keep `rag-engineer`; delete `rag-implementation`. |
| `security` / `security-auditor` | 2 | Delete `security` (broken — folder, no SKILL.md). Keep `security-auditor`. |
| `startup-*` | 2 | Merge both into `business-analyst`. |
| `stripe-*` | 2 | Merge `stripe-automation` into `stripe-integration`. |
| `test-*` | 2 | Merge `test-fixing` into `test-driven-development`. |
| `vercel-*` | 2 | Keep both. |

## Singletons (116)

Most singletons are fine, but several are obvious dead weight given your actual workflows (3D video gen, sales/marketing automation, GHL, brand voice, voice AI):

**Candidates for deletion (low evidence of use, no scripts/assets):**
- `acestep` — duplicate of music gen, separate tool.
- `algolia-search` — no signs of Algolia usage in repo.
- `airtable-automation`, `zendesk-automation`, `sendgrid-automation`, `paypal-integration`, `plaid-fintech`, `twilio-communications`, `shopify-automation`, `slack-automation` — generic integration starters; load on demand if you ever need them.
- `claude-youtube` — niche, mostly overlaps with video-understand / ads-creative.
- `d3-viz`, `lottie-bodymovin`, `framer-motion` — animation libs unrelated to your 3D video work or HyperFrames.
- `langfuse`, `langgraph`, `llm-app-patterns` — keep `llm-app-patterns` as the umbrella, drop the rest unless you actively use them.
- `pci-compliance` — unused unless you build payments-heavy apps.
- `monetization`, `launch-strategy`, `competitive-landscape`, `competitor-alternatives` — marketing planning singletons; high overlap with `business-analyst`.
- `documentation-templates`, `concise-planning`, `one-pass-build`, `build-delta`, `reuse-before-rebuild`, `project-map` — process meta-skills; review whether you've actually triggered them in the last 60 days.
- `office-productivity`, `lint-and-validate`, `asset-manifest` — meta/glue skills, evaluate by usage.

## Recommendation summary

Drop bloated namespaces from 30+18+13+8+8+7+7+7+5+5 = **108 skills across the 10 worst offenders down to ~33**. Then prune the 30-40 unused singletons. End state: a clean **~100-110 skill core** that maps to your actual work (Chaos Engine, GHL, voice AI, ads/SEO, content, video, design).
