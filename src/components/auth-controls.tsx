"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { clerkIsConfigured } from "@/components/auth-provider";

function ConfiguredAuthControls() {
  return <>
    <Show when="signed-out">
      <div className="flex items-center gap-2">
        <SignInButton mode="modal"><button className="rounded-full px-3 py-1.5 text-xs font-bold text-zinc-200 transition hover:bg-white/10">Sign in</button></SignInButton>
        <SignUpButton mode="modal"><button className="rounded-full bg-lime-300 px-3 py-1.5 text-xs font-bold text-[#172000] transition hover:bg-lime-200">Join free</button></SignUpButton>
      </div>
    </Show>
    <Show when="signed-in">
      <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
    </Show>
  </>;
}

export function AuthControls() {
  if (!clerkIsConfigured) return <span className="hidden rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-zinc-400 sm:inline">Demo mode</span>;
  return <ConfiguredAuthControls />;
}
