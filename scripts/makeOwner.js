/**
 * One-time script: Update a user's role to OWNER in MongoDB
 * Usage: node scripts/makeOwner.js <phone_number>
 * Example: node scripts/makeOwner.js 03361234567
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const phone = process.argv[2];

if (!phone) {
  console.error(" Usage: node scripts/makeOwner.js <phone_number>");
  process.exit(1);
}

const userSchema = new mongoose.Schema({ phone: String, role: String, fullName: String }, { strict: false });
const User = mongoose.models.User || mongoose.model("User", userSchema);

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(" Connected to MongoDB");

  const user = await User.findOneAndUpdate(
    { phone },
    { $set: { role: "OWNER" } },
    { new: true },
  );

  if (!user) {
    console.error(` No user found with phone: ${phone}`);
    process.exit(1);
  }

  console.log(` Updated! User "${user.fullName}" (${user.phone}) is now OWNER`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(" Error:", err.message);
  process.exit(1);
});
