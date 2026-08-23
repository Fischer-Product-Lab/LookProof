# LookProof

LookProof is a local, provider-neutral creative-policy compiler and mechanical PNG checker. It reads a versioned `look.json`, a separate binding, local references, receipts, and a prompt. It proves declared checks ran and inputs were hashed. It does not prove artistic correctness or model compliance.

Nothing is sent. LookProof does not generate images, does not call a provider, and does not dispatch, upload, or publish anything.

## Try it

Node.js 22 or newer is required. Install the exact locked dependencies and compile the TypeScript first:

```sh
git clone https://github.com/Fischer-Product-Lab/LookProof.git
cd LookProof
npm ci
npm run build
node dist/src/cli.js preflight \
  --look fixtures/synthetic/look.json \
  --binding fixtures/synthetic/binding.json \
  --intent pass-tile \
  --prompt "Render the declared synthetic geometry." \
  --evidence-receipt fixtures/synthetic/receipts/evidence.json \
  --human-review-receipt fixtures/synthetic/receipts/human-review.json
```

The package remains `private: true`. The `lookproof` bin metadata supports local package linking; this README does not claim npm publication.

## Selected output

`npm run demo` builds first and calls the shared core directly against checked-in files under `fixtures/synthetic/`:

```text
demo: lookproof
dispatched: false
pass-with-human-review-receipt | exit 0 | gate pass
reference-conflict-refusal | exit 1 | gate reference-conflict
deterministic-only-refusal | exit 1 | gate deterministic-only-lock
mechanical-png-check | exit 0 | gate pass
```

The pass compiled locally, the declared policy conflicts were refused, the PNG header check passed, and no scenario dispatched anything.

## Flow

`look.json + binding.json + references + receipts -> local validation and compilation -> JSON envelope`

## Inputs and output

- `look.json` declares creative policy, intents, reference sets, paths, and optional locks.
- `binding.json` separately names inert provider and model metadata plus reference limits.
- Reference files are local files declared by relative path and SHA-256.
- Evidence and human-review receipts record support for locks that require them.
- `--prompt` supplies user text for `preflight`. `--image` supplies a local PNG for `check`.

`preflight` writes one JSON verdict to standard output. A pass includes `compiledRequest`, input hashes, verified reference hashes, and `requestSha256`. A refusal sets `compiledRequest` to `null`. Every verdict includes `"dispatched": false`.

`check` reads only the PNG signature and IHDR dimensions, then checks minimum width and aspect ratio. It does not decode or judge pixels.

## Commands

Run `node dist/src/cli.js --help` for the plain-text command reference and `node dist/src/cli.js --version` for the exact local version.

### `preflight`

```sh
node dist/src/cli.js preflight \
  --look <look.json> \
  --binding <binding.json> \
  --intent <intent-id> \
  --prompt <text> \
  [--room explore|locked] \
  [--evidence-receipt <receipt.json>] \
  [--human-review-receipt <receipt.json>]
```

Required options: `--look`, `--binding`, `--intent`, and `--prompt`.

Optional options: `--room explore|locked`, `--evidence-receipt`, and `--human-review-receipt`. Receipts are conditionally required by the selected intent. `--room` records the mode in the verdict and compiled envelope; it does not bypass checks. Version 0.2 keeps the single `--evidence-receipt` contract.

### `check`

```sh
node dist/src/cli.js check --look <look.json> --intent <intent-id> --image <image.png>
```

Required options: `--look`, `--intent`, and `--image`. This command reads only the PNG signature and IHDR dimensions.

### `validate`

```sh
node dist/src/cli.js validate \
  --schema look|binding|evidence-receipt|human-review-receipt \
  --file <document.json>
```

`validate` performs structural runtime validation only. It does not read reference bytes, resolve cross-document links, or claim preflight readiness. Unreadable or malformed JSON exits `2`; parsed schema-invalid data exits `1`.

### `explain`

```sh
node dist/src/cli.js explain --gate <gate> [--detail <text>]
```

`explain` uses a closed local remediation table plus a generic unknown-gate explanation. It reads no files. Optional `--detail` remains a bounded compatibility input, but its content is ignored and is never copied into the verdict or explanation.

