import multer from "multer";
import path from "path";
import crypto from "crypto";
import { badRequest } from "../errors/AppError.js";

// Allowed audio MIME types for voice messages
const ALLOWED_AUDIO_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",       // .mp3
  "audio/ogg",
  "audio/wav",
  "audio/x-m4a",
  "audio/aac",
  "audio/mp4a-latm",
];

const MAX_VOICE_SIZE = 100 * 1024 * 1024; // 100 MB

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, path.join(process.cwd(), "public", "voices"));
  },
  filename(_req, file, cb) {
    const uniqueId = crypto.randomBytes(16).toString("hex");
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `${uniqueId}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(badRequest(`Invalid audio type: ${file.mimetype}. Allowed: webm, mp4, mp3, ogg, wav, m4a, aac`));
  }
}

export const uploadVoice = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_VOICE_SIZE },
}).single("voice"); // field name = "voice"
