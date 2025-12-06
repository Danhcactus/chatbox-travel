# chatbox-travel (backend)

Simple Node.js backend for CB Travel chatbox.

## Features
- Crawl list of public pages (SITE_URLS)
- Split into chunks, simple retrieval
- Call Google Gemini (via API key in env)
- Endpoints:
  - `GET /health`
  - `POST /force-refresh`
  - `POST /chat` { question: "..." } -> { answer: "..." }

## Setup (local)
1. `npm install`
2. Create `.env` from `.env.example` and fill GEMINI_KEY
3. `node server.js`

## Deploy
Recommended: Render.com
- Create new Web Service from this repo
- Set environment variable `GEMINI_KEY` and `SITE_URLS`
- Start command: `npm start`