### Exit codes

- Exit code `0` means the command passed.
- Exit code `1` means a declared check or input contract refused the operation.
- Exit code `2` means command arguments were invalid or required JSON could not be read.

Every non-help CLI invocation emits one JSON object, including on failure.

## Finite limits

LookProof applies the same character limits in the shared core and CLI as the strict MCP tool schemas:

- every supplied path: 4,096 characters (`MAX_PATH_CHARS`)
- refusal gate: 128 characters (`MAX_GATE_CHARS`)
- intent identifier: 256 characters (`MAX_INTENT_CHARS`)
- prompt: 8,192 characters (`MAX_PROMPT_CHARS`)
- optional explanation detail: 4,096 characters (`MAX_DETAIL_CHARS`)

The 8,192-character prompt limit is one shared boundary across the core, compiled CLI, and MCP schema. It leaves room under Windows' total command-line limit even when every supported `preflight` path argument is at its 4,096-character maximum.

Whole-file JSON input is limited to 1,048,576 bytes (`MAX_JSON_BYTES`). Each selected reference is limited to 25 MiB, or 26,214,400 bytes (`MAX_REFERENCE_BYTES`), and the selected references together are limited to 100 MiB, or 104,857,600 bytes (`MAX_TOTAL_REFERENCE_BYTES`). A value exactly at its limit is accepted; a value over its limit is refused.

Shared-core and CLI string-limit refusals use `input-too-large`. Oversized JSON or an individual reference uses `file-too-large`; an oversized selected-reference total uses `references-too-large`. These refusals exit `1`, keep `compiledRequest` null, keep `dispatched` false, and do not serialize local paths. Strict MCP schemas reject oversized string arguments before tool execution. JSON and reference files are statted before whole-file reads. The PNG checker remains a 24-byte prefix check and may inspect the header of a larger regular file without allocating the whole file.

## MCP server

LookProof includes a contained local-only MCP server over stdio. Build it, then start it with exactly one canonical root directory:

```sh
node dist/src/mcp.js --root C:/path/to/contained/files
```

Tool paths must be relative to that root. No environment variables are read or required. The server exposes only these four immutable read-only tools, in this order:

1. `validate_look`: validates the Look schema and internal links without reading reference bytes or claiming readiness.
2. `compile_request`: runs the shared preflight, including reference containment and SHA-256 checks, without provider calls or writes.
3. `check_image`: checks PNG signature and IHDR width/aspect constraints only.
4. `explain_refusal`: uses the same closed local explanation table and reads no files.

Example Hermes stdio configuration:

```yaml
mcp_servers:
  lookproof:
    command: "node"
    args:
      - "C:/absolute/path/to/LookProof/dist/src/mcp.js"
      - "--root"
      - "C:/absolute/path/to/contained/files"
```

The MCP boundary rejects absolute, drive-relative, UNC/device, NUL, traversal, non-file, and resolved link-escape paths. In-root links may resolve to in-root regular files. This containment is defense in depth, not a sandbox, and local file changes retain a residual TOCTOU risk.

## Schemas

- [`schema/look.schema.json`](schema/look.schema.json) defines provider-neutral policy, intents, references, paths, and optional locks.
- [`schema/binding.schema.json`](schema/binding.schema.json) defines inert provider/model identity and reference limits.
- [`schema/evidence-receipt.schema.json`](schema/evidence-receipt.schema.json) defines evidence tied to a lock, reference, and SHA-256.
- [`schema/human-review-receipt.schema.json`](schema/human-review-receipt.schema.json) defines request-policy review. It does not certify an image.

Schema versions remain unchanged in 0.2. The manual runtime validators preserve the published semantics. Zod is used only for strict MCP argument shapes.

## Security and limitations

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. The [threat model](docs/threat-model.md) documents trust boundaries, path controls, hashes, and residual risks. [Limitations](docs/limitations.md) states what the checks do not establish.

A compiled envelope is a local artifact for review. It is not authorization to call a provider.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run demo
git diff --check
git fsck --full
npm audit --omit=dev
```

Generated `dist/` files are ignored. Tests and the demo may create temporary local fixtures; production source performs no filesystem writes.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
