# Voice-to-Text Telegram Bot (Cloudflare Workers)

A serverless Telegram bot that converts voice messages to text using OpenAI's Whisper API, deployed on Cloudflare Workers.

## Prerequisites

- A Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)
- A Telegram Bot Token (get it from [@BotFather](https://t.me/botfather))
- An OpenAI API Key
- Your Telegram Chat ID (get it from [@RawDataBot](https://t.me/RawDataBot) by sending it any message)

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
wrangler secret put ALLOWED_CHAT_ID  # Your Telegram chat ID for access control
```

4. Set up your Telegram bot webhook:

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>
```

## Security Features

- **Chat ID Restriction**: The bot only responds to messages from a specific Telegram chat ID
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
- Secure access control via chat ID verification

## How it Works

1. The bot receives a voice message through Telegram's webhook
2. Verifies the sender's chat ID against the allowed ID
3. Downloads the voice file using Telegram's getFile API
4. Sends the audio file to OpenAI's Whisper API for transcription
5. Returns the transcribed text to the user

## Security Notes

- Environment variables are securely stored in Cloudflare Workers
- No file system access required
- All processing happens in memory
- Automatic HTTPS handling by Cloudflare
- Access restricted to authorized chat ID only
