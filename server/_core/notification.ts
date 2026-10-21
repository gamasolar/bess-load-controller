/**
 * Owner notifications via Telegram Bot API.
 *
 * Replaces the original Manus Forge Notification Service. When the bot token
 * or chat id are not configured the call is treated as a no-op (returns
 * `false`) so that the BESS control loop is never blocked by missing
 * notification credentials.
 *
 * Configure with:
 *   TELEGRAM_BOT_TOKEN=123456:ABC...
 *   TELEGRAM_CHAT_ID=-100123456789
 *
 * The chat id can be a personal chat or a group / channel. For a group make
 * sure the bot has been added to it.
 */

import { TRPCError } from "@trpc/server";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function validatePayload(input: NotificationPayload): NotificationPayload {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required.",
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required.",
    });
  }

  const title = input.title.trim();
  const content = input.content.trim();

  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`,
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`,
    });
  }

  return { title, content };
}

/**
 * Telegram Markdown (legacy) is finicky around `_*[]()` characters. We escape
 * the most common ones so messages with random punctuation don't fail with
 * "Bad Request: can't parse entities".
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()`])/g, "\\$1");
}

/**
 * WhatsApp pelo gateway interno (relay da Evolution API, o mesmo que o Helios
 * e o Gama 360 usam). Configure com:
 *   WHATSAPP_RELAY_URL=http://127.0.0.1:8099
 *   WHATSAPP_RELAY_KEY=<chave do relay>
 *   WHATSAPP_TO=55DDDNNNNNNNNN   (ou um id de grupo ...@g.us)
 * Sem as três variáveis é no-op, como o Telegram.
 */
function whatsappConfig(): { url: string; key: string; to: string } | null {
  const url = (process.env.WHATSAPP_RELAY_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.WHATSAPP_RELAY_KEY ?? "").trim();
  const to = (process.env.WHATSAPP_TO ?? "").trim();
  if (!url || !key || !to) return null;
  return { url, key, to };
}

export function isWhatsAppConfigured(): boolean {
  return whatsappConfig() !== null;
}

async function sendWhatsApp(title: string, content: string): Promise<boolean> {
  const cfg = whatsappConfig();
  if (!cfg) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    // O relay substitui o nome da instância pelo da que estiver conectada.
    const response = await fetch(`${cfg.url}/message/sendText/bess`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.key },
      body: JSON.stringify({ number: cfg.to, text: `*${title}*\n\n${content}` }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(`[Notification] WhatsApp returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] WhatsApp request failed:", error instanceof Error ? error.message : error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifyOwner(
  payload: NotificationPayload,
): Promise<boolean> {
  const { title, content } = validatePayload(payload);

  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
  const telegramConfigured = !!token && !!chatId;

  // Canais são independentes: manda em todos os configurados e responde
  // `true` se pelo menos um entregou.
  const whatsappOk = await sendWhatsApp(title, content);

  if (!telegramConfigured) {
    if (!isWhatsAppConfigured()) {
      // Notifications are an optional dependency for the BESS dashboard.
      // We log once-per-call at warn level but do not throw so callers (alarms,
      // reports) keep working in environments without any channel set up.
      console.warn(
        "[Notification] Skipping notifyOwner: nenhum canal configurado (Telegram ou WhatsApp).",
      );
    }
    return whatsappOk;
  }

  const text = `*${escapeMarkdown(title)}*\n\n${escapeMarkdown(content)}`;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  // Defensive timeout so a hanging Telegram request can never stall the BESS
  // control loop. 10s is well above Telegram's normal latency.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Telegram returned ${response.status} ${response.statusText}${
          detail ? `: ${detail}` : ""
        }`,
      );
      return whatsappOk;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Telegram request failed:", error);
    return whatsappOk;
  } finally {
    clearTimeout(timeout);
  }
}
