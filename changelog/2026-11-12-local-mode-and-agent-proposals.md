## Summary

A no-sign-in mode for personal self-hosted instances, and route proposals
drafted by AI agents from a survey or permit set.

## Changes

- Single-user mode (`SINGLE_USER=true`, self-hosted only): the app opens a
  local workspace without sign-in, so saving, the routes page and settings
  work with no account
- MCP endpoint at `/mcp` (`MCP_ENABLED=true`) with tools for agents: a planning
  guide, address lookup, boundary tracing from bearings and distances,
  State Plane / UTM conversion, and submitting a route proposal
- Route proposals: stored per user, reviewed on the map with move and rotate,
  and turned into pre-filled grid, corridor, orbit, tower or facade templates
- Grid survey can be clipped to a site boundary instead of filling a rectangle
- Setup guide for Claude Code, Cursor and Codex in `docs/agents.md`
