const TRANSCRIPTION_MODEL = "whisper-1";
// Bump this version when transcription options change.
const TRANSCRIPTION_VERSION = `${TRANSCRIPTION_MODEL}:v1`;
const TRANSCRIPTION_CLAIM_SECONDS = 300;

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

async function downloadVoiceFile(fileId, env) {
  const getFileUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`;
  const fileInfo = await fetch(getFileUrl).then((res) => res.json());

  if (!fileInfo.ok) {
    throw new Error(
      `🔍 File Info Error:\n${JSON.stringify(fileInfo, null, 2)}`
    );
  }

  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;
  const response = await fetch(fileUrl);

  if (!response.ok) {
    throw new Error(
      `📥 Download Error:\nStatus: ${response.status}\nText: ${response.statusText}`
    );
  }

  const buffer = await response.arrayBuffer();
  return {
    buffer,
    size: buffer.byteLength,
    format: fileInfo.result.mime_type || "unknown",
  };
}

async function transcribeAudio(audioData, env) {
  const formData = new FormData();
  const audioBlob = new Blob([audioData.buffer], { type: "audio/ogg" });
  formData.append("file", audioBlob, "voice.oga");
  formData.append("model", TRANSCRIPTION_MODEL);

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: formData,
      signal: AbortSignal.timeout(120_000),
    }
  );

  const responseText = await response.text();
  let result;

  try {
    result = JSON.parse(responseText);
  } catch (e) {
    throw new Error(
      `🔄 API Response Parse Error:\nStatus: ${response.status}\nResponse: ${responseText}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `🔄 Transcription API Error:\n${JSON.stringify(result, null, 2)}`
    );
  }

  if (!result.text) {
    throw new Error(
      `📝 No Transcription in Response:\n${JSON.stringify(result, null, 2)}`
    );
  }

  return result.text;
}

async function sendTelegramMessage(chatId, text, env, options = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      ...options,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      `📤 Message Send Error:\n${JSON.stringify(errorData, null, 2)}`
    );
  }

  const data = await response.json();
  return data.result.message_id;
}

async function editTelegramMessage(chatId, messageId, text, env) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: "HTML",
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      `📝 Message Edit Error:\n${JSON.stringify(errorData, null, 2)}`
    );
  }
}

async function recordUserUsage(user, env) {
  await env.users_binding.prepare(
    `INSERT INTO users (
      telegram_user_id,
      username,
      first_name,
      last_name,
      language_code,
      usage_count,
      total_usage_count,
      last_used_at
    ) VALUES (?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP)
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      language_code = excluded.language_code,
      usage_count = CASE
        WHEN users.last_used_at < datetime('now', '-1 day') THEN 1
        ELSE users.usage_count + 1
      END,
      total_usage_count = users.total_usage_count + 1,
      last_used_at = CASE
        WHEN users.last_used_at < datetime('now', '-1 day') THEN CURRENT_TIMESTAMP
        ELSE users.last_used_at
      END`
  )
    .bind(
      user.id.toString(),
      user.username || null,
      user.first_name || null,
      user.last_name || null,
      user.language_code || null
    )
    .run();
}

async function hasReachedDailyLimit(userId, env) {
  const user = await env.users_binding.prepare(
    `SELECT 1 FROM users
    WHERE telegram_user_id = ?
      AND usage_count >= 5
      AND last_used_at >= datetime('now', '-1 day')`
  )
    .bind(userId.toString())
    .first();

  return Boolean(user);
}

async function getCachedTranscription(fileUniqueId, env) {
  if (!fileUniqueId) return null;
  const cached = await env.users_binding.prepare(
    `SELECT transcription FROM transcription_cache
     WHERE file_unique_id = ? AND model_version = ?`
  ).bind(fileUniqueId, TRANSCRIPTION_VERSION).first();
  return cached?.transcription ?? null;
}

