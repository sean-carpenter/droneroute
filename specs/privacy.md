# Privacy & data

Understand what DroneRoute stores about you and where it lives.

## What you can do

- **Read the privacy policy** from the about dialog — the "Privacy & data" link
  opens the full [PRIVACY.md](../PRIVACY.md) document.

## How it works

1. Open the about dialog (DroneRoute logo / about).
2. Click "Privacy & data — what we store and where".
3. The privacy policy opens, describing the data collected, where it's stored,
   and which third-party services are involved.

## Good to know

- DroneRoute is self-hosted first: in the default setup, your account and mission
  data never leave the server you run and is never sent to the DroneRoute authors.
- Passwords are stored only as bcrypt hashes, never in plain text.
- The app uses no analytics or tracking. Map tiles and location search go to
  Mapbox, and airspace lookups go to national providers, only as needed to draw
  the map and zones. The optional wind advisory sends a position rounded to
  about 1 km to Open-Meteo, and only while it is switched on.
- AI route proposals: DroneRoute never receives the documents you give an
  agent, only the geometry and notes the agent sends. An address the agent
  looks up goes to Mapbox.
- Shared mission links are viewable by anyone who has the link and show the
  owner's email — only share with people you trust.
