# Dashboard Page Overrides

> Project: GamCiv Institution Dashboard
> Audience: institution officers reviewing only complaints assigned to their own institution.
> Source of truth: use the app's existing access gate, institution-scoped API, and theme tokens. UI changes must not broaden data access.

## Direction

Build a calm civic operations workspace: clear hierarchy, compact navigation, generous alignment, and direct access to complaint trends and recent cases. Keep the interface professional and quiet so the data carries the emphasis. Use the project's existing Source Sans 3 and Lexend theme fonts and the existing white/soft-neutral surfaces, forest-green primary, blue secondary, and muted borders.

Do not add decorative glow, gradient washes, pulsing or fake-live indicators, excessive shadows, entrance animations, giant icon tiles, emoji icons, or identical elevated cards everywhere. Prefer flat white shadcn-style surfaces with a thin border and no shadow; reserve emphasis for one primary action and meaningful status.

## Layout and navigation

Use a compact, responsive dashboard-section bar with clearly indicated active state and working click targets. On mobile, keep section items touch-sized and allow the navigation contents to fit/scroll within the viewport without causing document-wide horizontal overflow. Keep a visible sign-out action. Use semantic headings, keyboard-operable buttons, visible focus, and `prefers-reduced-motion` support.

Prioritize a short overview of institution-scoped KPIs, interactive analytics, then recent complaints. Keep the main content left-aligned and fluid up to the app's existing width. Do not add admin-wide or cross-institution navigation/data to the officer view.

## Charts and interactions

Use shadcn chart composition patterns and the project's installed Recharts version; do not upgrade Recharts just to match newer documentation examples. For the complaint time series, use a filled area chart with readable axes, a useful tooltip, an explicit legend/control, date-range selection limited to data actually returned by the API, and a visible text summary/fallback. Use at most a few distinct series; use a different stroke treatment as well as color. Every filter, nav item, refresh action, search field, and sign-out action must work and give clear state feedback.

Do not label periodic or on-demand refresh as live streaming. For reduced-motion users, disable chart transitions and avoid smooth-scroll motion.

## Verification requirements

Run the dashboard's strict TypeScript/production build and browser tests at desktop and mobile sizes. Test section navigation, range/series controls, absence of horizontal overflow, page errors, and the officer data-scope guard. For any UI change, review the rendered browser page rather than relying only on a successful build. Keep changes to the active dashboard UI and targeted tests unless a functional requirement proves another file is necessary.
