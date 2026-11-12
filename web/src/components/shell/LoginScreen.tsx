import { LogIn } from "lucide-react"
import { CommandHint } from "@/components/ops/CommandLine"
import { buttonVariants } from "@/components/ui/button-variants"
import type { Auth } from "@/lib/useEngine"

/** Shown while nobody is signed in: sign in with Google, or how to set it up. */
export function LoginScreen({ auth }: { auth: Auth }) {
  const error = new URLSearchParams(window.location.search).get("login_error")
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60">
        <LogIn className="size-5" />
      </div>
      <h1 className="text-title2 font-semibold tracking-tight">Retroback</h1>
      <p className="max-w-pop-lg text-body text-muted-foreground">
        Plan backward from a target to the present. Sign in to see the plans you own or that are shared with you.
      </p>
      {auth.google ? (
        <a href="/auth/google" className={buttonVariants({ variant: "signal" })}>
          Sign in with Google
        </a>
      ) : (
        <>
          <p className="max-w-pop-lg text-body text-muted-foreground">
            Google sign-in is not set up. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, or set DEV=true, then
            restart the API.
          </p>
          <CommandHint command="cp .env.example .env && pnpm api" />
        </>
      )}
      {error && (
        <p role="alert" className="max-w-pop-lg text-callout text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
