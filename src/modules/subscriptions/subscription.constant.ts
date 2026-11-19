export const FREE_PLAN_NAME = "FREE";
export const PRO_PLAN_NAME = "PRO";

/** Default plans created by the seed (and by tests). `null` = unlimited / never expires. */
export const DEFAULT_PLANS = [
  {
    name: FREE_PLAN_NAME,
    price: "0.00",
    currency: "BDT",
    durationDays: null,
    maxMembers: 5,
    maxProjects: 2,
    maxTasksPerProject: 50,
  },
  {
    name: PRO_PLAN_NAME,
    price: "1500.00",
    currency: "BDT",
    durationDays: 30,
    maxMembers: 25,
    maxProjects: null,
    maxTasksPerProject: 1000,
  },
] as const;
