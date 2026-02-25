# Sky Source (Vite-ready)

This folder contains your `sky-source-v3.html` split into Vite files:

- `index.html` (markup)
- `src/style.css` (all CSS)
- `src/main.js` (all JS)
- `src/supabaseClient.js` (template for later Supabase wiring)

## Use in your existing Vite project

1) In your local Vite project folder, replace:
- `index.html` with this `index.html`
- `src/main.js` with this `src/main.js`
- `src/style.css` with this `src/style.css`

2) Install dependencies:
npm i
npm i @supabase/supabase-js

3) Run:
npm run dev

## Vercel env vars (later)
Add these in Vercel → Project Settings → Environment Variables
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

(Use `.env.example` as reference.)