async function claimTranscription(fileUniqueId, token, env) {
  const result = await env.users_binding.prepare(
    `INSERT INTO transcription_cache
       (file_unique_id, model_version, claim_token, claimed_at)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT (file_unique_id, model_version) DO UPDATE SET
       claim_token = excluded.claim_token,
       claimed_at = excluded.claimed_at
     WHERE transcription_cache.transcription IS NULL
       AND transcription_cache.claimed_at < unixepoch() - ?`
  ).bind(
    fileUniqueId, TRANSCRIPTION_VERSION, token, TRANSCRIPTION_CLAIM_SECONDS
  ).run();
  return result.meta.changes === 1;
}

async function releaseTranscriptionClaim(fileUniqueId, token, env) {
  await env.users_binding.prepare(
    `DELETE FROM transcription_cache
     WHERE file_unique_id = ? AND model_version = ?
       AND claim_token = ? AND transcription IS NULL`
  ).bind(fileUniqueId, TRANSCRIPTION_VERSION, token).run();
}

function formatTranscription(transcription) {
  return "✅ Transcription complete!\n\n📝 Text:\n" +
    transcription.replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function getAllowedChatIds(env) {
  let allowedChatIds;

  try {
    if (Array.isArray(env.ALLOWED_CHAT_ID)) {
      allowedChatIds = env.ALLOWED_CHAT_ID;
    } else if (env.ALLOWED_CHAT_ID == null) {
      return null;
    } else {
      allowedChatIds = JSON.parse(env.ALLOWED_CHAT_ID);
    }
  } catch {
    return null;
  }

  if (!Array.isArray(allowedChatIds)) {
    return null;
  }

  return allowedChatIds;
}

function isAllowedChat(chatId, allowedChatIds) {
  if (allowedChatIds === null) {
    return false;
  }

  if (allowedChatIds.length === 0) {
    return true;
  }

  return (
    allowedChatIds.some(
      (allowedChatId) => allowedChatId?.toString() === chatId.toString()
    )
  );
}

async function mentionsBot(message, env) {
  const entities = message.entities || [];
  const mentionedUsers = entities
    .filter((entity) => entity.type === "text_mention")
    .map((entity) => entity.user?.id);
  const references = entities
    .filter((entity) =>
      entity.type === "mention" || entity.type === "bot_command"
    )
    .map((entity) =>
      message.text.slice(entity.offset, entity.offset + entity.length).toLowerCase()
    );

  if (references.length === 0 && mentionedUsers.length === 0) {
    return false;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`
  );
  const data = await response.json();
  if (!response.ok || !data.ok || !data.result?.username) {
    throw new Error("Failed to get bot username from Telegram");
  }

  const username = data.result.username.toLowerCase();
  return mentionedUsers.some((id) => id != null && id === data.result.id) ||
    references.some((reference) =>
      reference === `@${username}` ||
      reference === `/transcribe@${username}`
    );
}

async function handleRequest(request, env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { message } = await request.json();
    const chatId = message?.chat?.id;

    if (!message || !chatId) {
      // Telegram also sends membership changes and other non-message updates.
      return new Response("OK");
    }

    const isGroup = message.chat.type === "group" ||
      message.chat.type === "supergroup";
    let audioMessage = message;

    if (isGroup) {
      audioMessage = message.reply_to_message;
      if (
        !(audioMessage?.voice || audioMessage?.video_note) ||
        !(await mentionsBot(message, env))
      ) {
        return new Response("OK");
      }
    } else if (message.chat.type !== "private") {
      return new Response("OK");
    }

    const allowedChatIds = getAllowedChatIds(env);
    const allowedChat = isAllowedChat(chatId, allowedChatIds);

    if (!allowedChat) {
      await sendTelegramMessage(
        chatId,
        "⚠️ Sorry, you are not authorized to use this bot. Please contact the administrator for access.",
        env
      );
      return new Response("Unauthorized", { status: 403 });
    }

    // Handle /start command
    if (message?.text === "/start") {
      await sendTelegramMessage(
        chatId,
        "👋 Welcome to Voice-to-Text Bot!\n\nSend me a voice message, and I'll convert it to text for you.",
        env
      );
      return new Response("OK");
    }

    // Handle voice messages and video notes
    if (audioMessage.voice || audioMessage.video_note) {
      let processingMessageId;
      const media = audioMessage.voice || audioMessage.video_note;
      const fileUniqueId = media.file_unique_id;
      let claimToken;
      const replyOptions = isGroup ? {
        reply_parameters: { message_id: audioMessage.message_id },
        ...(message.message_thread_id != null
          ? { message_thread_id: message.message_thread_id }
          : {}),
      } : {};

      try {
        const cached = await getCachedTranscription(fileUniqueId, env);
        if (cached !== null) {
          await sendTelegramMessage(
            chatId, formatTranscription(cached), env, replyOptions
          );
          return new Response("OK");
        }

        if (
          allowedChatIds.length === 0 &&
          (await hasReachedDailyLimit(message.from.id, env))
        ) {
          await sendTelegramMessage(
            chatId,
            "⏳ You can transcribe up to 5 audio messages every 24 hours. Please try again later.",
            env
          );
          return new Response("OK");
        }

        if (fileUniqueId) {
          const token = crypto.randomUUID();
          if (!(await claimTranscription(fileUniqueId, token, env))) {
            // The first request may have completed since our initial lookup.
            const completed = await getCachedTranscription(fileUniqueId, env);
            await sendTelegramMessage(
              chatId,
              completed !== null
                ? formatTranscription(completed)
                : "⏳ This audio is already being transcribed. Please try again shortly.",
              env,
              replyOptions
            );
            return new Response("OK");
          }
          claimToken = token;
        }

        // Send processing message
        processingMessageId = await sendTelegramMessage(
          chatId,
          "🎵 Processing your audio message...",
          env,
          replyOptions
        );

        // Download audio file
        const fileId = audioMessage.voice?.file_id || audioMessage.video_note?.file_id;
        const audioData = await downloadVoiceFile(fileId, env);
        await editTelegramMessage(
          chatId,
          processingMessageId,
          `📥 Audio file received:\n` +
            `Size: ${(audioData.size / 1024).toFixed(2)} KB\n` +
            `Format: ${audioData.format}`,
          env
        );

        // Transcribe using Whisper API
        await editTelegramMessage(
          chatId,
          processingMessageId,
          "🔄 Sending to OpenAI for transcription...",
          env
        );
        const transcription = await transcribeAudio(audioData, env);
        if (claimToken) {
          await env.users_binding.prepare(
            `UPDATE transcription_cache
             SET transcription = ?, claim_token = NULL, claimed_at = NULL
             WHERE file_unique_id = ? AND model_version = ? AND claim_token = ?`
          ).bind(
            transcription, fileUniqueId, TRANSCRIPTION_VERSION, claimToken
          ).run();
        }
        await recordUserUsage(message.from, env);

        // Send transcription back
        await editTelegramMessage(
          chatId,
          processingMessageId,
          formatTranscription(transcription),
          env
        );
      } catch (error) {
        let errorMessage = "❌ Error Details:\n";

        if (error.message.includes("File Info Error")) {
          errorMessage += "⚠️ Failed to get audio message from Telegram\n";
        } else if (error.message.includes("Download Error")) {
          errorMessage += "⚠️ Failed to download the audio file\n";
        } else if (error.message.includes("API Response Parse Error")) {
          errorMessage += "⚠️ Invalid response from transcription service\n";
        } else if (error.message.includes("Transcription API Error")) {
          errorMessage += "⚠️ Transcription service error\n";
        }

        errorMessage += `\nDebug info:\n${error.message}`;

        if (processingMessageId) {
          await editTelegramMessage(
            chatId,
            processingMessageId,
            errorMessage,
            env
          );
        } else {
          await sendTelegramMessage(chatId, errorMessage, env);
        }
      } finally {
        if (claimToken) {
          await releaseTranscriptionClaim(fileUniqueId, claimToken, env);
        }
      }
    }

    return new Response("OK");
  } catch (error) {
    return new Response("Error processing request: " + error.message, {
      status: 500,
    });
  }
}
