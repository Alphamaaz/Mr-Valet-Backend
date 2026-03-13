function randomDigits(size = 4) {
  const max = 10 ** size;
  const value = Math.floor(Math.random() * max);
  return String(value).padStart(size, "0");
}

export function generateTicketNumber() {
  return randomDigits(6);
}

export function generateValetCode(locationCode = "LSA") {
  return `${locationCode}-${randomDigits(3)}`;
}

export async function generateEmployeeId() {
  const { EmployeeProfile } = await import("../models/EmployeeProfile.js");
  const count = await EmployeeProfile.countDocuments();
  const num = count + 1;
  return `EMP${String(num).padStart(3, "0")}`;
}

