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

export async function notifyOwner(
  payload: NotificationPayload,
): Promise<boolean> {
  const { title, content } = validatePayload(payload);

  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? "").trim();

  if (!token || !chatId) {
    // Notifications are an optional dependency for the BESS dashboard.
    // We log once-per-call at warn level but do not throw so callers (alarms,
    // reports) keep working in environments without Telegram set up.
    console.warn(
      "[Notification] Skipping notifyOwner: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured.",
    );
    return false;
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
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Telegram request failed:", error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
