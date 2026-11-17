"use client";

import { ClerkProvider, useAuth, useClerk } from "@clerk/nextjs";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

type ApiTokenGetter = () => Promise<string | null>;

const ApiTokenContext = createContext<ApiTokenGetter>(async () => null);

const RequireAuthContext = createContext<() => boolean>(() => true);

function AuthCallbackNotice({ onRetry }: { onRetry?: () => void }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const errorCode = params.get("error_code");
    const errorDescription = params.get("error_description");
    if (!errorCode && !errorDescription) return;

    setMessage(errorCode === "otp_expired" ? "That email link has expired. Request a new sign-in link to continue." : errorDescription || "We couldn't complete sign-in. Please try again.");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  if (!message) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-[100] mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-amber-300/30 bg-[#211d0d] px-4 py-3 text-sm text-amber-100 shadow-2xl">
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="shrink-0 rounded-full bg-lime-300 px-3 py-1.5 text-xs font-bold text-[#172000] hover:bg-lime-200">Open sign in</button>}
      <button type="button" onClick={() => setMessage(null)} className="shrink-0 text-lg leading-none text-amber-200/70 hover:text-amber-100" aria-label="Dismiss sign-in message">&times;</button>
    </div>
  );
}

function ClerkAuthBridge({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const { isSignedIn } = useAuth();
  const { openSignIn, openSignUp } = useClerk();

  const getApiToken = useCallback(() => getToken(), [getToken]);
  const requireAuth = useCallback(() => {
    if (typeof window === "undefined") return true;
    if (isSignedIn) return true;
    if (openSignUp) {
      openSignUp({ forceRedirectUrl: window.location.href });
    }
    return false;
  }, [isSignedIn, openSignUp]);

  return (
    <ApiTokenContext.Provider value={getApiToken}>
      <RequireAuthContext.Provider value={requireAuth}>
        <AuthCallbackNotice onRetry={() => openSignIn()} />
        {children}
      </RequireAuthContext.Provider>
    </ApiTokenContext.Provider>
  );
}

export const clerkIsConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  // A Clerk key is optional for the seeded, local product demo. Production must set it.
  if (!publishableKey) {
    return (
      <ApiTokenContext.Provider value={async () => null}>
        <RequireAuthContext.Provider value={() => true}>
          <AuthCallbackNotice />
          {children}
        </RequireAuthContext.Provider>
      </ApiTokenContext.Provider>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}

export function useApiToken() {
  return useContext(ApiTokenContext);
}

export function useRequireAuth() {
  return useContext(RequireAuthContext);
}

