/** App ID OneSignal (public — même app que WP prod). */
export const ONESIGNAL_APP_ID =
  (typeof import.meta !== "undefined" &&
    import.meta.env?.PUBLIC_ONESIGNAL_APP_ID) ||
  "2037d918-24b1-4140-8a12-92eacf2b7167";
