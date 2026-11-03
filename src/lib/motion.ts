import type { Transition } from "framer-motion";

// Motion tokens (#857) for framer-motion, in seconds. They mirror the motion custom properties
// in src/index.css :root (--ease-*, --duration-*); src/__tests__/motion.test.ts keeps the two equal.

export const ease = {
  standard: [0.32, 0.72, 0, 1],
  exit: [0.23, 1, 0.32, 1],
} as const;

export const duration = {
  push: 0.35,
  sheet: 0.4,
  sheetExit: 0.25,
  fade: 0.2,
  press: 0.1,
};

export const transitions = {
  push: { duration: duration.push, ease: ease.standard },
  // The spring back after a short drag or pull: the sheet duration, with a little overshoot.
  // Pass the release velocity with it.
  sheet: { type: "spring", duration: duration.sheet, bounce: 0.15 },
  sheetExit: { duration: duration.sheetExit, ease: ease.exit },
  fade: { duration: duration.fade, ease: ease.standard },
  press: { duration: duration.press, ease: ease.standard },
} satisfies Record<string, Transition>;
