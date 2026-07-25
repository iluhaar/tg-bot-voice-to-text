# Voice-to-Text Telegram Bot (Cloudflare Workers)

A serverless Telegram bot that converts voice and circle video messages to text using OpenAI's Whisper API, deployed on Cloudflare Workers.

## Prerequisites

- A Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)
- A Telegram Bot Token (get it from [@BotFather](https://t.me/botfather))
- An OpenAI API Key
- A Cloudflare D1 database with a `users` table

## Setup

1. Install Wrangler:

```bash
npm install -g wrangler
```

2. Login to Cloudflare:

```bash
wrangler login
```

3. Set up your environment variables in Cloudflare:

```bash
wrangler secret put BOT_TOKEN
wrangler secret put OPENAI_API_KEY
wrangler secret put ALLOWED_CHAT_ID
```

4. Set up your Telegram bot webhook:

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>
```

The D1 database is configured as the `users_binding` binding in `wrangler.toml`. Each
successful transcription creates or updates the Telegram user and increments
their 24-hour-window `usage_count` and lifetime `total_usage_count`. Users can
transcribe five messages per 24-hour period; the chat configured by
`ALLOWED_CHAT_ID` is exempt from this limit.

For an existing database, apply migrations before deploying the worker:

```bash
wrangler d1 migrations apply voice-to-text-users --remote
wrangler deploy
```

The initial total is seeded from the current `usage_count`; usage from earlier
24-hour periods cannot be recovered because it was previously overwritten.

## Security Features

- **Environment Variables**: All sensitive data is stored securely in Cloudflare Workers
- **Webhook-only**: The bot only processes messages received through the webhook

## Deployment

Deploy to Cloudflare Workers:

```bash
wrangler deploy
```

## Features

- Converts voice messages to text using OpenAI's Whisper API
- Serverless deployment on Cloudflare Workers
- No dependencies required
- Minimal resource usage
- Automatic scaling
- Stores user profiles and usage counts in Cloudflare D1

## How it Works

1. The bot receives a voice message through Telegram's webhook
2. Downloads the voice file using Telegram's getFile API
3. Sends the audio file to OpenAI's Whisper API for transcription
4. Returns the transcribed text to the user

## Security Notes

- Environment variables are securely stored in Cloudflare Workers
- No file system access required
- All processing happens in memory
- Automatic HTTPS handling by Cloudflare
