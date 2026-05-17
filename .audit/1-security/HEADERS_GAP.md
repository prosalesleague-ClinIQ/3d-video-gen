# Security Headers — Gap Analysis & Recommended Fix

Current state: `vercel.json` contains only `{ "outputDirectory": "public" }` — no `headers` block. `Permissions-Policy` is set via `<meta>` in `mapper.html` and `cam-diag.html` but not `index.html` or `player.html`. No CSP, no `X-Frame-Options`, no `frame-ancestors`, no `Referrer-Policy`, no `Strict-Transport-Security`, no `X-Content-Type-Options`.

This is the most cost-effective security uplift available — a single edit to `vercel.json`.

## What to set, and where

### 1. `vercel.json` — Vercel HTTP headers (preferred over `<meta>` because they apply on every response including 4xx/5xx and are honored cross-origin)

```json
{
  "outputDirectory": "public",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://docs.opencv.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://res.cloudinary.com https://dl.polyhaven.org; media-src 'self' blob: https://res.cloudinary.com; connect-src 'self' https://prosalesleague-3d-video-gen.hf.space https://storage.googleapis.com https://dl.polyhaven.org; worker-src 'self' blob:; child-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
        },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(self), microphone=(), geolocation=(), interest-cohort=()" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" }
      ]
    }
  ]
}
```

### 2. Backend (FastAPI) — `demo-service/app.py`

Add a small response-header middleware so any HTML that the backend serves (mostly JSON, but defense-in-depth) is hardened, and so the streamed `/video/{id}` MP4 carries `X-Content-Type-Options: nosniff` to prevent MIME-sniffing into HTML.

```python
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    return response
```

## Header-by-header rationale

| Header | Required for | Notes |
|--------|--------------|-------|
| `Content-Security-Policy` | Mitigate XSS (C1) even when sanitization is missing. `script-src 'self' + 3 CDNs` matches `CDN_PIN_REPORT.md`. `frame-ancestors 'none'` doubles as anti-clickjacking. `connect-src` must include the HF Space backend, Google Storage (MediaPipe model), and Poly Haven (HDRI). | After moving CDNs to self-hosted, tighten `script-src` to `'self'`. |
| `X-Frame-Options: DENY` | Legacy clickjacking defence; redundant with `frame-ancestors 'none'` but still recognised by older clients. | — |
| `Referrer-Policy: strict-origin-when-cross-origin` | Avoid leaking `?id=<project>` paths to third parties in the `Referer` header (saved-project IDs are unguessable UUIDs but the principle holds). | — |
| `Permissions-Policy: camera=(self), microphone=(), geolocation=(), interest-cohort=()` | Mic explicitly disabled (the app never uses it). FLoC disabled. Camera limited to same-origin. Applies even on `index.html` / `player.html` where the `<meta>` version is missing. | — |
| `X-Content-Type-Options: nosniff` | Prevent MIME-confusion attacks on user-uploaded video, scene JSON, and the FastAPI MP4 stream. | — |
| `Strict-Transport-Security` | Ensures the next-Wi-Fi visit force-upgrades to HTTPS. | Match against `*.vercel.app` apex policy if you preload. |

## What does NOT need a header

- `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` — only needed if you opt into SharedArrayBuffer / `crossOriginIsolated`. Three.js + MediaPipe currently work without it. Add only if you start using OffscreenCanvas worker offload.
- `Cross-Origin-Resource-Policy` — set on the backend (above) so video responses are loadable from the Vercel origin. Not required on Vercel's own responses (they're same-origin to the page).

## Verification checklist

After deploy, run:

```sh
curl -sI https://3d-video-gen.vercel.app/ | grep -iE 'csp|frame|referrer|permissions|nosniff|hsts'
```

Expected: every header above appears exactly once. Then:

```sh
curl -sI https://prosalesleague-3d-video-gen.hf.space/video/dummy | grep -i nosniff
```

Expected: `X-Content-Type-Options: nosniff`.
