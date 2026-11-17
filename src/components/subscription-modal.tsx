"use client";

import { useState } from "react";
import { Check, Crown, Flame, Loader2, Sparkles, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanTier } from "@/lib/catalog";
import { useApiToken } from "@/components/auth-provider";

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan?: PlanTier;
  onSuccess?: (newPlan: PlanTier) => void;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve(true);

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function SubscriptionModal({ isOpen, onClose, currentPlan = "FREE", onSuccess }: SubscriptionModalProps) {
  const getApiToken = useApiToken();
  const [loadingTier, setLoadingTier] = useState<PlanTier | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUpgrade = async (tier: "GOOD" | "PRO" | "GOD") => {
    setErrorMsg(null);
    setLoadingTier(tier);

    try {
      const isLoaded = await loadRazorpayScript();
      if (!isLoaded) {
        throw new Error("Razorpay SDK failed to load. Please check your internet connection.");
      }

      const token = await getApiToken();
      if (!token) throw new Error("Please sign in before upgrading your plan.");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      headers["Authorization"] = `Bearer ${token}`;

      // 1. Create order on backend
      const res = await fetch(`${API_URL}/payments/create-order`, {
        method: "POST",
        headers,
        body: JSON.stringify({ tier }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to initiate payment order");
      }

      const orderData = await res.json();
      const { orderId, amount, currency, keyId } = orderData;

      // 2. Open Razorpay Checkout modal
      const options = {
        key: keyId,
        amount,
        currency: currency || "INR",
        name: "Streamify Premium",
        description: `Upgrade to ${tier} Plan`,
        image: "/icon.png",
        order_id: orderId,
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            // 3. Verify payment signature on backend
            const verifyRes = await fetch(`${API_URL}/payments/verify`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            if (!verifyRes.ok) {
              throw new Error("Payment verification failed");
            }

            const data = await verifyRes.json();
            if (data.success) {
              if (onSuccess && data.user?.plan) onSuccess(data.user.plan as PlanTier);
              onClose();
            }
          } catch (err: unknown) {
            setErrorMsg((err as Error).message || "Verification failed");
          } finally {
            setLoadingTier(null);
          }
        },
        modal: {
          ondismiss: () => {
            setLoadingTier(null);
          },
        },
        prefill: {
          name: "Streamify Listener",
          email: "listener@streamify.app",
        },
        theme: {
          color: tier === "GOD" ? "#f59e0b" : tier === "PRO" ? "#bef264" : "#3b82f6",
        },
      };

      const rzp = new (window as unknown as { Razorpay: new (opts: typeof options) => { open: () => void } }).Razorpay(options);
      rzp.open();
    } catch (err: unknown) {
      setErrorMsg((err as Error).message || "An unexpected error occurred");
      setLoadingTier(null);
    }
  };

  const plans = [
    {
      tier: "GOOD" as const,
      name: "Good Plan",
      price: "₹99",
      period: "/month",
      badge: "Essential",
      icon: Zap,
      accentColor: "border-blue-500/40 bg-blue-500/5 hover:border-blue-500",
      buttonBg: "bg-blue-600 hover:bg-blue-500 text-white",
      features: [
        "Up to 50 Song Downloads",
        "Access to Good Exclusive Tracks",
        "320kbps High Quality Audio",
        "Crossfade Audio Playback",
      ],
    },
    {
      tier: "PRO" as const,
      name: "Pro Plan",
      price: "₹199",
      period: "/month",
      badge: "Most Popular",
      icon: Crown,
      accentColor: "border-lime-400 bg-lime-400/10 hover:border-lime-300 ring-2 ring-lime-400/30",
      buttonBg: "bg-lime-300 hover:bg-lime-200 text-black font-black",
      popular: true,
      features: [
        "Up to 200 Song Downloads",
        "Access to Good & Pro Exclusives",
        "Ultra HD Uncompressed Streaming",
        "Unlimited Offline Cache",
        "Smart Recommendations & AI Radio",
      ],
    },
    {
      tier: "GOD" as const,
      name: "God Tier",
      price: "₹499",
      period: "/month",
      badge: "VIP Elite",
      icon: Flame,
      accentColor: "border-amber-500/60 bg-amber-500/10 hover:border-amber-400 shadow-[0_0_30px_rgba(245,158,11,.15)]",
      buttonBg: "bg-gradient-to-r from-amber-400 via-orange-500 to-yellow-400 hover:brightness-110 text-black font-black",
      features: [
        "UNLIMITED Song Downloads",
        "Access ALL Exclusive Master Tracks",
        "God Tier Glowing VIP Badge",
        "Priority High-Bitrate CDN Nodes",
        "Early Access Releases & Party Host",
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-white/10 bg-[#121216] p-6 shadow-2xl sm:p-8">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-lime-400/30 bg-lime-400/10 px-3.5 py-1 text-xs font-bold text-lime-300">
            <Sparkles className="h-3.5 w-3.5" /> STREAMIFY UNLIMITED ACCESS
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
            Upgrade Your Music Plan
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Unlock exclusive tracks, higher download limits, and lossless audio streaming.
          </p>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-center text-xs font-semibold text-red-300">
            {errorMsg}
          </div>
        )}

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const isCurrent = currentPlan === plan.tier;
            const isLoading = loadingTier === plan.tier;

            return (
              <div
                key={plan.tier}
                className={cn(
                  "relative flex flex-col justify-between rounded-xl border p-5 transition-all duration-200",
                  plan.accentColor,
                  isCurrent && "opacity-90"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-lime-300 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-black shadow-md">
                    {plan.badge}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="text-lg font-black text-white">{plan.name}</h3>
                    </div>
                    {!plan.popular && (
                      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold text-zinc-300">
                        {plan.badge}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-black text-white">{plan.price}</span>
                    <span className="text-xs font-semibold text-zinc-400">{plan.period}</span>
                  </div>

                  <ul className="mt-6 space-y-2.5 text-xs text-zinc-300">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="h-4 w-4 shrink-0 text-lime-400 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8">
                  {isCurrent ? (
                    <div className="w-full rounded-lg bg-white/10 py-2.5 text-center text-xs font-bold text-zinc-300 border border-white/10">
                      Current Active Plan
                    </div>
                  ) : (
                    <button
                      onClick={() => handleUpgrade(plan.tier)}
                      disabled={loadingTier !== null}
                      className={cn(
                        "flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs transition duration-150 disabled:opacity-50",
                        plan.buttonBg
                      )}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Processing…
                        </>
                      ) : (
                        `Upgrade to ${plan.tier}`
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 border-t border-white/10 pt-4 text-center text-xs text-zinc-500">
          Secured with 256-bit SSL encryption via Razorpay. Cancel or change plan anytime.
        </div>
      </div>
    </div>
  );
}
