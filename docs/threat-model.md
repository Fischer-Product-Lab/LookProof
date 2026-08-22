# Threat model

## Security boundary

LookProof reads local JSON and referenced files, compiles one JSON envelope, or mechanically checks PNG dimensions. It has no transport, provider adapter, credential reader, dispatch path, server, upload, publication, or commercial-account integration.

The local operator controls the Look, binding, receipt, prompt, and image paths. These inputs are untrusted until preflight has checked the relevant boundary.

## Protected properties

- A provider-neutral Look cannot silently select an execution target.
- A selected reference must remain inside the configured relative references folder after path normalization and real-path resolution.
- A reference must be a regular readable file whose SHA-256 matches its declaration.
- A required lock cannot be hidden by a conflicting reference.
- A deterministic-only requirement cannot be represented as satisfied by a generative request.
- Evidence and human-review receipts must match the lock, reference hash, Look, intent, and request-policy clauses they claim to cover.
- `mustShow` clauses are observable in the frozen prefix and structured policy and are covered by the canonical request hash.
- Every result declares `dispatched: false`.

## Threats and mitigations

### Path traversal and link escape

Absolute reference paths, lexical traversal outside the configured root, missing roots, non-files, and resolved-link escapes fail closed. The compiler resolves both the declared references root and every selected file before reading bytes.

### Reference substitution

A changed file fails the declared SHA-256 comparison. The compiled envelope records the verified digest while retaining only the declared relative path, so it does not expose a machine-local absolute path.

### Binding contamination

The Look and binding use separate closed schemas. A Look cannot contain provider or model fields. A binding contains only inert identity and limit metadata; endpoint, credential, transport, and adapter fields are outside the schema.

### Receipt substitution

An evidence receipt must identify the required lock, a selected supporting reference, and that reference's verified digest. A human-review receipt must identify the Look and intent, have `request-policy` scope and a passing decision, and contain an observed finding for each required clause. Receipt inclusion is observable but is not proof that a future image will comply.

### Hash ambiguity

The compiler hashes the original Look and binding bytes. It computes `requestSha256` over a recursively key-sorted canonical JSON representation of the request before the hash field is added. Arrays retain their declared order.

### Malformed PNG input

`check` requires a PNG signature, a standard IHDR header, and nonzero dimensions before evaluating width and aspect ratio. It does not decode or semantically inspect image pixels.

### Network and publication

There is no outbound-network primitive or dispatch command in the CLI or demo. This repository cannot prevent a separate program from consuming an envelope; that separate program is outside this trust boundary.

## Residual risks

- Local files can change after preflight; consumers should re-run preflight immediately before any separate use.
- SHA-256 protects byte identity, not truth, provenance, rights, or quality.
- A human receipt can be false or careless; the tool validates consistency, not reviewer competence.
- JSON Schema files document the public format. The zero-dependency runtime implements the gates used by this compiler and should not be treated as a general JSON Schema engine.
