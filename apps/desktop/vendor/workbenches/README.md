---
description: "Workbench catalog, market install flow, pinned sidebar navigation and the native conversation frame for the Oristrat desktop product."
kind: "package-reference"
---

# dsh-desktop-workbenches

English | [中文](README.zh.md)

## Summary

Hosts the workbench product layer ported from dataelement/dsh-desktop: the catalog reader over the published market index, install/update/uninstall through the desktop isolated-generation boundary recorded in `market-installs.json`, pinned sidebar shortcuts, and the conversation frame workbenches render into. Market metadata comes exclusively from the published protocol v2 index; a provider counts as the installed form of a market entry only when its registration descriptor carries the canonical repository URL.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount the row `dsh-desktop-workbenches` with `config.root` pointing at the harness-home workbench directory; the client module joins the Web roster through the bundle dependency and registers the sidebar panel plus conversation frame seats. Authoring and market-submission guides ship as offline copies served under `/api/desktop-workbenches/` and link to the official reading pages.

Web uses the same market, sidebar switcher, and workbench provider registrations. The frame occupies the root `main` entry keyed `conversation` and renders `conversation.main`, preserving business panel state across Session changes while the native composer follows its Session binding. New Session actions create owned Sessions, ordinary reuse excludes those blanks, and selecting a bound Session restores its workbench. Market installation requires the composed `dsh-desktop-market-installer`; installation persists the package before requesting a host restart.

### Create a local workbench

Choose **Build my workbench**, enter a name and purpose, then **Create and open**. The basic workbench provides shared notes beside native AI conversations; notes save automatically on the Host. Creation writes a definition under `config.root/local-workbenches/<uuid>.json`, and the running profile loads it immediately and after restarts. The definition uses a local identity and does not publish a package or invent a repository. Retrying the same creation request returns the existing definition. The advanced development instructions remain available for custom interfaces.

The authenticated routes `GET /api/desktop-workbenches/local` and `POST /api/desktop-workbenches/local/create` list definitions and create one from `{requestId, title, description}`. Names allow 80 characters, purposes 1,000; empty text and invalid UUIDs are rejected before writing. A corrupt saved definition prevents loading and reports an error instead of replacing data. Notes and Session ownership retain their existing `state.json` storage.

## Dev Note

Vendored from upstream experimental packages and renamed to the @oristrat scope so the product composition can select them; the committed TypeScript sources remain the source plane.

## Model Experience

None, as the catalog, navigation, and install flow stay client- and host-side without contributing model context.

#### KV Cache effect

No model requests originate in this package, so prompt prefix caching is unaffected.

## Known Limitations and Deferred Work

- The market catalog endpoint is the upstream community registry; offline deployments fall back to installed workbenches with a visible retry.
- Sidebar shortcuts persist per profile; removing an install keeps sessions and notes.
