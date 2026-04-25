# GP-hoot Load Testing

The load harness starts an isolated GP-hoot server with a temporary JSON database and temporary upload directory. It disables rate limiting for the synthetic single-machine run, then connects host and player sockets over WebSocket.

## Commands

Smoke test:

```bash
npm run load:gp-hoot -- --rooms=2 --players=5 --questions=1 --jitter-ms=50 --strict
```

Single-room target:

```bash
npm run load:gp-hoot -- --rooms=1 --players=50 --questions=1 --jitter-ms=250 --strict
```

Combined stress target:

```bash
npm run load:gp-hoot -- --rooms=20 --players=50 --questions=2 --jitter-ms=250 --connect-batch=100 --strict
```

## Latest Local Results

Machine: local Mac development environment.

| Scenario | Player sockets | Host sockets | Questions | Answer errors | p95 answer ack | p99 answer ack | Max answer ack | Server RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 room x 50 players | 50 | 1 | 1 | 0 | 2ms | 5ms | 5ms | 99MB |
| 20 rooms x 50 players | 1000 | 20 | 1 | 0 | 18ms | 35ms | 51ms | 144MB |
| 20 rooms x 50 players | 1000 | 20 | 2 | 0 | 26ms | 39ms | 60ms | 184MB |

The PRD budget is sub-300ms answer latency under 50 players per room. The latest local run is within budget.

## Implementation Note

The first 20-room x 50-player run exposed a bottleneck: broadcasting a full per-socket room state after every answer caused p95 answer acknowledgements around 1292ms. The server now throttles room-state broadcasts during answer collection and emits immediate full state on phase changes such as question close/results. This keeps answer acknowledgement latency low while preserving live host/player updates.

## Caveats

- This is a local synthetic test, not a WAN test.
- All simulated sockets originate from one machine; rate limits are disabled in the harness using `GP_HOOT_DISABLE_RATE_LIMIT=1`.
- Real network conditions, TLS termination, reverse proxies, and cloud CPU limits can change results.
- Run the same harness on the intended deployment instance before treating the numbers as production capacity.
