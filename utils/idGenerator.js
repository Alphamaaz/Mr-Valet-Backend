function randomDigits(size = 4) {
  const max = 10 ** size;
  const value = Math.floor(Math.random() * max);
  return String(value).padStart(size, "0");
}

export function generateTicketNumber() {
  const date = new Date();
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `TKT-${yyyy}${mm}${dd}-${randomDigits(4)}`;
}

export function generateValetCode(locationCode = "LSA") {
  return `${locationCode}-${randomDigits(3)}`;
}

