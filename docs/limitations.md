# Limitations

LookProof is deliberately narrow.

- It does not generate images or call a provider.
- It does not inspect pixels for style, identity, face, costume, anatomy, era, authorship, safety, rights, or visual quality.
- It does not score taste or rank creative alternatives.
- It does not guarantee consistency. A frozen clause and receipt make policy visible; they do not make a stochastic output comply.
- It does not prove that a reference is accurate, lawful, representative, or sufficient.
- It does not validate a reviewer's judgment. A request-policy receipt only records that required clauses were observed in the compiled instructions.
- It does not provide deterministic image transformation. `deterministicOnly` locks are refused rather than weakened.
- Its PNG check reads signature and IHDR dimensions; it is not a full decoder, content scanner, or file-safety service.
- It accepts one evidence receipt and one human-review receipt per CLI invocation in this initial candidate.
- It is not an adapter SDK, automation runner, credential vault, commercial-account layer, queue, marketplace, service, or publication tool.
- It is a zero-dependency Node.js 22 implementation and not a general-purpose JSON Schema validator.

A separate system could consume the compiled JSON. That system must perform its own security review, authorization, provider integration, data handling, and output evaluation. No such system is included here.
