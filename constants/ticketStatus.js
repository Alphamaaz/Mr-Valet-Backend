export const TICKET_STATUS = Object.freeze({
  READY_TO_BE_PARKED: "READY_TO_BE_PARKED",
  ON_THE_WAY_TO_PARKING: "ON_THE_WAY_TO_PARKING",
  PARKED_IN: "PARKED_IN",
  RETRIEVAL_REQUESTED: "RETRIEVAL_REQUESTED",
  ON_THE_WAY_TO_DELIVERY: "ON_THE_WAY_TO_DELIVERY",
  DELIVERED: "DELIVERED",
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [TICKET_STATUS.READY_TO_BE_PARKED]: [TICKET_STATUS.ON_THE_WAY_TO_PARKING, TICKET_STATUS.PARKED_IN],
  [TICKET_STATUS.ON_THE_WAY_TO_PARKING]: [TICKET_STATUS.PARKED_IN],
  [TICKET_STATUS.PARKED_IN]: [TICKET_STATUS.RETRIEVAL_REQUESTED],
  [TICKET_STATUS.RETRIEVAL_REQUESTED]: [TICKET_STATUS.ON_THE_WAY_TO_DELIVERY],
  [TICKET_STATUS.ON_THE_WAY_TO_DELIVERY]: [TICKET_STATUS.DELIVERED],
  [TICKET_STATUS.DELIVERED]: [],
});

export function normalizeTicketStatus(status) {
  return status;
}

export function canTransitionStatus(fromStatus, toStatus) {
  const from = normalizeTicketStatus(fromStatus);
  const to = normalizeTicketStatus(toStatus);

  if (!from || !to) {
    return false;
  }

  if (from === to) {
    return true;
  }

  return ALLOWED_TRANSITIONS[from]?.includes(to) || false;
}
