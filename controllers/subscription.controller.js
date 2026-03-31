import mongoose from "mongoose";
import { z } from "zod";
import { badRequest, notFound } from "../errors/AppError.js";
import { SubscriptionPlan } from "../models/SubscriptionPlan.js";
import { Subscription } from "../models/Subscription.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const createPlanSchema = z.object({
  name:          z.string().trim().min(1),
  price:         z.number().min(0),
  currency:      z.string().trim().min(1).max(5).default("USD"),
  billingCycle:  z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
  durationDays:  z.number().int().min(1),
  features:      z.array(z.string().trim().min(1)).min(1),
  isRecommended: z.boolean().default(false),
});

const updatePlanSchema = z.object({
  name:          z.string().trim().min(1).optional(),
  price:         z.number().min(0).optional(),
  currency:      z.string().trim().min(1).max(5).optional(),
  features:      z.array(z.string().trim().min(1)).optional(),
  isRecommended: z.boolean().optional(),
  isActive:      z.boolean().optional(),
});

const subscribeSchema = z.object({
  planId: z.string().trim().min(1, "planId is required"),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function calcDaysRemaining(endDate) {
  return Math.max(0, Math.ceil((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24)));
}

function formatPlan(plan) {
  return {
    id:            String(plan._id),
    name:          plan.name,
    price:         plan.price,
    currency:      plan.currency,
    billingCycle:  plan.billingCycle,
    durationDays:  plan.durationDays,
    features:      plan.features,
    isRecommended: plan.isRecommended,
    isActive:      plan.isActive,
  };
}

// ─── PLAN CRUD (OWNER / SUPER_ADMIN only) ─────────────────────────────────────


// POST /api/v1/subscriptions/plans
export async function createPlan(req, res) {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Invalid plan data", parsed.error.flatten());

  // Only block if an ACTIVE plan with same billingCycle already exists
  const exists = await SubscriptionPlan.findOne({ billingCycle: parsed.data.billingCycle, isActive: true });
  if (exists) throw badRequest(`A ${parsed.data.billingCycle} plan already exists`);

  const plan = await SubscriptionPlan.create(parsed.data);

  return res.status(201).json(
    new ApiResponse(201, { plan: formatPlan(plan) }, "Plan created successfully"),
  );
}

// GET /api/v1/subscriptions/plans
export async function getPlans(req, res) {
  const filter = { isActive: true };

  // Admin/Owner can see all plans including inactive via ?all=true
  if (
    req.query.all === "true" &&
    ["OWNER", "SUPER_ADMIN"].includes(req.user.role)
  ) {
    delete filter.isActive;
  }

  const plans = await SubscriptionPlan.find(filter).sort({ price: 1 }).lean();

  return res.json(
    new ApiResponse(200, { plans: plans.map(formatPlan) }, "Plans fetched successfully"),
  );
}

// PATCH /api/v1/subscriptions/plans/:id
export async function updatePlan(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest("Invalid plan ID");

  const parsed = updatePlanSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Invalid update data", parsed.error.flatten());

  const plan = await SubscriptionPlan.findByIdAndUpdate(
    id,
    { $set: parsed.data },
    { new: true },
  ).lean();

  if (!plan) throw notFound("Plan not found");

  return res.json(
    new ApiResponse(200, { plan: formatPlan(plan) }, "Plan updated successfully"),
  );
}

// DELETE /api/v1/subscriptions/plans/:id  — Hard delete from DB
export async function deletePlan(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest("Invalid plan ID");

  const plan = await SubscriptionPlan.findByIdAndDelete(id).lean();

  if (!plan) throw notFound("Plan not found");

  return res.json(
    new ApiResponse(200, { planId: id, name: plan.name }, `"${plan.name}" plan deleted successfully`),
  );
}

// ─── USER SUBSCRIPTION APIs ───────────────────────────────────────────────────

// POST /api/v1/subscriptions/subscribe
// Choose a plan → cancels old active sub and creates new one
export async function subscribe(req, res) {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Invalid request", parsed.error.flatten());

  const { planId } = parsed.data;
  if (!mongoose.Types.ObjectId.isValid(planId)) throw badRequest("Invalid plan ID");

  const plan = await SubscriptionPlan.findOne({ _id: planId, isActive: true }).lean();
  if (!plan) throw notFound("Subscription plan not found");

  // Cancel any existing active subscription
  await Subscription.updateMany(
    { user: req.user.id, status: "ACTIVE" },
    { $set: { status: "CANCELLED" } },
  );

  const startDate = new Date();
  const endDate   = new Date();
  endDate.setDate(endDate.getDate() + plan.durationDays);

  const sub = await Subscription.create({
    user:      req.user.id,
    plan:      plan._id,
    startDate,
    endDate,
    pricePaid: plan.price,
    currency:  plan.currency,
    status:    "ACTIVE",
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        subscriptionId: String(sub._id),
        planName:       plan.name,
        billingCycle:   plan.billingCycle,
        pricePaid:      plan.price,
        currency:       plan.currency,
        startDate,
        endDate,
        daysRemaining:  plan.durationDays,
        status:         "ACTIVE",
      },
      `Subscribed to ${plan.name} plan successfully`,
    ),
  );
}

// POST /api/v1/subscriptions/renew
// Extends the current active subscription by the same plan duration

export async function renewSubscription(req, res) {
  const current = await Subscription.findOne({ user: req.user.id, status: "ACTIVE" })
    .populate("plan")
    .lean();

  if (!current) throw notFound("No active subscription to renew");

  // Allow switching plan during renewal if planId provided, else re-use same plan
  let plan = current.plan;
  if (req.body?.planId) {
    if (!mongoose.Types.ObjectId.isValid(req.body.planId)) throw badRequest("Invalid plan ID");
    plan = await SubscriptionPlan.findOne({ _id: req.body.planId, isActive: true }).lean();
    if (!plan) throw notFound("Plan not found");
  }

  // New period starts from today (or from current endDate if still active)
  const now             = new Date();
  const currentEnd      = new Date(current.endDate);
  const renewFrom       = currentEnd > now ? currentEnd : now; // extend from end if still valid
  const newEnd          = new Date(renewFrom);
  newEnd.setDate(newEnd.getDate() + plan.durationDays);

  // Cancel old, create new
  await Subscription.findByIdAndUpdate(current._id, { status: "CANCELLED" });

  const sub = await Subscription.create({
    user:      req.user.id,
    plan:      plan._id,
    startDate: renewFrom,
    endDate:   newEnd,
    pricePaid: plan.price,
    currency:  plan.currency,
    status:    "ACTIVE",
  });

  return res.json(
    new ApiResponse(
      200,
      {
        subscriptionId: String(sub._id),
        planName:       plan.name,
        billingCycle:   plan.billingCycle,
        pricePaid:      plan.price,
        currency:       plan.currency,
        startDate:      renewFrom,
        endDate:        newEnd,
        daysRemaining:  calcDaysRemaining(newEnd),
        status:         "ACTIVE",
      },
      "Subscription renewed successfully",
    ),
  );
}


// Cancel the current active subscription
export async function cancelSubscription(req, res) {
  const sub = await Subscription.findOneAndUpdate(
    { user: req.user.id, status: "ACTIVE" },
    { $set: { status: "CANCELLED" } },
    { new: true },
  ).lean();

  if (!sub) throw notFound("No active subscription to cancel");

  return res.json(
    new ApiResponse(200, { subscriptionId: String(sub._id), status: "CANCELLED" }, "Subscription cancelled"),
  );
}

// GET /api/v1/subscriptions/my
// Current user's active subscription with full plan details
export async function getMySubscription(req, res) {
  const sub = await Subscription.findOne({ user: req.user.id, status: "ACTIVE" })
    .populate("plan", "name price currency billingCycle features isRecommended durationDays")
    .sort({ createdAt: -1 })
    .lean();

  if (!sub) {
    return res.json(new ApiResponse(200, { subscription: null }, "No active subscription"));
  }

  const daysRemaining = calcDaysRemaining(sub.endDate);

  // Auto-expire
  if (daysRemaining === 0) {
    await Subscription.findByIdAndUpdate(sub._id, { status: "EXPIRED" });
    return res.json(new ApiResponse(200, { subscription: null }, "Your subscription has expired"));
  }

  return res.json(
    new ApiResponse(
      200,
      {
        subscriptionId: String(sub._id),
        status:         sub.status,
        startDate:      sub.startDate,
        endDate:        sub.endDate,
        daysRemaining,
        pricePaid:      sub.pricePaid,
        currency:       sub.currency,
        plan:           formatPlan(sub.plan),
      },
      "Active subscription fetched successfully",
    ),
  );
}

