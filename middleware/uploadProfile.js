import multer from "multer";
import path from "path";
import crypto from "crypto";
import { badRequest } from "../errors/AppError.js";

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
];

const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, path.join(process.cwd(), "public", "profiles"));
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

export const uploadProfile = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_IMAGE_SIZE },
}).single("image"); // field name = "image"
