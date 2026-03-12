addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function downloadVoiceFile(fileId) {
  const getFileUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`;
  const fileInfo = await fetch(getFileUrl).then((res) => res.json());

  if (!fileInfo.ok) {
    throw new Error(
      `🔍 File Info Error:\n${JSON.stringify(fileInfo, null, 2)}`
    );
  }

  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
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

async function transcribeAudio(audioData) {
  const formData = new FormData();
  const audioBlob = new Blob([audioData.buffer], { type: "audio/ogg" });
  formData.append("file", audioBlob, "voice.oga");
  formData.append("model", "whisper-1");

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
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

async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      `📤 Message Send Error:\n${JSON.stringify(errorData, null, 2)}`
    );
  }
}

async function handleRequest(request) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { message } = await request.json();
    const chatId = message?.chat?.id;

    if (!chatId) {
      return new Response("Missing chat ID", { status: 400 });
    }

    // Check if the chat ID matches the allowed ID
    const allowedChatIds = [ALLOWED_CHAT_ID,HANNA_ID];

    if (!allowedChatIds.includes(chatId.toString())) {
      await sendTelegramMessage(
        chatId,
        "⚠️ Sorry, you are not authorized to use this bot. Please contact the administrator for access."
      );
      return new Response("Unauthorized", { status: 403 });
    }

    // Handle /start command
    if (message?.text === "/start") {
      await sendTelegramMessage(
        chatId,
        "👋 Welcome to Voice-to-Text Bot!\n\nSend me a voice message, and I'll convert it to text for you."
      );
      return new Response("OK");
    }

    // Handle voice messages and video notes
    if (message?.voice || message?.video_note) {
      try {
        // Send processing message
        await sendTelegramMessage(
          chatId,
          "🎵 Processing your audio message..."
        );

        // Download audio file
        const fileId = message.voice?.file_id || message.video_note?.file_id;
        const audioData = await downloadVoiceFile(fileId);
        await sendTelegramMessage(
          chatId,
          `📥 Audio file received:\n` +
            `Size: ${(audioData.size / 1024).toFixed(2)} KB\n` +
            `Format: ${audioData.format}`
        );

        // Transcribe using Whisper API
        await sendTelegramMessage(
          chatId,
          "🔄 Sending to OpenAI for transcription..."
        );
        const transcription = await transcribeAudio(audioData);

        // Send transcription back
        await sendTelegramMessage(
          chatId,
          "✅ Transcription complete!\n\n" + "📝 Text:\n" + transcription
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

        await sendTelegramMessage(chatId, errorMessage);
      }
    }

    return new Response("OK");
  } catch (error) {
    return new Response("Error processing request: " + error.message, {
      status: 500,
    });
  }
}
