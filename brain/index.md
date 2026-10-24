# Brain

Knowledge vault for ai-gateway-proxy, readable as an Obsidian vault. One topic per file, wikilinks for cross-references. It records how the library works and why it is shaped the way it is, with a source path, commit or pull request for every claim. Where something is not known, the note says so.

The README is the user documentation and stays the authority on the public API. These notes are for someone changing the code.

Cite a commit by its hash on `main` (the squash commit `git log` shows), not a pull request's head commit, and check it resolves with `git cat-file -t <hash>` before writing it down. On 2026-10-24 seven hashes cited across eight notes did not resolve here: six were replaced by the `main` commits they described, and the seventh is marked unknown in [[development/release]].

## Architecture

- [[architecture/index]]: the request path, authentication and streaming

## Development

- [[development/index]]: toolchain, tests, CI and the release process

## Decisions

- [[decisions/index]]: dated records of choices that a later change could easily undo by accident

## Plans

- [[plans/index]]: what comes next
