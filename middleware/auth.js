import { unauthorized, forbidden } from "../errors/AppError.js";
import { verifyAccessToken } from "../utils/token.js";
import { User } from "../models/User.js";

function extractBearerToken(authHeader = "") {
  const matches = String(authHeader).match(/Bearer\s+([^\s,]+)/gi) || [];
  if (!matches.length) {
    return null;
  }

  // API clients sometimes send both collection-level and request-level auth.
  // Prefer the last token because it is usually the manually refreshed one.
  const lastMatch = matches[matches.length - 1];
  return lastMatch.replace(/^Bearer\s+/i, "").trim();
}

function decodeJwtWithoutVerification(token) {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));

    return {
      sub: decoded.sub || null,
      role: decoded.role || null,
      issuedAt: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : null,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req, _res, next) {
  let token = null;

  try {
    const authHeader = req.headers.authorization || "";
    token = extractBearerToken(authHeader);

    if (!token) {
      throw unauthorized("Missing or invalid authorization header");
    }

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).lean();

    if (!user || !user.isActive) {
      throw unauthorized("User session is invalid");
    }

    req.user = {
      id: String(user._id),
      role: user.role,
      phone: user.phone,
      branchId: user.branch ? String(user.branch) : null,
    };

    next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      const decoded = token ? decodeJwtWithoutVerification(token) : null;
      return next(
        unauthorized("Access token expired. Please login again", {
          expiredAt: error.expiredAt,
          receivedToken: decoded,
        }),
      );
    }

    if (error?.name === "JsonWebTokenError" || error?.name === "NotBeforeError") {
      return next(unauthorized("Invalid access token"));
    }

    next(error);
  }
}

export function requireRoles(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(unauthorized("Authentication is required"));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(forbidden("You do not have permission to perform this action"));
    }

    next();
  };
}
