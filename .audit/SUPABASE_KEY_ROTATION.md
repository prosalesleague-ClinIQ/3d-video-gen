# Supabase service_role JWT rotation — 15-minute runbook

## Why this is urgent

Two committed files in sibling projects contain a Supabase **`service_role`** JWT for project `iszlhbzamiqnkprlulxc`. The `service_role` key:

- bypasses Row-Level Security entirely;
- can read, write, and delete **any row in any table**;
- expires in 2036 (effectively non-expiring);
- was committed because both files are named `env.local` (no leading dot), so Next.js's default `.env*.local` gitignore pattern does NOT cover them.

If either repo is public — or ever was public, even briefly — assume the key is compromised.

## Files containing the key (verified by the project-inventory agent)

```
~/Projects/mas-site/env.local:8
~/Projects/Final Store and site/matrix-advanced-solutions/env.local:8
```

(The literal value is redacted in `.audit/0-inventory/SECRET_LEAK_FINDINGS.md`.)

---

## Step 1 — Rotate the key (do this first; everything else can wait)

1. Open https://supabase.com/dashboard/project/iszlhbzamiqnkprlulxc/settings/api
2. Scroll to **Project API keys → service_role**.
3. Click **Reset service_role secret**.
4. Copy the new key.

The old key is now invalid. Any compromised actor's session dies immediately.

## Step 2 — Audit recent access

Same dashboard, **Logs → Auth / Database**. Look back ~30 days. Flag:

- writes to your most sensitive tables (users, billing, secrets)
- mass reads at unusual times
- queries from unfamiliar IPs

If you see anything suspicious, snapshot the logs and escalate.

## Step 3 — Update the new key in your codebases

```bash
# mas-site
cd ~/Projects/mas-site
echo "SUPABASE_SERVICE_ROLE_KEY=<paste new key>" > .env.local   # NEW name with leading dot
# (Re-add any other vars from old env.local)
git rm env.local
echo "env.local" >> .gitignore
echo ".env.local" >> .gitignore   # belt + braces
git add .gitignore
git commit -m "Rename env.local → .env.local; gitignore both names"
```

Repeat for `~/Projects/Final Store and site/matrix-advanced-solutions/`.

## Step 4 — Scrub history (if either repo is public OR shared)

```bash
# Requires: pipx install git-filter-repo
cd ~/Projects/mas-site
git filter-repo --path env.local --invert-paths
git remote add origin <your-remote-url>     # filter-repo strips remotes by design
git push --force-with-lease origin main
```

Repeat for the second repo. **Coordinate with any collaborators** before force-pushing — their clones will need to be re-fetched.

## Step 5 — Verify the new key isn't leaked anywhere else

```bash
cd ~/Projects
grep -RIn --include='*.env*' --include='env.*' --include='*.local' \
  -e 'service_role' -e 'eyJhbGciOi' \
  ./ 2>/dev/null
```

Any hit needs the same rotation treatment.

## Step 6 — Set up a guardrail (one-time, 5 minutes)

Add a pre-commit hook so this can't recur:

```bash
cat > ~/.git-hooks/pre-commit <<'EOF'
#!/bin/sh
if git diff --cached --name-only | xargs -I{} grep -l "service_role\|eyJhbGciOi" {} 2>/dev/null; then
  echo "BLOCKED: staged file contains a Supabase service_role key."
  exit 1
fi
EOF
chmod +x ~/.git-hooks/pre-commit
git config --global core.hooksPath ~/.git-hooks
```

---

## Also rotate (lower urgency, in `SECRET_LEAK_FINDINGS.md`)

- `Tipsy Trivia/.env:9, :24` — verify `.gitignore` coverage, rotate if exposed.
- `Tipsy Trivia/.env.vercel*` and `.vercel/.env.development.local` — Vercel OIDC JWTs, short-lived but should not be committed. Add to `.gitignore`.

---

## After everything

Reply to me with: "Supabase key rotated." Then I'll move on to skill consolidation + zip extraction.
