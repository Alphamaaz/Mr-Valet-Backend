import { unauthorized, forbidden } from "../errors/AppError.js";
import { verifyAccessToken } from "../utils/token.js";
import { User } from "../models/User.js";

export async function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
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
