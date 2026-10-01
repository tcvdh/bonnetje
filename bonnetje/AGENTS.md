This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Package manager is npm (`package-lock.json`).

```bash
npx expo install <package>  # ALWAYS use instead of npm add — resolves SDK-compatible versions
npx expo start              # start the dev server (also: npm run web, runs via react-native-web)
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npm test                    # vitest: unit tests for src/utils, including a 300-case check that all totals agree
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint, typecheck and tests before declaring any task done. `src/utils/` must stay free of React Native imports (import `eur`/`round2` from `utils/money`, not `theme`) so the tests can run in plain Node.

## Architecture

Bonnetje Splitter: split supermarket receipts between housemates. The app is a thin client for the Python server in `../server`.

- Entry: `index.ts` → `App.tsx`. Navigation is **React Navigation** (native-stack), not Expo Router; there is no `src/app/`. Do not add Expo Router.
- `src/screens/`: `SetupScreen` (server address + key), `ReceiptListScreen`, `ReceiptDetailScreen`. Screens are thin: state and logic live in `src/hooks/`, the pieces of UI in `src/components/`.
- `src/navigation.ts` defines `RootStackParamList` and `ScreenProps<"Name">`. Type every screen with it and pass only ids in route params (`{ receiptId }`), never data: the receipts list lives in the context, so no screen holds a stale copy.
- `src/api.ts` is the only code that talks to the server (`Authorization: Bearer <key>`). Data is one synced blob saved with `baseVersion`; a 409 means stale and `setConflictHandler` swaps in the server's copy (the user is told their change was dropped). Failed offline saves stay marked dirty in the cache and are retried by `flushPending` / on next `loadData`. `forgetServer` (menu: "Server wisselen") wipes address, key and cache; a bumped `epoch` makes a save that was still running for the old server change nothing, so old data can never reach a new server.
- `src/context.ts` is the app state: `data`, `persistData`, and the fetched `receipts` (`useReceiptFeed` on the list screen fills them). `persistData` takes new data or an updater `(current) => next`; use the updater after any `await`. Also `src/types.ts`, `src/constants.ts`, `src/theme.ts`.
- `src/hooks/`: `useReceiptFeed` (fetch + re-settle), `useReceiptDetail` (load one receipt, resolve discounts), `useReceiptActions` (every change to one receipt), `useMarkAllPaid`, `useFinishReceipt`, `useSelection` (multi-select), `useDiscountLinker`.
- `src/components/`: bottom sheets (`*Sheet.tsx`), list items and chips, and the parts of the two big screens (`ListHeader`, `ListActions`, `ReceiptHeader`, `DiscountSections`, `ReceiptActions`). Every bottom sheet is a `BottomSheet` and every centred dialog a `CardDialog` from `Sheet.tsx`; do not build a new `Modal` with its own overlay and handle. A dialog that opens from inside a sheet goes in that sheet's children, so it stacks on top.
- `src/utils/`: pure logic (`settle`, `balance`, `invoice`, `discounts`, `people`, `normalize`, `money`, `image`). Keep it free of React.
- The app knows nothing about households: the key it holds selects one on the server, and everything it sees (data, receipts, payee) is that household's. Server errors it shows in Dutch are mapped in `describeError`; scan errors carry their own Dutch `message` from the server.
- `src/api.ts` also holds the payee (IBAN + name for the QR code). It comes from the server in `/api/auth/status` and is cached; if it is missing, `PaymentSheet` shows a warning instead of a QR code. With an optional `bunq` handle, `PaymentSheet` also offers a shared message with the unpaid invoice (`paymentRequestText`, never says "betaald") and a `bunq.me` link (`utils/bunq.ts`). Never hardcode account details.
- The Albert Heijn warning comes from the server: `/api/receipts` returns `ahError` only when the server runs with `RECEIPT_USE_AH_API=true` and is not logged in. Do not add AH-specific UI that assumes AH is on.
- `src/utils/serverUrl.ts` decides http vs https for the typed server address (http only for local addresses). Android needs `usesCleartextTraffic` because its network config cannot express "private IPs only", so this function is the enforcement; keep its tests passing.
- Hide vs delete: hiding adds the id to `data.hidden` and nothing else. Deleting (only scanned receipts, `utils/receipts.ts`, done from the Verborgen sheet) first calls `DELETE /api/scans/:id` on the server and only then `removeReceipt`s what really got deleted from the data. Invoices keep their own snapshot of the lines, so they stay correct.
- Server API and setup: `../server/README.md`. Deploy runbook: `../server/DEPLOY.md`.

## Money rules (do not break these)

- Amounts shown to people are whole cents from `utils/settle.ts`. `Assignment.cents` is the *settled* price of an item in whole cents (an integer, never euros): net of its own discount and of its share of the discounts that are not linked to a product. Call `settleAssignments` whenever the split, the discount links or the prices change (the detail screen, the finish flow and the list screen all do).
- A person's part of an item is `shareCents(assignment, itemIndex)`; a receipt is `receiptCents(assignments)`. The receipt page (`TallySection`), the balance card and `receiptBalance`, and `buildInvoice` must all use these. Do not sum euro floats, divide by `split.length` yourself, or round per line.
- Only prices that come from the store (`Product`, `Discount`, in euros) are converted with `toCents`; stored assignments are already cents.
- The field is called `cents` on purpose. Older releases stored euros in `amount`, and the same blob is shared with older installs, so a new number under the old name would be read as euros. `normalizeData` (`utils/normalize.ts`, used by every load in `api.ts`) converts old `amount` values. Do not rename `cents` or change its unit without a migration there and a test in `normalize.test.ts`.
- If you change any of this, `settle.test.ts` (the random "all totals agree" cases) must still pass.

## Building

Release builds (unsigned iOS IPA + Android APK) run in GitHub Actions (`../.github/workflows/build.yml`, manual "Run workflow": per platform skip / github-hosted / self-hosted, optional version input saved to `app.json`). The workflow runs `expo prebuild` for Android. EAS (`eas.json`) is configured but not what the release flow uses. Docs if needed: https://docs.expo.dev/eas/index.md

## Rules

- `ios/` and `android/` do not exist locally; they are generated (Continuous Native Generation), and CI generates them at build time. Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries. Docs: https://docs.expo.dev/versions/latest/index.md
