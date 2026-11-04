# MedAlert

Emergency medical profile website. Patients save allergies, conditions, medications, blood type, emergency
contact and insurance, and get a QR code containing a secure reference to their profile. Signed-in medical staff can look a patient up by QR code, national ID or phone when sharing is enabled.

The website uses a Node.js server and a local SQLite database. Node.js 22.5 or later is required. The QR fallback decoder is bundled locally; camera images are decoded in the browser.

## Run it on your computer

1. Install Node.js 22.5 or later.
2. Open a terminal in this folder (`medalert`).
3. Run `npm start`.
4. Open https://localhost:8000.

On first run, Windows creates `data/localhost.pfx` and its local passphrase file,
`data/localhost.pfx.pass`. To remove the browser certificate warning, run this once from the project folder
after the first server start:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File backend\trust-dev-cert.ps1
```

This trusts only MedAlert's self-signed `localhost` certificate in the current Windows user's certificate
store; it does not require administrator access. Restart the browser after trusting it. This certificate is
for local development only, not for deployment or real medical data.

Run `npm start` and use the server URL above to save information; opening the frontend as a static site
(including GitHub Pages) does not provide the API or database. The server creates `data/medalert.sqlite` on
first run. Profiles and access history are saved to this SQLite database when the server confirms the save,
and remain available across browser sessions and server restarts on the same host. The server prints the
database path when it starts. To back up the database safely, stop the server with Ctrl+C and then copy
`data/medalert.sqlite`; while the server is running, recent writes may still be in SQLite's WAL file.
Existing accounts and profiles saved in browser storage by the previous static version are not imported;
create accounts again and re-enter profile details.

## Deploy on Render

The `render.yaml` Blueprint configures a Node.js web service with a persistent disk for SQLite. Push this
project to a GitHub repository, then in Render choose **New > Blueprint** and connect that repository.
Render terminates HTTPS and forwards requests to the app; the app uses HTTPS locally and HTTP behind the
host's HTTPS proxy. The persistent disk requires a paid Render web service. Keep the disk mounted at
`/var/data` and keep `MEDALERT_DB_PATH` set to `/var/data/medalert.sqlite` to preserve saved data.
Production deployments do not create the local demo accounts.

This is still a demo application, not a production medical-record system. Do not store real medical data or
expose it publicly for clinical use.

To use a different database file, set `MEDALERT_DB_PATH` before starting the server. Set `PORT` to change the
default port (`8000`). The server listens on `127.0.0.1` by default. To use your own PKCS#12 certificate,
set `MEDALERT_TLS_PFX` to its path and `MEDALERT_TLS_PASSPHRASE` to its password. Set `HOST` to a trusted
network interface if other devices need to connect.

## Demo accounts

These accounts are created only when running outside production:

| Role | Email | Password |
|------|-------|----------|
| Patient | demo@medalert.demo | demo123 |
| Medical staff | doctor@medalert.demo | demo123 |

Demo patient national ID: `12345678`, phone `+254700000001`.

## Important: privacy and deployment

Accounts and profiles are stored in the server's SQLite database, so users can sign in from different
browsers that can reach the same server. Passwords are stored as salted hashes; sign-in uses an HTTP-only
session cookie.

**Do not enter real medical data.** This project is a demo, not a production medical-record system. Before
putting it on a public network, use a certificate from a trusted certificate authority, secure and back up the database, and arrange appropriate
access controls and privacy protections. GitHub Pages cannot run the Node server; deploy the app to a host
that supports Node.js and persistent SQLite storage instead.

**QR privacy:** The QR code contains only a secure random reference, not medical records or personal details.
To look up a QR code, a doctor must be signed in to MedAlert and scan it using the website's camera scanner;
the server also checks the doctor's role and the patient's sharing consent before returning profile details.
Other medical staff can still search by National ID or phone. Treat the reference as private. Earlier QR codes
containing medical details are no longer accepted; replace any old printed copies with the newly generated code.

## Files

```
frontend/         browser-only page, styles, views and API client
frontend/vendor/  locally bundled jsQR decoder and its Apache-2.0 license
backend/server.js API server and SQLite database
backend/qr.js     server-side QR encoder
backend/create-dev-cert.ps1 creates a local self-signed HTTPS certificate on Windows
data/             SQLite database (created on first run; ignored by Git)
```
