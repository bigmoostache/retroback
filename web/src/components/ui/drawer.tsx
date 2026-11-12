import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"

import { cn } from "@/lib/utils"

/**
 * shadcn-style Drawer built on Base UI's Drawer primitive: a panel that slides
 * in from an edge of the screen, over the page. Portalled into the body like
 * the Dialog. Swiping it toward its edge closes it.
 *
 * Only the right side is styled for now (the node panel of the plan screen).
 */

function Drawer(props: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root swipeDirection="right" {...props} />
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close {...props} />
}

/**
 * The sliding surface, floating 8px from the right edge, full height.
 * It follows the finger while swiped (--drawer-swipe-movement-x) and slides
 * out on close.
 */
function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.Portal>
      {/* Covers the screen for swipe handling but lets clicks through to the page (non-modal use). */}
      <DrawerPrimitive.Viewport className="pointer-events-none fixed inset-0 z-overlay">
      <DrawerPrimitive.Popup
        data-slot="drawer-content"
        className={cn(
          "pointer-events-auto fixed top-2 right-2 bottom-2 z-overlay flex w-[28rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden",
          "rounded-2xl bg-surface-2 text-foreground pop-shadow outline-none",
          "[transform:translateX(var(--drawer-swipe-movement-x,0px))]",
          "transition-transform duration-base ease-out data-[swiping]:transition-none",
          "data-[starting-style]:[transform:translateX(calc(100%+1rem))] data-[ending-style]:[transform:translateX(calc(100%+1rem))]",
          className,
        )}
        {...props}
      >
        {children}
      </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  )
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-title3 font-semibold tracking-tight text-foreground", className)}
      {...props}
    />
  )
}

export { Drawer, DrawerClose, DrawerContent, DrawerTitle }
