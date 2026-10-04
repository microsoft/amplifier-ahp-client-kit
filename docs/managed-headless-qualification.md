# Managed headless selection qualification

This applies the existing CK4/CS4 boundary to the noninteractive client. The host's
negotiated `managedCreation` v1 owns configured choices, allocation and receipts;
this package adds no native method or authentication authority. Existing TUI
managed flags remain unchanged. Root distribution's headless executable delegates
to this kit, so it needs the new package to expose these flags.

The implementation was based on public kit `3c0e160f380160aca0d9e76290ca7079530ac453`.
The inspected class inventory included the existing kit CLI/headless journal,
TUI `280f572b1b613152c78288551eb46bd076a8083a` managed creation path and root
`45da610f2a53744d8d89a54f47f3e24a02c8ae52` delegation. Flags were already supported
by TUI; they were absent from kit main. No TUI, host, native or auth changes are
needed for this addition.

## Demonstrated acceptance

- 14 focused source wire/CLI cases: exact bundle revision and provider instance,
  distinct creation/input commands, omitted/invalid capability, stale selection,
  immutable input reuse, malformed proof, typed pre-effect refusal, lost replies,
  failed durable admission, concurrent inspection and separate-process recovery.
- Independently npm-installed archive: all 15 shipped files byte-equal to source
  and archive; Node 22.22.0 suite 36 passed, 1 skipped. The skipped test is the older
  `AHP_HEADLESS_NATIVE_PROVIDER` fixture; the new self-contained managed native
  fixture ran against actual installed host/Core/Foundation.
- Actual installed host `5d46901ca16a3c119ec6635cba1b732ac4c3c4d7` and native source
  `fc76b665015ea60018fd566a690466f157b76e46` (public merge `8b966581dbd78f41e434d5e2e237b3b7e57dfa3b`):
  a chosen bundle, distinct provider instance, second model and explicit effort
  reached the offline provider on the first input and a new explicit input after
  cold host restart. Exact command inspection did not add a canonical user row.
- The fixture supplies owned HOME/settings/lease/cache roots, Python `-I -B`,
  immutable runtime policy and explicit installed module sources. Shared user
  settings/keys were hash-guarded and unchanged. No real provider account or model
  was used. Earlier fixture-only setup and disk-exhaustion failures are retained
  in the external qualification packet; they are not passing evidence.

## Reproduction and limits

`npm ci --ignore-scripts && npm test` runs source checks and explicitly skips
unconfigured installed peers. `npm pack --ignore-scripts`, install the archive
in a separate consumer, then copy only `test/` for qualification and run it against
the installed `src/`. Tests are not shipped in the runtime archive. Hosted CI
runs source and independent packed-consumer checks on Node 22/24 without native
peers. The local artifact/peer hashes and exact logs belong to the handoff packet.

Set `AHP_HEADLESS_HOST_MODULE` and `AHP_HEADLESS_NATIVE_PYTHON` to exact installed
peers for the new managed fixture. `AHP_HEADLESS_KEEP_FIXTURE=1` retains success;
failures retain their owned state. Do not replay an unknown input during debugging.

A confirmed creation is not proof of model availability or prompt success. A local
admission that may still dispatch stays unknown even if creation is confirmed.
Only a settled local non-delivery and matching creation receipt permit the
`not-sent` recovery message. Recovery never dispatches the unsent prompt. Real
accounts, physical terminals, Windows storage, current deployment adoption and
TypeScript consumer compilation are outside this qualification.
