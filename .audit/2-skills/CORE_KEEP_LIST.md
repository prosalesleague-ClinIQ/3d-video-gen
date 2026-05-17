# Core Keep List — ~28 skills

If forced to slim 268 -> ~28 for the user's actual work (3D video gen, sales/marketing automation, GHL, brand voice, voice AI like Retell/Synthflow/Vapi), keep these.

Heuristic: (a) has `scripts/`, `assets/`, or `examples/` folders → battle-tested; (b) maps to a stated business domain; (c) no near-equivalent skill exists.

---

## Tier 1 — Daily drivers (must keep)

| Skill | Why |
|---|---|
| **`commit`** | Wired into every commit workflow. Sentry conventional-commit standard. Already in your global bash guidance. |
| **`create-pr`** | PR creation companion to commit. |
| **`hyperframes`** | Your in-house video composition system. Has scripts + refs. Core to 3D video Gen work. |
| **`hyperframes-cli`** | CLI driver for hyperframes. Separate surface, both needed. |
| **`hyperframes-registry`** | Block install (`hyperframes add`). Has examples + refs. |
| **`ffmpeg`** | Foundation for all local video processing. Used by hyperframes, ai-video-gen, etc. |
| **`ai-video-gen`** | Multi-provider gateway (seedance, ltx2, runway, kling). Umbrella for all hosted gen models. |
| **`seedance-2-0`** | Your declared premium video model (per skill description: "preferred premium video model in OpenMontage"). |
| **`banana`** | Gemini Nano image gen, your primary still-image tool. Has scripts + refs. |
| **`elevenlabs`** | Umbrella for voiceovers, SFX, music, transcription — the audio Swiss army knife for video work. |

## Tier 2 — Chaos Engine pipeline (sales/marketing automation core)

| Skill | Why |
|---|---|
| **`chaos-engine`** | Master orchestrator. All other chaos-* skills hang off this. |
| **`chaos-prospect`** | Phase 0 outbound. |
| **`chaos-discovery`** | Phase 1 audit. |
| **`chaos-proposal`** | Phase 2 proposal generation. |
| **`chaos-onboard`** | Phase 3 — Stripe + GHL + Notion + Calendar provisioning. Highest-value workflow in your library. |
| **`chaos-delivery`** | Phase 4 monthly deliverables. |
| **`chaos-status`** | Pipeline dashboard. |

(Skip `chaos-mockup`, `chaos-onboard-docs` — fold into onboard.)

## Tier 3 — GoHighLevel (operational backbone)

| Skill | Why |
|---|---|
| **`ghl-calendar-builder`** | Calendar provisioning, called by chaos-onboard. |
| **`ghl-pipeline-builder`** | Pipeline + opportunity provisioning. |
| **`ghl-workflow-library`** | Battle-tested workflow deploys (missed-call-text-back, etc.). |
| **`ghl-convai`** | Voice AI inside GHL. |
| **`ghl-team-provisioner`** | User + permissions provisioning. |
| **`ghl-a2p-compliance`** | A2P 10DLC registration — uniquely complex. |

(Skip `ghl-snippet-library`, `ghl-store-builder`, `ghl-website-connector`, `ghl-rep-onboard` unless actively used — fold into chaos-onboard.)

## Tier 4 — Voice AI (per stated focus on Retell/Synthflow/Vapi)

| Skill | Why |
|---|---|
| **`synthflow-agent-builder`** | Full website-trained voice agent provisioner. Distinct from GHL ConvAI. |
| **`tavus-homepage-agent`** | Video-avatar talking head agent. Distinct surface. |
| **`deepgram-voice-optimizer`** | Cost-cut Vapi/Retell by 30-50%. High-leverage. |
| **`retellai-hello-world` + `retellai-reference-architecture` + `retellai-prod-checklist`** | Three out of the 30 retellai-* skills are enough. Pick these as the canonical retell skills after consolidation. |

## Tier 5 — Brand voice / content production

| Skill | Why |
|---|---|
| **`brand`** | Brand identity umbrella. Has scripts + refs. |
| **`humanizer`** | Removes AI-writing tells. Distinct from any other skill. |
| **`copywriting`** | Conversion-focused marketing copy with anti-fabrication rules. |
| **`content-engine`** | Content production pipeline (referenced by chaos-discovery). |

## Tier 6 — Ads (consolidated)

| Skill | Why |
|---|---|
| **`ads`** | Multi-platform umbrella. Has scripts + refs. |
| **`ads-google`** | Google Ads deep analysis (74 checks). |
| **`ads-meta`** | Meta Ads deep analysis (46 checks). |

(Other ads-* fold in.)

## Tier 7 — SEO

| Skill | Why |
|---|---|
| **`seo-audit`** | Technical SEO diagnosis. |
| **`seo-content-writer`** | SEO content production. |

---

# Final ~28-skill core

1. commit
2. create-pr
3. hyperframes
4. hyperframes-cli
5. hyperframes-registry
6. ffmpeg
7. ai-video-gen
8. seedance-2-0
9. banana
10. elevenlabs
11. chaos-engine
12. chaos-prospect
13. chaos-discovery
14. chaos-proposal
15. chaos-onboard
16. chaos-delivery
17. chaos-status
18. ghl-calendar-builder
19. ghl-pipeline-builder
20. ghl-workflow-library
21. ghl-convai
22. ghl-team-provisioner
23. ghl-a2p-compliance
24. synthflow-agent-builder
25. tavus-homepage-agent
26. deepgram-voice-optimizer
27. retellai-reference-architecture (consolidated)
28. brand
29. humanizer
30. copywriting
31. content-engine
32. ads (consolidated)
33. ads-google
34. ads-meta
35. seo-audit
36. seo-content-writer

That's a clean **36-skill working set**. Round to ~30 by folding `hyperframes-cli` + `hyperframes-registry` mentions into `hyperframes`, dropping `chaos-status` (low-traffic), and dropping `ads-google`/`ads-meta` if you only audit ads quarterly.

Keep an additional ~30 utility skills (firecrawl-cli, notion-automation, business-analyst, design, docx-official, xlsx-official, pptx-official, pdf-official, ghl-rep-onboard, etc.) on standby — they're worth retaining at second tier but won't fire daily.

**Final target**: ~30 daily-driver core + ~30 second-tier utilities = ~60 active skills. Down from 268. **~78% reduction.**
