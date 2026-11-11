# Drafting routes with an AI agent

DroneRoute can take a first route from an AI agent. You give the agent a
survey, plat or permit set; it reads the document, works out where the site is
and what is on it, and sends DroneRoute a **route proposal**. You then open the
proposal in DroneRoute, move it into place if needed, and turn its suggestions
into missions with the normal template tools.

DroneRoute never receives your documents. The agent reads them and sends only
the geometry it extracted (boundary, structures, alignments) plus its notes.
Whatever the agent's own provider does with the documents is governed by that
provider.

## Turn it on

The agent connection is an [MCP](https://modelcontextprotocol.io) endpoint served
by DroneRoute itself at `/mcp`. Enable it with an environment variable:

```
MCP_ENABLED=true
```

- In single-user mode (`SINGLE_USER=true`) agents work in the local workspace
  and need no credentials. Keep the port bound to `127.0.0.1`.
- Otherwise each request needs `Authorization: Bearer <token>`, using the same
  session token the web app uses.
- The endpoint only answers requests addressed to `localhost` or `127.0.0.1`.
  Add other hostnames with `MCP_ALLOWED_HOSTS=name1,name2`.

## Connect your agent

The examples assume DroneRoute runs at `http://localhost:3001`.

### Claude Code

```
claude mcp add --transport http droneroute http://localhost:3001/mcp
```

### Cursor

Add to `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for every
project:

```json
{
  "mcpServers": {
    "droneroute": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.droneroute]
url = "http://localhost:3001/mcp"
```

## Ask for a route

Attach or point the agent at your documents and ask, for example:

> Read this permit set and draft a first drone route in DroneRoute. I need a
> site map and a closer look at the new building.

The agent should read DroneRoute's planning guide first (the
`get_route_planning_guide` tool, or the `draft_route_from_documents` prompt),
then finish by giving you a link such as
`http://localhost:3001/?proposal=…`. Open it to review.

## What the agent can do

| Tool                       | What it does                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `get_route_planning_guide` | Instructions for reading a survey or permit set and choosing missions.                                    |
| `geocode_address`          | Looks up an address (sent to Mapbox).                                                                     |
| `boundary_from_bearings`   | Traces bearings and distances from a point of beginning into a polygon and reports whether it closes.     |
| `convert_coordinates`      | Converts State Plane, UTM and other projected coordinates to latitude and longitude, given the EPSG code. |
| `submit_route_proposal`    | Saves the proposal and returns the review link.                                                           |
| `list_missions`            | Lists your saved missions by name, read-only.                                                             |

An agent cannot change or delete missions, and nothing it proposes is added to
a mission until you use it.

## Reviewing a proposal

- The site boundary, structures and alignments appear as an overlay on the map.
- The panel says how the site was located. An address or an estimate is rarely
  exact: drag the round handle to move the overlay and set a rotation if the
  outline is turned.
- Read the warnings and the agent's assumptions.
- Press **Use** on a suggestion to open it as a template, already filled in.
  Adjust it and apply it like any other template.
- **Done** marks the proposal as handled; **Dismiss proposal** discards it.

## Limits

- Curved boundary segments are drawn as straight chords.
- Survey bearings are usually not true north, so a traced boundary can be
  rotated by a degree or two until you correct it.
- A boundary traced from an address is only as well placed as the address.
- The agent can misread a drawing. Check the proposal against the map and the
  site before flying.
