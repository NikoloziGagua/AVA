# Account-bound integrations: WhatsApp, Google Calendar, Gmail

Ava drives a **persistent, visible Chrome profile** (`data/chrome-profile`).
Whatever you log into in *her* browser window stays logged in — cookies and
sessions survive across runs. That's the whole trick: one manual login each,
then she can act on your behalf.

Start the dedicated AVA browser once from a normal PowerShell window:

```powershell
.\scripts\start-ava-browser.cmd
```

AVA attaches to that browser over `http://127.0.0.1:9222`. This also works on
Windows installations where managed Node processes are not allowed to spawn
Chrome directly. The helper uses installed Chrome or Edge, so downloading a
separate Playwright Chromium build is not required.

The same persistent browser covers Instagram, WhatsApp Web, Gmail, Calendar,
Outlook, and other websites. Instagram and WhatsApp have dedicated verified
workflows; other sites use AVA's general browser tools.

## One-time setup per service

### WhatsApp
1. Tell Ava: **"Open web.whatsapp.com"** — her browser window appears on the desktop.
2. Scan the QR with your phone (WhatsApp → Linked devices → Link a device).
3. Done. From then on: *"Message John on WhatsApp saying I'll arrive 15 minutes late."*

Verified 2026-07-03: the page loads correctly in her profile and she reports
login state honestly (she saw and described the QR screen).

### Google Calendar / Gmail
1. Tell Ava: **"Open accounts.google.com in your browser"**.
2. Log in in her window (if Google balks at an automated browser, complete any
   verification it asks for — once the session exists it stays).
3. Then: *"Schedule a meeting with Sarah next Tuesday afternoon"* /
   *"Draft a reply to the latest email from X"*.

## Practical notes

- **First sends are supervised by design**: `chrome_type` / `chrome_click` are
  mutating tools — the policy engine can require approval, and every step is
  visible in the chat's Activity panel. Test with a message to yourself first.
- **Sessions expire** (WhatsApp after long inactivity, Google rarely). Symptom:
  Ava reports a login screen. Fix: redo the one-time login.
- **Security**: `data/chrome-profile` holds live sessions for anything you log
  into. It is gitignored and never leaves this machine — but treat the machine
  itself accordingly. To revoke Ava's access to a service, log her browser out
  of it (or unlink the device in WhatsApp).
- **Prefer APIs where they exist**: for heavy Calendar/Gmail use, a proper API
  integration (OAuth + tokens in `.env`) beats browser automation for speed and
  reliability — candidates are listed in the roadmap brainstorm doc.
