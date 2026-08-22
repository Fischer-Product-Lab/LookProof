# LookProof

LookProof reads a versioned `look.json`, a separate provider and model binding, local references, receipts, and a prompt. It validates them and writes one JSON request envelope.

Nothing is sent. LookProof proves declared checks ran and inputs were hashed. It does not prove artistic correctness or model compliance.

## Try it

Node.js 22 or newer is required. The repository has no package dependencies.

```sh
git clone https://github.com/Fischer-Product-Lab/LookProof.git
cd LookProof
node --experimental-strip-types src/cli.ts preflight \
  --look fixtures/synthetic/look.json \
  --binding fixtures/synthetic/binding.json \
  --intent pass-tile \
  --prompt "Render the declared synthetic geometry." \
  --evidence-receipt fixtures/synthetic/receipts/evidence.json \
  --human-review-receipt fixtures/synthetic/receipts/human-review.json
```

## Selected output

`npm run demo` reads only the checked-in files under `fixtures/synthetic/`. These selected fields come from its output:

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
- `--prompt` supplies the user text for `preflight`. `--image` supplies the local PNG for `check`.

`preflight` writes one JSON verdict to standard output. A pass includes `compiledRequest`, its input hashes, verified reference hashes, and `requestSha256`. A refusal sets `compiledRequest` to `null`. Every verdict includes `"dispatched": false`.

`check` writes one JSON verdict and never creates a request envelope. It reads the PNG signature and IHDR dimensions, then checks minimum width and aspect ratio.

## Commands

### `preflight`

```sh
node --experimental-strip-types src/cli.ts preflight \
  --look <look.json> \
  --binding <binding.json> \
  --intent <intent-id> \
  --prompt <text> \
  [--room explore|locked] \
  [--evidence-receipt <receipt.json>] \
  [--human-review-receipt <receipt.json>]
```

Required options: `--look`, `--binding`, `--intent`, and `--prompt`.

Optional options: `--room explore|locked`, `--evidence-receipt`, and `--human-review-receipt`. Receipts are conditionally required by the selected intent when its locks require evidence or human review. `--room` records the mode in the verdict and compiled envelope. It does not bypass checks.

### `check`

```sh
node --experimental-strip-types src/cli.ts check \
  --look <look.json> \
  --intent <intent-id> \
  --image <image.png>
```

Required options: `--look`, `--intent`, and `--image`. This command reads only the PNG signature and IHDR dimensions. It does not decode or judge the image.

### Exit codes

- Exit code `0` means the command passed.
- Exit code `1` means a declared check or input contract refused the operation.
- Exit code `2` means the command arguments were invalid or required JSON could not be read.

Each command emits one JSON object, including on failure.

## Schemas

- [`schema/look.schema.json`](schema/look.schema.json) defines provider-neutral policy, intents, references, paths, and optional locks.
- [`schema/binding.schema.json`](schema/binding.schema.json) defines separately selected provider and model metadata plus reference limits.
- [`schema/evidence-receipt.schema.json`](schema/evidence-receipt.schema.json) defines evidence tied to a lock, reference, and SHA-256.
- [`schema/human-review-receipt.schema.json`](schema/human-review-receipt.schema.json) defines review of request-policy observability. It does not certify an image.

The schemas are closed to unknown properties where the runtime is closed. Lock observability fields remain optional. The runtime supplies documented defaults when those fields are absent.

## Security and limitations

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. The [threat model](docs/threat-model.md) documents the trust boundary, refusal behavior, path controls, hashes, and residual risks. [Limitations](docs/limitations.md) describes what the checks do not establish.

A compiled envelope is a local artifact for review. It is not authorization to call a provider.

## Development

Run the checked-in quality gates without installing dependencies:

```sh
npm test
npm run demo
git diff --check
git fsck --full
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
