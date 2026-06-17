import axios from "axios";

function toQatarLocal(phone) {
  const cleaned = phone.replace(/[^\d]/g, "");
  if (cleaned.startsWith("974")) {
    return cleaned.slice(3);
  }
  return cleaned;
}

async function sendSms(destination, content) {
  const url = process.env.VODAFONE_SMS_URL;
  const application = process.env.VODAFONE_APPLICATION;
  const password = process.env.VODAFONE_PASSWORD;
  const source = process.env.VODAFONE_SOURCE;
  const mask = process.env.VODAFONE_MASK;

  if (!url || !application || !password || !source || !mask) {
    throw new Error("Vodafone SMS credentials are missing from environment");
  }

  const response = await axios.get(url, {
    params: { application, password, content, destination, source, mask },
    timeout: 20000,
  });

  const result = String(response.data || "").trim();
  if (result.toLowerCase().includes("invalid") || result.toLowerCase().includes("failed") || result.toLowerCase().includes("error")) {
    throw new Error(`Vodafone gateway error: ${result}`);
  }

  return result;
}

export async function sendOtpSms({ phone, otpCode }) {
  const destination = toQatarLocal(phone);
  const ttl = process.env.OTP_TTL_MINUTES || 5;
  const content = `Your Mr Valet OTP is ${otpCode}. It will expire in ${ttl} minutes.`;
  await sendSms(destination, content);
}

export async function sendTextSms({ phone, body }) {
  if (!body || !String(body).trim()) {
    throw new Error("SMS body is missing");
  }
  const destination = toQatarLocal(phone);
  await sendSms(destination, String(body).trim());
}
