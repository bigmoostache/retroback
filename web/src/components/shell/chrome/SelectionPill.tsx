import { useLayoutEffect, useRef } from "react"
import { animate, createSpring } from "animejs"
import { cn, prefersReducedMotion } from "@/lib/utils"

/**
 * The raised "selected" pill of a segmented control, drawn ONCE per group and
 * moved between segments instead of being repainted on each one: on a change it
 * springs from the old segment to the new one (the macOS segmented-control
 * slide). Place it as the FIRST child of the `relative` group; each segment
 * marks itself with `data-selected` and stays `relative` so it paints above.
 *
 * First placement, a return from "nothing selected", and Reduce Motion all snap
 * without motion. With no selected segment the pill fades out.
 *
 * @param selectedKey Changes whenever the selection changes (the active value).
 * @param className   Shape of the pill: the segments' own radius class.
 */
export function SelectionPill({
  selectedKey,
  className,
}: {
  selectedKey: string | null
  className: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const placedRef = useRef(false)

  useLayoutEffect(() => {
    const pill = ref.current
    const group = pill?.parentElement
    if (!pill || !group) return
    const seg = group.querySelector<HTMLElement>('[data-selected="true"]')
    if (!seg) {
      placedRef.current = false
      animate(pill, { opacity: 0, duration: 150, ease: "outQuad" })
      return
    }
    const target = {
      translateX: seg.offsetLeft,
      translateY: seg.offsetTop,
      width: seg.offsetWidth,
      height: seg.offsetHeight,
    }
    if (!placedRef.current || prefersReducedMotion()) {
      placedRef.current = true
      animate(pill, { ...target, opacity: 1, duration: 0 })
      return
    }
    animate(pill, { ...target, opacity: 1, ease: createSpring({ stiffness: 380, damping: 30 }) })
  }, [selectedKey])

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn(
        "card-shadow pointer-events-none absolute top-0 left-0 bg-card opacity-0",
        className,
      )}
    />
  )
}
