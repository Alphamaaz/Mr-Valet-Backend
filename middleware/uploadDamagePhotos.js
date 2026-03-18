import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { badRequest } from "../errors/AppError.js";

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
];

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB per image
const MAX_FILES = 8;

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const targetDir = path.join(process.cwd(), "public", "damages");
    fs.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename(_req, file, cb) {
    const uniqueId = crypto.randomBytes(16).toString("hex");
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${uniqueId}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(badRequest(`Invalid image type: ${file.mimetype}. Allowed: jpeg, png, webp`));
  }
}

export const uploadDamagePhotos = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_IMAGE_SIZE, files: MAX_FILES },
}).array("photos", MAX_FILES);
