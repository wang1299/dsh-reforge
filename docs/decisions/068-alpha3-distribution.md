# ADR068 — Distribute the five Agent and memory features in alpha.3

[Release task #167](https://github.com/wang1299/dsh-reforge/issues/167) authorizes the npm package, its default installation tag and the GitHub prerelease for `0.1.0-alpha.3`.

The DSH entry keeps its existing defaults and exact host range. The context policy is opt-in. Memory review and revalidation remain owner operations. Add explicit package exports for semantic planning, the repair controller and its native tool adapter. Ship the existing scripted repair rehearsal and an offline replay of the frozen semantic holdout in the tarball. They are opt-in examples for an isolated working directory. Keep the public synthetic inputs and helper files on an exact allowlist. Preserve the original first-release audit and all frozen method data.

Use the annotated-tag procedure in [ADR044](044-alpha2-release.md) for this exact version. Freeze a clean main build after independent review and CI on the reviewed PR and its merged source. Check installation on both supported hosts and exercise the examples from the actual archive. Verify the registry artifact and both npm tags. Publish that same archive, its SHA-256 checksum and the release manifest as a GitHub prerelease. An uncertain publication result requires a registry or release read-back before another write.
