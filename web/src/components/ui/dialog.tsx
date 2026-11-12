import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

/**
 * shadcn-style Dialog built on Base UI's Dialog primitive.
 *
 * The critical property over a hand-rolled `position: fixed` overlay is the
 * **Portal**: the popup is rendered into `document.body`, escaping any ancestor
 * that establishes a containing block for fixed positioning (e.g. the TopBar's
 * `.vibrancy` `backdrop-filter`, which otherwise traps a `fixed inset-0` child
 * inside the 48px header — the cause of the "half off-screen / behind content"
 * bug). Base UI also gives us focus trapping, scroll-lock, Esc-to-close and
 * `aria` wiring for free.
 *
 * Motion reuses the project vocabulary: the backdrop fades, the popup springs
 * in via `modal-pop`. Both honour `data-[starting-style]` / `data-[ending-style]`
 * so open *and* close animate.
 */

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger {...props} />
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close {...props} />
}

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "fixed inset-0 z-modal bg-scrim transition-opacity duration-base",
        "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        className,
      )}
      {...props}
    />
  )
}

/**
 * The dialog surface. Centred in the viewport via the portal + fixed wrapper.
 * `unmountOnHide` keeps the DOM clean between opens. Children own their own
 * padding/scroll so this can host both the compact details popup and the large
 * settings sheet.
 */
function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogBackdrop />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-modal -translate-x-1/2 -translate-y-1/2",
          "overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground",
          "shadow-modal outline-none",
          "[animation:modal-pop_.2s_cubic-bezier(.16,1,.3,1)]",
          "data-[ending-style]:opacity-0 data-[ending-style]:[animation:none] data-[ending-style]:transition-opacity data-[ending-style]:duration-fast",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-title3 font-semibold tracking-tight text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-callout text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogBackdrop,
  DialogTitle,
  DialogDescription,
}
