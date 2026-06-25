const params = new URLSearchParams(window.location.search);
const token = params.get("token") || "";

const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const contentEl = document.getElementById("content");
const successEl = document.getElementById("success");
const formEl = document.getElementById("retrievalForm");
const submitButtonEl = document.getElementById("submitButton");
const paymentBoxEl = document.getElementById("paymentBox");

function showError(message) {
  loadingEl.classList.add("hidden");
  contentEl.classList.add("hidden");
  successEl.classList.add("hidden");
  errorEl.textContent = message || "Unable to load this ticket.";
  errorEl.classList.remove("hidden");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value || "-";
  }
}

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || "Request failed");
  }
  return body;
}

function renderTicket(ticket, paymentRequirement) {
  const vehicle = ticket.vehicle || {};
  setText("ticketNumber", ticket.ticketNumber);
  setText("ticketStatus", String(ticket.status || "").replaceAll("_", " "));
  setText("vehicleName", [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle");
  setText("vehicleMeta", [vehicle.plate, vehicle.color].filter(Boolean).join(" - "));

  if (paymentRequirement?.message) {
    paymentBoxEl.textContent = paymentRequirement.message;
    paymentBoxEl.classList.remove("hidden");
  }

  loadingEl.classList.add("hidden");
  contentEl.classList.remove("hidden");
}

async function loadTicket() {
  if (!token) {
    showError("Invalid retrieval link. Token is missing.");
    return;
  }

  try {
    const response = await fetch(`/api/v1/tickets/public/retrieval-summary?token=${encodeURIComponent(token)}`);
    const result = await readJson(response);
    renderTicket(result.data.ticket, result.data.paymentRequirement);
  } catch (error) {
    showError(error.message);
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  const receivingPoint = document.getElementById("receivingPoint").value;
  const notes = document.getElementById("notes").value;

  submitButtonEl.disabled = true;
  submitButtonEl.textContent = "Sending...";

  try {
    const response = await fetch("/api/v1/tickets/public/retrieval-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        receivingPoint,
        notes,
      }),
    });
    await readJson(response);

    contentEl.classList.add("hidden");
    successEl.classList.remove("hidden");
  } catch (error) {
    showError(error.message);
  } finally {
    submitButtonEl.disabled = false;
    submitButtonEl.textContent = "Request My Car";
  }
});

loadTicket();
