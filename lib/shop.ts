/**
 * Platform identity vs. tenant identity.
 *
 * PLATFORM_BRAND is the white-label product (MSS): installer, window title,
 * taskbar and vendor support only. SHOP is the *empty* tenant template — a
 * fresh install must show onboarding, never a pre-filled store profile.
 * Customer-facing text reads the live ShopSettings row and never falls back
 * to a hardcoded shop name.
 */

export const PLATFORM_BRAND = {
  name: "MSS",
  windowTitle: "MSS (Mobile Service System)",
  supportNumber: "01533315357",
  supportUrl: "https://wa.me/8801533315357",
} as const;

export const SHOP = {
  name: "",
  tagline: "",
  /** Navbar-only line; empty until the shop owner configures the profile. */
  chromeTagline: "",
  address: "",
  phone: "",
} as const;
