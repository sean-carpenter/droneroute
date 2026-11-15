# Obstacles and site features work over plain HTTP

Adding a POI, obstacle or site feature generated its id with
`crypto.randomUUID`, which browsers only provide on HTTPS or localhost. On a
self-hosted instance reached over plain HTTP the add silently failed. Ids now
fall back to `crypto.getRandomValues`, which works everywhere.
