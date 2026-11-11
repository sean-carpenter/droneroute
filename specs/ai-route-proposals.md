# AI route proposals

Hand a survey, plat or permit set to an AI agent and get a first route to review.

## What you can do

- Connect an AI agent (Claude, Cursor, Codex or any MCP client) to DroneRoute.
- Ask the agent to read your documents and draft a route.
- Review the agent's **proposal** on the map: the site boundary, structures and linear features it found, how it located the site, what it assumed and what it wants you to check.
- **Move and rotate** the proposed site until it sits correctly on the map.
- Turn each suggested mission into a template that opens already filled in: a mapping grid clipped to the site boundary, a corridor along a road or utility, an orbit or tower inspection around a structure, or a facade scan along a wall.
- Mark a proposal done, or dismiss it.

## How it works

1. Turn on the agent connection and add DroneRoute to your agent (see [docs/agents.md](../docs/agents.md)).
2. Give the agent your documents and ask for a route.
3. The agent locates the site from printed coordinates, an address, or bearings and distances, and sends a proposal. It gives you a link.
4. Open the link. A banner on the map also shows when proposals are waiting.
5. Check the placement, read the notes, and press **Use** on the suggestions you want.
6. Adjust and apply each template as usual, then save or export the mission.

## Good to know

- DroneRoute never receives your documents — only the geometry and notes the agent extracted.
- Nothing is added to a mission until you press **Use** and apply the template.
- Agents can list your saved missions by name but cannot change or delete them.
- A boundary traced from bearings reports whether it closes. If it does not, a call was probably misread.
- Curved boundary segments are approximated by straight chords.
- The agent connection is off unless `MCP_ENABLED=true` is set.
