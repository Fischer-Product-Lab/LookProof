# Limitations

LookProof is deliberately narrow.

- It does not generate images or call a provider.
- It does not inspect pixels for style, identity, face, costume, anatomy, era, authorship, safety, rights, or visual quality.
- It does not score taste or rank creative alternatives.
- It does not guarantee consistency. A frozen clause and receipt make policy visible; they do not make a stochastic output comply.
- It does not prove that a reference is accurate, lawful, representative, or sufficient.
- It does not validate a reviewer's judgment. A request-policy receipt records that required clauses were observed in compiled instructions; it does not certify an image.
- It does not provide deterministic image transformation. `deterministicOnly` locks are refused rather than weakened.
- Its PNG check reads signature and IHDR dimensions; it is not a decoder, content scanner, or file-safety service.
- Inputs are finite: paths are limited to 4,096 characters, gates to 128, intent identifiers to 256, prompts to 8,192, and optional explanation detail to 4,096. The prompt boundary is shared by the core, compiled CLI, and MCP schema, leaving room under Windows' total command-line limit even when every supported `preflight` path argument is at its maximum. Explanation detail is accepted only for compatibility and its content is ignored.
- Whole-file JSON is limited to 1,048,576 bytes. Selected references are limited to 25 MiB each and 100 MiB total. These resource bounds do not make files safe or provide sandboxing.
- Version 0.2 keeps one evidence receipt and one human-review receipt per CLI or MCP compilation.
- `validate` is structural only. `validate_look` adds internal-link checks, but neither tool reads reference bytes or claims cross-document readiness.
- The local-only MCP server exposes four read-only stdio tools. It has no resources, prompts, sampling, logging, tasks, HTTP, or remote transport.
- MCP root containment is defense in depth, not a sandbox. Symlink/junction resolution reduces escapes but cannot remove residual local TOCTOU risk.
- It is not an adapter SDK, automation runner, credential vault, commercial-account layer, queue, marketplace, remote service, or publication tool.
- The runtime is not a general-purpose JSON Schema validator. Zod is used only for strict MCP arguments; document validators retain manual version 0.1 semantics.
- Compiled JavaScript is required for production execution. Dependencies are installed from the lockfile.

A separate system could consume compiled JSON. That system must perform its own security review, authorization, provider integration, data handling, and output evaluation. No such system is included here.
