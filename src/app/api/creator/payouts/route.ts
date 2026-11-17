import { NextResponse } from "next/server";

export type PayoutRecord = {
  id: string;
  period: string;
  totalPlays: string;
  premiumPlays: string;
  adRevenue: number;
  amount: number;
  status: "PENDING" | "PAID";
  createdAt: string;
};

export type PayoutsResponse = {
  summary: {
    lifetimePaid: number;
    pendingAmount: number;
    totalPlays: number;
    premiumPlays: number;
    premiumSharePercent: number;
    estRatePerPlay: number;
  };
  payouts: PayoutRecord[];
};

const mockPayouts: PayoutRecord[] = [
  {
    id: "payout-2026-09",
    period: "2026-09-01",
    totalPlays: "41,200",
    premiumPlays: "26,780",
    adRevenue: 142.5,
    amount: 328.75,
    status: "PENDING",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "payout-2026-08",
    period: "2026-08-01",
    totalPlays: "38,462",
    premiumPlays: "24,810",
    adRevenue: 135.2,
    amount: 304.18,
    status: "PAID",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "payout-2026-07",
    period: "2026-07-01",
    totalPlays: "32,900",
    premiumPlays: "20,400",
    adRevenue: 118.0,
    amount: 256.4,
    status: "PAID",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "payout-2026-06",
    period: "2026-06-01",
    totalPlays: "27,150",
    premiumPlays: "17,600",
    adRevenue: 98.4,
    amount: 214.85,
    status: "PAID",
    createdAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "payout-2026-05",
    period: "2026-05-01",
    totalPlays: "19,800",
    premiumPlays: "12,200",
    adRevenue: 71.0,
    amount: 154.2,
    status: "PAID",
    createdAt: "2026-05-01T00:00:00.000Z",
  },
];

export async function GET() {
  const lifetimePaid = mockPayouts
    .filter((p) => p.status === "PAID")
    .reduce((acc, p) => acc + p.amount, 0);
  const pendingAmount = mockPayouts
    .filter((p) => p.status === "PENDING")
    .reduce((acc, p) => acc + p.amount, 0);
  const totalPlays = mockPayouts.reduce((acc, p) => acc + parseInt(p.totalPlays.replace(/,/g, ""), 10), 0);
  const premiumPlays = mockPayouts.reduce((acc, p) => acc + parseInt(p.premiumPlays.replace(/,/g, ""), 10), 0);

  const data: PayoutsResponse = {
    summary: {
      lifetimePaid: Number(lifetimePaid.toFixed(2)),
      pendingAmount: Number(pendingAmount.toFixed(2)),
      totalPlays,
      premiumPlays,
      premiumSharePercent: Number(((premiumPlays / totalPlays) * 100).toFixed(1)),
      estRatePerPlay: 0.0078,
    },
    payouts: mockPayouts,
  };

  return NextResponse.json(data);
}
