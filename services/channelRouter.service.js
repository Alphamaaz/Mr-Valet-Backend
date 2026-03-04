import { ROLES } from "../constants/roles.js";
import { User } from "../models/User.js";
import { OWNER_TYPES } from "../constants/ownerTypes.js";

export async function resolveOwnerChannel(phone) {
  if (!phone) {
    return OWNER_TYPES.WHATSAPP;
  }

  const owner = await User.findOne({
    phone,
    role: ROLES.OWNER,
    isActive: true,
  }).lean();

  return owner ? OWNER_TYPES.APP : OWNER_TYPES.WHATSAPP;
}

