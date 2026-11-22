# Contributing to Queue Health Watchdog

Thank you for contributing!

## Local Setup

```bash
git clone https://github.com/gavicoding/queue-health-watchdog.git
cd queue-health-watchdog
npm install
npm run build
npm test
```

## Design Rules

1. **Read-only guarantee:** Custom `QueueSourceAdapter` implementations must never execute writes, deletes, or mutations against monitored production databases.
2. **No alert storms:** Keep state transitions deterministic and covered by unit tests in `tests/watchdog.test.ts`.
3. **Zero runtime bloat:** Prefer Node.js built-in modules (`node:http`, `fetch`, `node:test`) for core functionality unless a database driver adapter is strictly needed.
