import { env } from "@/lib/env";
import type { Enums } from "@/lib/db/database.types";

/**
 * Outbound communications behind one interface.
 *
 * D|R|P runs on WhatsApp, with email as the fallback. Providers are swappable:
 * business logic calls `sendMessage` and never learns which vendor delivered
 * it. Until credentials are configured the drivers no-op and report back, so
 * reminders can be exercised end to end without sending anything to a real
 * tenant or owner.
 */
export type Channel = Enums<"message_channel">;

export interface OutboundMessage {
  channel: Channel;
  to: string;
  subject?: string;
  body: string;
  /** Email only: a formatted version of the body; body stays the plain-text part. */
  html?: string;
  templateCode?: string;
  variables?: Record<string, string | number>;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  provider: string;
  error?: string;
  /** True when no provider is configured and nothing was actually sent. */
  skipped?: boolean;
}

export interface MessagingDriver {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

/** Fills {placeholders} in a template body. */
export function renderTemplate(
  body: string,
  variables: Record<string, string | number | null | undefined> = {}
): string {
  return body.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/** UAE numbers are stored and sent in E.164. */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("971")) return `+${digits}`;
  if (digits.startsWith("0")) return `+971${digits.slice(1)}`;
  if (digits.length === 9) return `+971${digits}`;
  return `+${digits}`;
}

const noopDriver = (channel: string): MessagingDriver => ({
  name: "none",
  async send(message) {
    console.info(
      `[messaging:${channel}] no provider configured - would send to ${message.to}: ` +
        `${message.body.slice(0, 120)}`
    );
    return { ok: true, provider: "none", skipped: true };
  },
});

const whatsappDriver: MessagingDriver = {
  name: "meta",
  async send(message) {
    const { whatsappPhoneNumberId: phoneId, whatsappAccessToken: token } =
      env.messaging;
    if (!phoneId || !token) {
      return { ok: false, provider: "meta", error: "WhatsApp credentials missing" };
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${phoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            message.templateCode
              ? {
                  messaging_product: "whatsapp",
                  to: toE164(message.to),
                  type: "template",
                  template: {
                    name: message.templateCode,
                    language: { code: "en" },
                    components: message.variables
                      ? [
                          {
                            type: "body",
                            parameters: Object.values(message.variables).map((v) => ({
                              type: "text",
                              text: String(v),
                            })),
                          },
                        ]
                      : undefined,
                  },
                }
              : {
                  messaging_product: "whatsapp",
                  to: toE164(message.to),
                  type: "text",
                  text: { body: message.body },
                }
          ),
        }
      );

      const payload = (await response.json()) as {
        messages?: { id: string }[];
        error?: { message: string };
      };

      if (!response.ok) {
        return {
          ok: false,
          provider: "meta",
          error: payload.error?.message ?? `HTTP ${response.status}`,
        };
      }
      return { ok: true, provider: "meta", providerMessageId: payload.messages?.[0]?.id };
    } catch (error) {
      return {
        ok: false,
        provider: "meta",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};

const emailDriver: MessagingDriver = {
  name: "resend",
  async send(message) {
    const key = env.messaging.resendApiKey;
    if (!key) return { ok: false, provider: "resend", error: "RESEND_API_KEY missing" };

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.messaging.emailFrom,
          to: [message.to],
          subject: message.subject ?? "D|R|P Property Management",
          text: message.body,
          ...(message.html ? { html: message.html } : {}),
        }),
      });

      // A proxy or outage can answer with plain text rather than JSON.
      const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) {
        return { ok: false, provider: "resend", error: payload.message ?? `HTTP ${response.status}` };
      }
      return { ok: true, provider: "resend", providerMessageId: payload.id };
    } catch (error) {
      return {
        ok: false,
        provider: "resend",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};

function driverFor(channel: Channel): MessagingDriver {
  switch (channel) {
    case "whatsapp":
      return env.messaging.whatsappProvider === "meta" ? whatsappDriver : noopDriver("whatsapp");
    case "email":
      return env.messaging.emailProvider === "resend" ? emailDriver : noopDriver("email");
    case "sms":
      return noopDriver("sms");
    default:
      return noopDriver("in_app");
  }
}

/**
 * Addresses D|R|P never emails, whatever would send to them: a booking
 * email, a portal invite, an owner whose record carries the office address.
 * Migration 0040 keeps the database from queueing them too.
 */
export const NEVER_EMAILED: readonly string[] = ["office@dubairapidproperties.com"];

/** True for an address on the never-emailed list, however it is written ("Name <x@y>", capitals, spaces). */
export function isNeverEmailed(to: string): boolean {
  const address = (/<([^>]+)>/.exec(to)?.[1] ?? to).trim().toLowerCase();
  return NEVER_EMAILED.includes(address);
}

export async function sendMessage(message: OutboundMessage): Promise<SendResult> {
  if (message.channel === "email" && isNeverEmailed(message.to)) {
    return { ok: false, provider: "blocked", error: `Emails to ${message.to.trim()} are switched off.` };
  }
  return driverFor(message.channel).send(message);
}

/**
 * WhatsApp first, email if it fails or is unavailable - which is how the
 * office already communicates.
 */
export async function sendWithFallback(
  message: Omit<OutboundMessage, "channel">,
  contact: { whatsapp?: string | null; email?: string | null }
): Promise<SendResult> {
  if (contact.whatsapp) {
    const result = await sendMessage({ ...message, channel: "whatsapp", to: contact.whatsapp });
    if (result.ok) return result;
  }
  if (contact.email) {
    return sendMessage({ ...message, channel: "email", to: contact.email });
  }
  return { ok: false, provider: "none", error: "No WhatsApp number or email on file" };
}
