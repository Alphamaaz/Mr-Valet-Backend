import twilio from "twilio";

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials are missing");
  }

  return twilio(accountSid, authToken);
}

function toE164(phone) {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  if (cleaned.startsWith("0")) {
    return `+92${cleaned.slice(1)}`;
  }

  if (cleaned.startsWith("92")) {
    return `+${cleaned}`;
  }

  return `+${cleaned}`;
}

export async function sendOtpSms({ phone, otpCode }) {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new Error("TWILIO_PHONE_NUMBER is missing");
  }

  const client = getTwilioClient();
  const to = toE164(phone);

  await client.messages.create({
    body: `Your Mr Valet OTP is ${otpCode}. It will expire in ${process.env.OTP_TTL_MINUTES || 5} minutes.`,
    to,
    from,
  });
}

export async function sendTextSms({ phone, body }) {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new Error("TWILIO_PHONE_NUMBER is missing");
  }
  if (!body || !String(body).trim()) {
    throw new Error("SMS body is missing");
  }

  const client = getTwilioClient();
  const to = toE164(phone);

  await client.messages.create({
    body: String(body).trim(),
    to,
    from,
  });
}
