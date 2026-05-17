# Extract candidates — files/patterns worth pulling into 3D Video Gen

Ordered by relevance to the current 3D Video Gen project (gesture-driven, real-time, motion-tracked rendering).

## TIER 1 — direct code ports

### `/Users/christomac/Projects/Minority Report/`

The original (sibling) Minority Report is the strongest extractable source. All paths below are sibling-relative.

| File | Lines | What it gives us |
|---|---:|---|
| `gestures/air_trackpad.py` | 159 | **1€ filter** (`_OneEuroFilter`, Casiez et al. CHI 2012) with mincutoff/beta/dcutoff. Per-axis instance pattern. Already the canonical implementation. |
| `gestures/swipe.py` | 45 | `SwipeDetector` — ring-buffer wrist-position swipe with cooldown + min_speed threshold. Drop-in for cursor/POV directional input. |
| `gestures/gesture_confidence.py` | 49 | `StabilityGate` — N-consecutive-frames + per-gesture cooldown. Stops misfires. |
| `gestures/mac_trackpad_classifier.py` | 230 | Single-hand classifier on cvzone hand dicts — fingersUp pattern, pinch hysteresis, swipe + circle delegation. The canonical hand-pose → label layer. |
| `gestures/two_hand_gesture_detector.py` | 72 | Two-hand combos (both_palms, both_fists, spread/pinch). Useful for stereo / zoom controls. |
| `fusion/fusion_engine.py` | 104 | Multi-modal fusion (hand + voice + glove) priority resolver. |
| `core/action_router.py` | 97 | Decouples gesture label → action via shortcut map; useful pattern for routing to renderer commands. |
| `main.py` | 892 | Reference top-level pipeline (capture → classify → smooth → fuse → route). |

**Already ported (per `Minority Report copy/`):** entire tree matches sibling except missing `docs/security-feature-analysis.md`.

**Still to pull / verify:**
- `docs/security-feature-analysis.md` — the only doc delta vs the original.
- Confirm the `.python-version`, `requirements.txt`, and `install.sh` are mirrored.

### `/Users/christomac/Projects/ai-command-center/src/`

| File / Dir | What it gives us |
|---|---|
| `src/lib/motion/` | Reusable motion/easing helpers (likely Framer Motion variants). |
| `src/lib/speech/` | Speech recognition wrapper — reusable for voice command in 3D Video Gen. |
| `src/components/terminal/` + `src/app/terminal/` | Terminal-style HUD components — could underpin the diagnostics panel. |
| `src/components/hero/` | Hero/cinematic UI patterns. |
| `src/lib/mcp/` | MCP client helpers. |

## TIER 2 — skills / patterns to promote

### `/Users/christomac/Projects/AI Company/_Skills Library/`

- **`Individual Skills/`** — 4 standalone skills: `Branded_Carousel_Generator_SKILL.md`, `Decision_Council_SKILL.md`, `market-competitors-SKILL.md`, `brand-identity.md`.
- **`KB-Skills/`** — 17 task-oriented skills (`agent-build-plan`, `automation-scheduler`, `cold-email-sequence`, `daily-briefing`, `decision-helper`, `delegation-matrix`, `discovery-call-prep`, `email-triage`, `ghl-daily-pulse`, `kb-add-source`, `lead-magnet-generator`, `prep-day`, `project-overseer`, `prompt-engineer`, `should-i-build-an-agent`, `task-list-manager`, `weekly-review`).
- **`Company-OS-Skills/`** and **`15-cowork-skills/`** — internal company-OS skill packs.
- **`hipaa-industrial-health-app-builder-skill/`**, **`hipaa-health-app-builder-skill/`**, **`hipaa-spoon-test-industrial-builder-skill/`** — HIPAA builder skills (also exist in user skills already, verify de-dup).

**Promotion path:** copy the `KB-Skills/` + `Individual Skills/` markdown into `~/.claude/skills/` after checking each has the YAML frontmatter `description` field skills require.

### `/Users/christomac/Projects/Matrix Academy/.claude/agents/`

9 sub-agent definitions worth reviewing for promotion:
- `brand-guardian.md`, `compliance-editor.md`, `deck-strategist.md`, `ghl-architect.md`, `label-qc.md`, `prompt-compressor.md`, `reuse-finder.md`, `schema-auditor.md`, `ui-auditor.md`.

The `reuse-finder.md` is especially relevant — pairs with the existing `reuse-before-rebuild` skill.

### `/Users/christomac/Projects/AI Company/_Knowledge Base/`

15+ KB markdown docs on agent architecture, prompt engineering, RAG, voice/chat design, autonomous decision agents, building agents with Claude. Not skills, but reference material — consider symlinking into the audit raw folder for retrieval.

## TIER 3 — compliance / docs templates

### `/Users/christomac/Projects/Final Store and site/b2b-emr copy/compliance/`

A complete HIPAA-aligned doc set:
- `ACCESS_CONTROL_MATRIX.md`
- `BREACH_NOTIFICATION_PROCEDURE.md`
- `BUILD_PLAN.md`
- `DATA_MAP.md`
- `DATA_RETENTION_POLICY.md`
- `INCIDENT_RESPONSE_PLAN.md`
- `PARTNER_INTEGRATION_GUIDE.md`
- `RESIDUAL_RISK_REGISTER.md`
- `TEST_AND_VERIFICATION_REPORT.md`
- `THREAT_MODEL.md`

Lift these as templates for any production deployment doc work.

### `/Users/christomac/Projects/Gentle Reminder/docs/`

- `algorithm-transparency/cognitive-scoring.md`
- `cybersecurity/security-risk-assessment.md`
- `data-room/{README,checklist,access-policy}.md`
- `fda-samd-roadmap.md`
- `hipaa-compliance.md`
- `crm-ghl/{contact-id-map,ui-setup-runbook,snippets,tags-taxonomy}.md`

Reusable as starter templates for regulated deployments.

### `/Users/christomac/Projects/Enterprise Synergy/matrix-investor-deck/CINEMATIC-PRODUCTION-BIBLE.md`

Style reference for cinematic 3D motion / camera language — directly relevant to 3D Video Gen visual style.

## Not extracting (just noting)

- `Tipsy Trivia/` — game-loop and pnpm workspace patterns; nothing 3D-relevant.
- `Carrie Boyd Onboarding/generate_matrix_form.py` + `Testapel/generate_kaduceus_form.py` — PDF form fillers, unrelated.
- `mas-site/`, `Final Store and site/matrix-advanced-solutions/` — e-com sites, unrelated.
