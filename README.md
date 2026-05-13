# Personal AI Workbench

A static Next.js personal workbench. The left side manages shared tools and browser-local API settings; the right side renders the selected app. The first app is **French Study Buddy**.

## Current Apps

- French Study Buddy: English/French learning chat with vocabulary and grammar cards explained in Chinese.
- API & Data Settings: shared DeepSeek API key, Supabase URL, Supabase anon/public key, and email login.

## Storage

- API keys are stored in this browser with `localStorage`.
- Supabase Auth persists the email login session in this browser.
- Chat sessions are stored in `chat_sessions`.
- Chat messages and vocabulary/grammar cards are stored in `messages.structured_json`.
- Long-term memories are stored in `user_memories`.

## Run Locally

```bash
npm install
npm run dev
```

The app always runs at:

```text
http://localhost:3001
```

## Static Export For GitHub Pages

```bash
npm run build
```

The static site is exported to `out/`.

Because this is GitHub Pages-ready, there is no Next.js `/api` route. DeepSeek is called from the browser using the user-provided local API key.

## Supabase Redirect URLs

For local development, add these in Supabase Dashboard → Authentication → URL Configuration:

```text
http://localhost:3001
http://localhost:3001/**
```

For GitHub Pages, add your deployed site URL too.

This repository includes a GitHub Actions Pages workflow. It builds with `GITHUB_PAGES=true`, so static assets are served under `/workspace`.
