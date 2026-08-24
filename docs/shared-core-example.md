# Shared-core proof

This example uses only checked-in synthetic fixtures. It contains no private study data, provider credentials, or generated images.

## CLI

Build first, then run the deterministic-only intent:

```sh
npm ci --ignore-scripts
npm run build
node dist/src/cli.js preflight \
  --look fixtures/synthetic/look.json \
  --binding fixtures/synthetic/binding.json \
  --intent deterministic-tile \
  --prompt "Render the declared synthetic geometry."
```

The command exits `1` and writes one JSON object:

```json
{
  "status": "fail",
  "room": "locked",
  "gate": "deterministic-only-lock",
  "detail": "Required lock fixed-pixel-grid is deterministic-only and cannot be compiled into a generative request.",
  "warnings": [],
  "compiledRequest": null,
  "dispatched": false
}
```

The refusal happens before reference upload, provider access, or generation. LookProof does not provide any of those capabilities.

## MCP

Start the local stdio server with the same synthetic directory as its root:

```sh
node dist/src/mcp.js --root fixtures/synthetic
```

Call `compile_request` with relative paths:

```json
{
  "look_path": "look.json",
  "binding_path": "binding.json",
  "intent_id": "deterministic-tile",
  "prompt": "Render the declared synthetic geometry."
}
```

The MCP tool returns the same verdict object as the CLI.

The test suite launches the real stdio server and asserts deep equality between CLI and MCP verdicts for:

- a passing compile and its `requestSha256`
- `reference-conflict`
- `deterministic-only-lock`
- reference hash mismatch
- PNG format checks

See [`tests/mcp.test.ts`](../tests/mcp.test.ts), especially `CLI and MCP verdicts are equal for passes, policy/hash refusals, PNG gates, and requestSha256`.

## What this proves

- both adapters call the same core behavior
- the deterministic-only lock is refused locally
- the refusal does not produce a compiled generative request
- every verdict keeps `dispatched: false`

It does not prove artistic correctness, image compliance, provider behavior, or cost savings outside the refused request.
