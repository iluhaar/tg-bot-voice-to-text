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

`ALLOWED_CHAT_ID` can be set to a JSON array of Telegram chat IDs; an empty
array (`[]`) allows everyone to use the bot.

4. Set up your Telegram bot webhook:

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>
```

The D1 database is configured as the `users_binding` binding in `wrangler.toml`. Each
successful transcription creates or updates the Telegram user and increments
their 24-hour-window `usage_count` and lifetime `total_usage_count`. Users can
transcribe five messages per 24-hour period; chats listed in
`ALLOWED_CHAT_ID` are exempt from this limit.

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
- On-demand group transcription by replying to a voice message and mentioning the bot
- Updates a single progress message with the final transcript

## Using the bot in groups

1. Add the bot to your group. If `ALLOWED_CHAT_ID` is not `[]`, include the
   group's chat ID (not your personal user ID) in that JSON array.
2. For plain `@YourBot` mentions, disable Group Privacy through BotFather
   (`/setprivacy`). Telegram may require removing and re-adding the bot for
   this change to take effect. The bot needs permission to send messages.
3. Reply to a voice message or circle video with `@YourBot`, or use
   `/transcribe@YourBot`. The addressed command works with privacy mode enabled
   for ordinary user messages; Telegram may route replies to another bot's
   messages to that bot instead.

The bot ignores other group messages, including voice messages without a
request. The transcript appears as a reply to the original audio, in the same
topic when applicable. Usage is charged to the person requesting transcription,
not the original sender. Private chats still transcribe audio automatically.
The bot discovers its username through Telegram, so no extra secret is needed.
Both username mentions and linked bot-name mentions are supported.

### Troubleshooting

- **Not authorized:** add the group's chat ID to `ALLOWED_CHAT_ID`, preserving
  existing IDs. Personal chat IDs do not authorize groups. An empty array (`[]`)
  allows all chats with the per-user daily limit.
- **Command works but mention does not:** confirm Group Privacy is disabled
  for the same bot, remove and re-add it if necessary, and reply to the original
  audio with its exact `@username`. Try `/transcribe@YourBot` as a fallback.
  If mentions still fail, inspect Worker logs to check delivery and errors.
- **No response:** confirm the current code is deployed, the webhook targets
  that Worker, and the bot can send messages in the group.

## How it Works

1. The bot receives private audio or a group reply mentioning it through Telegram's webhook
2. Downloads the voice file using Telegram's getFile API
3. Sends the audio file to OpenAI's Whisper API for transcription
4. Replaces the progress message with the transcript, replying to the original audio in groups

## Security Notes

- Environment variables are securely stored in Cloudflare Workers
- No file system access required
- All processing happens in memory
- Automatic HTTPS handling by Cloudflare
