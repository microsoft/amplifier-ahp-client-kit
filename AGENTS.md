# Client kit contributor entry point

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.

Read [README](README.md), [local vision](docs/VISION.md) and
[contract v1](contracts/client-kit.v1.md) before changing behavior. The shared
approved family direction owns product promises; upstream AHP owns wire schemas,
actions, reducers and reconciliation. Keep this repository limited to reusable
client mechanisms, storage interfaces and its existing noninteractive client.
Clients own widgets, presentation, private drafts and interest policy; hosts and
native adapters own accepted work and canonical history. Propose new scope to the
relevant owner; do not self-ratify it or duplicate normative definitions.

Use isolated checkouts/state for fixture qualification. No unknown-work replay or
private-draft synchronization. Record exact source/archive/peer versions and skips;
source, packed consumer, browser/device/account and deployment are distinct tiers.
Use the existing tests mapped in the contract when behavior changes; documentation
only changes need link/manifest/source equality checks, not redundant runtime runs.
Preserve sealed artifacts and give documentation successors their own revision.

## Ecosystem maps

Keep this repository's README and product-page maps aligned with the
[Constellation map guide](https://github.com/microsoft/amplifier-constellation/blob/main/docs/ecosystem-maps.md)
and its canonical registry; start with this repository's
`docs/ecosystem-map.json`. When creating, renaming, splitting, retiring, or
changing a role, interface, parent, or dependency, inspect incoming and outgoing
relationships and update every affected parent/consumer map and link, including
the centralized product pages. Regenerate from source data and synchronize local
records/images rather than hand-editing generated images. Describe actual
boundaries and optional choices; a role highlight is not a compatibility claim.
Documentation work does not authorize deployment or resume paused product work.
