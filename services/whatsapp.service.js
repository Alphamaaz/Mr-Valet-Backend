import axios from "axios";
import crypto from "crypto";

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function isValidWhatsAppSignature({ rawBody, signatureHeader }) {
  const appSecret = process.env.META_APP_SECRET || "";
  const signature = String(signatureHeader || "").trim();

  if (!appSecret || !rawBody || !signature.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function sendWhatsAppTextMessage({ phone, message }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const normalizedPhone = normalizePhone(phone);

  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp API credentials are missing");
  }
  if (!normalizedPhone) {
    throw new Error("Target phone number is missing or invalid");
  }

  await axios.post(
    `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to: normalizedPhone,
      type: "text",
      text: {
        body: message,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
}
