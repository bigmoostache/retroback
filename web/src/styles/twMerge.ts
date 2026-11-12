import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge with the HIG type steps from `type.css` registered as font
 * sizes. Without this, `text-body` reads as a text COLOR and silently cancels
 * (or is cancelled by) `text-muted-foreground`. Keep the list in step with the
 * `--text-<step>` names in `type.css`.
 */
export const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["caption", "subhead", "callout", "body", "title3", "title2", "title1", "display"],
        },
      ],
    },
  },
})
