---
description: "Fixed-target installer entry for the optional workbench market plugin of the Oristrat desktop product."
kind: "package-reference"
---

# dsh-desktop-market-installer

English | [中文](README.zh.md)

## Summary

Owns the fixed-target install, update, and uninstall flow for the optional community market plugin that replaces the workbench market placeholder after a Harness restart. The plugin stays off when `ORISTRAT_MARKET` is `0`.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount the row `dsh-desktop-market-installer` through a composition patch; the client half joins the Web module roster through the bundle dependency. Status and install routes live under `/dsh-desktop/market-installer/`.

## Dev Note

Vendored from upstream experimental packages and renamed to the @oristrat scope so the product composition can select them; the committed TypeScript sources remain the source plane.

## Model Experience

None, as the installer only moves plugin generations and records install state without contributing model context.

#### KV Cache effect

No model requests originate in this package, so prompt prefix caching is unaffected.

## Known Limitations and Deferred Work

- The market registry endpoint is the upstream community registry; air-gapped deployments see a clean refusal and keep the placeholder.
- Uninstall removes the plugin generation on the next Harness restart when the package manager reports the plugin busy.
