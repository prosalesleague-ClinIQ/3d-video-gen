# Action Plan — prioritized

Three buckets: ship the patches, rotate the leaked key, consolidate skills + extract value.

---

## Bucket 1 — Ship the security patches (10 minutes)

All code changes are on branch `security-skill-sweep`. The 6 patched files:

```
public/mapper.js                # XSS C1
public/player.js                # XSS C1
public/app.js                   # XSS C1
public/projection_mapping.js    # H2: client-side URI scheme check
demo-service/app.py             # H1, C2, H3, M1
vercel.json                     # H4, H5, headers
```

### Verify locally

```bash
cd "/Users/christomac/Projects/3d video Gen"
node --check public/mapper.js public/player.js public/app.js public/projection_mapping.js
python3 -c "import ast; ast.parse(open('demo-service/app.py').read())"
```

### Deploy front-end

```bash
vercel --prod
```

Sanity-check CSP shipping:

```bash
curl -sI https://3d-video-gen.vercel.app/ | grep -iE "content-security-policy|x-frame|permissions-policy"
```

Expect: `Content-Security-Policy:` with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self)…`.

### Deploy backend (HF Space)

```bash
cd demo-service
git add app.py
git commit -m "harden: per-IP rate-limit + strict SurfaceItem schema + origin-allowlist CORS"
git push hf main   # whatever the HF Space remote is named
```

Smoke-test the rate limit:

```bash
for i in {1..25}; do
  curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
    https://prosalesleague-3d-video-gen.hf.space/projection-project \
    -H "content-type: application/json" \
    -d '{"name":"test","calibration":{},"surfaces":[],"content":{}}'
done | tail -10
```

Expect: first 20 return `200`, requests 21+ return `429`.

### Smoke-test the XSS fix

Save a malicious-named project:

```bash
curl -s -X POST https://prosalesleague-3d-video-gen.hf.space/projection-project \
  -H "content-type: application/json" \
  -d '{"name":"x","calibration":{},"surfaces":[{"id":"<img src=x onerror=alert(1)>","name":"<script>alert(2)</script>","source":"empty"}],"content":{}}'
```

Open `https://3d-video-gen.vercel.app/player.html?id=<uuid-returned>` — the `<script>` should appear as plain text in the info panel, not execute.

---

## Bucket 2 — Rotate the leaked Supabase key (15 minutes, you-only)

See `SUPABASE_KEY_ROTATION.md` for the step-by-step. Headline:

1. Go to https://supabase.com/dashboard/project/iszlhbzamiqnkprlulxc/settings/api
2. Click **Reset service_role secret**.
3. Update the two `env.local` files with the new key.
4. Rename `env.local` → `.env.local` so Next.js's gitignore catches it.
5. Scrub history in those repos:
   ```bash
   cd ~/Projects/mas-site && git filter-repo --path env.local --invert-paths
   cd "~/Projects/Final Store and site/matrix-advanced-solutions" && git filter-repo --path env.local --invert-paths
   ```
6. Force-push (the two sibling-project repos — NOT this one).

Also rotate any keys in `Tipsy Trivia/.env` per `0-inventory/SECRET_LEAK_FINDINGS.md`.

---

## Bucket 3 — Skill consolidation (1 hour, opt-in)

The destructive part of skill cleanup is a one-shot. Recommended ordering:

### Step 1 — verbatim-duplicate aliases (low risk, 5 minutes)

```bash
cd ~/.claude/skills
# `agents` and `el-agents` are the same SKILL.md — keep the prefixed alias.
rm -rf agents music sound-effects speech-to-text setup-api-key
# Keep el-agents, el-music, el-sound-effects, el-speech-to-text, el-setup-api-key.
```

### Step 2 — namespace consolidation (medium risk)

Open `.audit/2-skills/DUPLICATE_MAP.md` and process clusters in order. Each cluster names the keep, merge, and delete targets.

### Step 3 — review core keep-list

Open `.audit/2-skills/CORE_KEEP_LIST.md`. If you accept the recommendation, archive everything outside the keep-list to `~/.claude/skills.archive.2026-05-17/` rather than deleting.

---

## Bucket 4 — Zip extraction (5–8 hours, opt-in)

Order:

1. **Maptastic** — drop `maptasticjs-master/src/maptastic.js` into `public/lib/` and wire into mapper.js for projection calibration handles. Biggest visible UX win.
2. **PerspT homography** — port to a uniform in the projection_mapping shader for sub-pixel multi-surface warp.
3. **yoha pinch classifier** — add to `public/hand_filters.js` alongside `onee_filter.js`. Reliable "grab corner" events.
4. **GazeTracking** — last polish layer over `head_tracking.js`.

Detailed recipes in `.audit/3-extraction/GOLD_EXTRACTION_PLAN.md`.

Also: delete the duplicate zips (md5-confirmed):

```bash
cd "/Users/christomac/Projects/3d video Gen"
# Exact commands in .audit/3-extraction/DUPLICATE_ZIPS.md
```

---

## Verification checklist after Bucket 1 ships

- [ ] CSP header present on `https://3d-video-gen.vercel.app/`
- [ ] `frame-ancestors 'none'` in CSP
- [ ] `Permissions-Policy: camera=(self)` on every page (not just mapper)
- [ ] `?id=<uuid-of-malicious-project>` no longer alerts
- [ ] 21st rapid `POST /projection-project` returns `429`
- [ ] Saving a project with `surfaces[].uri: "javascript:alert(1)"` returns `400`
- [ ] Saving a project with `surfaces[].id` 1000 chars long returns `422` (Pydantic)
- [ ] Existing projects still load (regression check)
- [ ] Mapper webcam still works
- [ ] Hand tracking still toggles
