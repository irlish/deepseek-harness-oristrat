---
description: "Installation-owned Office authoring: Word template workflow, template library, and business skills for the Oristrat product."
kind: "package-reference"
---

# dsh-desktop-office

English | [中文](README.zh.md)

## Summary

Registers the Office authoring surface: a template library over the bundled office-skills assets, the Word template workflow tools, and the client seats that surface templates in the conversation (hero dock, composer accessory, user-message footer). Activation requires absolute `resources` and `cli` config paths prepared by `pnpm run office:prepare`; compositions without them disable the row.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount the row `dsh-desktop-office` with `config.resources` and `config.cli` pointing at the prepared runtime (primary-runtime plus office-skills) and the packaged Node executable. The client module joins the Web roster through the bundle dependency.

## Dev Note

Vendored from upstream experimental packages and renamed to the @oristrat scope so the product composition can select them; the committed TypeScript sources remain the source plane.

## Model Experience

Indirectly, through the skill and tool seams: the Office template tools and bundled skills reach model requests only while a composition enables the optional Office row, and the seams own catalog and schema rendering.

#### KV Cache effect

No prefix change while the Office row stays disabled; enabling it shifts the prefix once, then the catalog and schemas are stable.

## Known Limitations and Deferred Work

- Template preparation (`prepare-templates.mjs`) still follows the upstream Electron-based office CLI; without it the template library stays empty and the general creation workflow remains available.
- The resources payload is installation-owned: profile paths and session cwd never anchor it.
