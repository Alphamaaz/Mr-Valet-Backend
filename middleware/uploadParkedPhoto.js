import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { badRequest } from "../errors/AppError.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const MAX_SIZE      = 20 * 1024 * 1024; // 20 MB

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(process.cwd(), "public", "parked");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const uid = crypto.randomBytes(16).toString("hex");
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${uid}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(badRequest(`Invalid image type: ${file.mimetype}. Allowed: jpeg, png, webp`));
  }
}

export const uploadParkedPhoto = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE, files: 1 },
}).single("photo");
