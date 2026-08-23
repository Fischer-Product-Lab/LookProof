# Threat model

## Security boundary

LookProof reads local JSON and referenced files, compiles one JSON envelope, or mechanically checks PNG dimensions. Version 0.2 has two adapters over one shared core: a compiled CLI and a local-only MCP stdio server. Neither adapter has a provider call, credential reader, network transport, upload, generation, publication, or commercial-account integration.

The local operator controls CLI paths. An MCP host supplies one startup `--root`; every MCP tool path is untrusted until the single `RootedFiles` boundary validates it.

## Protected properties

- A provider-neutral Look cannot silently select an execution target.
- A selected reference must remain inside the declared references folder after lexical and real-path checks.
- A reference must be a regular readable file whose SHA-256 matches its declaration.
- A required lock cannot be hidden by a conflicting reference.
- A deterministic-only requirement cannot be represented as satisfied by a generative request.
- Evidence and human-review receipts must match the lock, reference hash, Look, intent, and request-policy clauses they claim to cover.
- `mustShow` clauses are observable in the frozen prefix and structured policy and are covered by the canonical request hash.
- Every verdict declares `dispatched: false`.
- MCP stdout contains protocol messages only after startup.

## Threats and mitigations

### MCP root containment and path traversal

The MCP startup root must realpath to a directory. Tool paths must be relative under that canonical root. Empty and NUL paths, POSIX absolute paths, Windows drive-absolute and drive-relative paths, UNC/device paths, any `..` segment split on slash or backslash, lexical escapes, resolved symlink or junction escapes, and non-regular files fail closed. Prefix collisions are checked with path relations rather than string prefixes.

Declared Look reference roots and files receive a second boundary. They must remain inside both the real Look folder/reference root and the canonical MCP root. In-root links may resolve only to in-root regular files. Verdicts retain declared relative reference paths and never serialize canonical machine paths.

CLI path behavior remains explicit and compatible with version 0.1. CLI references still receive their established Look-folder and real-path containment checks.

### Reference substitution

A changed file fails the declared SHA-256 comparison. The compiled envelope records the verified digest while retaining only the declared relative path.

### Binding contamination

The Look and binding use separate closed schemas. A Look cannot contain provider or model fields. A binding contains only inert identity and limit metadata; endpoint, credential, transport, and adapter fields are outside the schema.

### Receipt substitution

An evidence receipt must identify the required lock, a selected supporting reference, and that reference's verified digest. A human-review receipt must identify the Look and intent, have `request-policy` scope and a passing decision, and contain an observed finding for each required clause. Receipt inclusion is observable but is not proof that a future image will comply.

### Hash ambiguity

The compiler hashes the original Look and binding bytes. It computes `requestSha256` over recursively key-sorted canonical JSON before adding the hash field. Arrays retain declared order.

### Malformed PNG input

`check` and `check_image` require a PNG signature, a standard IHDR header, and nonzero dimensions before evaluating width and aspect ratio. They do not decode or semantically inspect image pixels.

### Resource bounds and untrusted explanation detail

The shared core, compiled CLI, and strict MCP schemas limit paths to 4,096 characters, gates to 128 characters, intent identifiers to 256 characters, prompts to 8,192 characters, and optional explanation detail to 4,096 characters. The prompt boundary leaves room under Windows' total command-line limit even when every supported `preflight` path argument is at its maximum. The compatibility detail accepted by `explain` and `explain_refusal` is ignored; summaries, remediation, verdict detail, and assistant-facing explanation values come only from the closed gate table.

Whole-file JSON reads are limited to 1,048,576 bytes. Both file adapters perform the applicable containment check and stat a regular JSON file before allocating or parsing its bytes; MCP containment occurs before the size decision. Selected references are statted before hashing or whole-file reads, limited to 25 MiB each, and tracked in selection order against a 100 MiB total before reading beyond that total. Refusals use closed details that do not serialize local paths. The PNG check reads exactly the first 24 bytes and does not allocate the whole image.

These finite limits reduce accidental or adversarial memory and explanation-injection exposure. They are input controls, not sandboxing or operating-system isolation.

### MCP protocol surface

The server uses the official MCP v2 stdio factory and advertises only an immutable tools capability. It registers no resources, prompts, completion, logging, sampling, elicitation, tasks, or remote transport. Expected policy refusals are ordinary one-text-block tool results, not protocol errors. Invalid argument shapes are rejected by strict Zod object schemas.

### Network and publication

Production source has no outbound-network primitive or dispatch command. A separate program could consume a compiled envelope; that program is outside this trust boundary.

## Residual risks

- Root containment is defense in depth, not a sandbox or operating-system isolation boundary.
- A local file can change between validation, hashing, and later consumption. This residual local TOCTOU risk cannot be removed by path checks alone; re-run preflight immediately before separate use.
- SHA-256 protects byte identity, not truth, provenance, rights, or quality.
- A human receipt can be false or careless; the tool validates consistency, not reviewer competence.
- JSON Schema files document the public format. The manual runtime implements LookProof's gates and is not a general-purpose JSON Schema engine.
- Dependencies are locked, but consumers still own dependency review and local runtime security.
