# Privacy

Bonnetje Splitter is software you run yourself: the app connects to a server that you (or someone you trust) run.
One server can hold several separate households; each has its own key, and its data is kept in its own private
database and photo folder, apart from every other household's.
There is no central service, no account, no advertising and no analytics or tracking in the app or the server.

This page describes what the software does. If someone else runs the server you connect to, they decide what
happens to the data there; ask them.

## The app

- Stores on your phone: the server address and password (in the device's secure storage; in the browser version in local storage), and a cached copy of
  your split data and the payment account (IBAN and name) so it works offline. "Server wisselen" in the menu deletes all of it.
- Sends receipts, the split (names you type for housemates, who paid) and receipt photos to the server you
  entered, and to no one else.
- Checks for updates by downloading `version.txt` from the download page on GitHub Pages (`tcvdh.github.io`) when
  it starts, comes back to the front, or you pull to refresh. That request contains no data from the app; GitHub sees
  your IP address, as with any website.
- Asks for the **camera** and **photo library** only to scan or pick a receipt, and for **local network** access
  (iOS) to reach a server at home. Photos are only used when you scan; nothing is read in the background.

## The server

Stores in its data folder, on the machine where it runs:

- per household: the split data (people's names, who owes what, payments), as one record;
- scanned receipts and the original receipt photos;
- per household, the payment details (the built-in household: `RECEIPT_IBAN` and `RECEIPT_NAME`), sent to the app to build
  the payment QR code;
- per household, optionally a bunq.me handle (only to build a payment link the app can share; it can be used with or without an IBAN);
- per household, when it last used the server and how many scans it used per month (for the limits and the admin
  dashboard), and a hash of its key (never the key itself);
- only with `RECEIPT_USE_AH_API=true` (self-hosting): your Albert Heijn login tokens and a copy of your AH
  receipts.

The server log contains the client address, the household id and the request line (for example `GET /api/data`), and
never keys, photos or receipt contents.

Nothing is sent anywhere else, except:

- **Google Gemini** (only when `RECEIPT_GEMINI_KEY` is set): each receipt photo you scan is sent to Google's
  Gemini API to be read. A receipt can show items you bought, a store, a date and sometimes a loyalty number.
  How Google handles it depends on the key's plan (on the free tier Google may use content to improve its
  products, on a paid key not); check [Google's Gemini API terms](https://ai.google.dev/gemini-api/terms).
  Without a Gemini key nothing is sent to Google.
- **bunq** (only if you set a bunq.me handle): the app never contacts bunq. "Deel bunq-betaallink" only hands a message (the person's products and total, plus a `bunq.me` link with your handle, amount and invoice number) to the share sheet; whoever opens it talks to bunq.
- **Albert Heijn** (only with `RECEIPT_USE_AH_API=true`): the server talks to Albert Heijn as you, to fetch
  your own receipts.

## Your control

- Hide a receipt (list swipe or selection): it only disappears from the list; the split, and for scanned receipts
  the photo, stay on the server.
- Delete a scanned receipt for good: hide it, open **Verborgen** in the menu, select it and choose **Verwijderen**.
  The scanned receipt, its photo and its split are removed from the server. Invoices you already made keep their
  own copy of the lines. Receipts from Albert Heijn cannot be deleted (they live at Albert Heijn), only hidden.
- Discarding a scan that needs review removes it right away, and unfinished drafts are removed automatically after
  24 hours.
- Photo retention: with `RECEIPT_PHOTO_DAYS` set, the server deletes the photo of a kept receipt after that many
  days (the receipt itself stays).
- Delete a whole household: `python3 server.py tenant delete <id> --yes`, or *Verwijderen* in the admin dashboard, removes
  its database and all its photos (server operators, see [server/README.md](server/README.md#households-more-than-one-group)). Backups you made
  of the state folder are not touched: delete those too.
- Delete everything: stop the server and delete its `state/` folder (and `.env`).
- Log out of Albert Heijn: the tokens are removed from the server.

## If you run a server for other people

Every household you add is another group of people whose data you hold. You decide what is stored and why, so you are responsible for that data (under the GDPR you are the data
controller for what your server holds about them). Tell the people who use your server what is stored and that
photos go to Google, keep access to it limited to them, and delete their data when they ask. Do not switch on the
Albert Heijn integration for other people's use.

## Contact

Questions about this software: open an issue in the repository. Security problems: see [SECURITY.md](SECURITY.md).
