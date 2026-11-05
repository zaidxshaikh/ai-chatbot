# My AI Chatbot

A free AI chatbot built with Next.js and the Groq API. It streams replies word by word and is ready to deploy on Vercel.

## Run locally

```bash
pnpm install
cp .env.example .env.local   # then paste your Groq key
pnpm dev
```

Open http://localhost:3000

Get a free API key at https://console.groq.com/keys

## Environment variables

| Name | Purpose |
|---|---|
| `GROQ_API_KEY` | Your Groq API key (required) |
| `GROQ_MODEL` | Any chat model from https://console.groq.com/docs/models |
| `SYSTEM_PROMPT` | The bot's personality and language |
| `RATE_LIMIT_PER_MINUTE` | Max requests per IP per minute (default 20) |

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. Import the repo at https://vercel.com/new
3. Add the environment variables above in Project Settings → Environment Variables.
4. Deploy.

## How it works

- `app/page.tsx` — chat UI, sends the conversation to `/api/chat` and renders the streamed reply.
- `app/api/chat/route.ts` — validates input, rate-limits by IP, calls Groq with streaming, and converts the response into a plain text stream.

The rate limiter is in memory, so each server instance counts separately. For heavy traffic, swap it for Redis (for example Upstash).
