# Moo Dev Tool

> Internal Chrome extension for frontend / backend bug reporting and reproduction at moo.

Chinese docs are the source of truth — see [README.md](./README.md), [docs/ZENTAO_SETUP.md](./docs/ZENTAO_SETUP.md), [HANDOFF.md](./HANDOFF.md), [CHANGELOG.md](./CHANGELOG.md).

## What it does

A floating ball appears on the pages you configure → click to capture screenshot, annotate, attach recent network requests / console errors / a 30s screen recording → submit to Zentao (or your own webhook server).

For the team, "reporting a bug" goes from "send a screenshot + reproduce verbally" to "click → annotate → submit", with everything the backend needs already attached.

## Quick start

1. Download the latest zip from [Gitee releases](https://gitee.com/charsen/moo-chrome-dev-tool/releases) (always grab the topmost entry — that's `latest`).
2. Unzip, open `chrome://extensions`, enable Developer mode, click "Load unpacked", select the unzipped folder.
3. Click the Moo toolbar icon and enable the "report server requests" permission toggle in the popup — **without it the floating ball never shows up**. Enable the "recording" toggle too if you want screen recording.
4. Open DevTools on any page → "Moo" panel → "Environment" tab → fill in your Zentao base URL + account + project ID.

Detailed setup (with Zentao quirks): [docs/ZENTAO_SETUP.md](./docs/ZENTAO_SETUP.md) (Chinese).

## Repo language

This project's primary docs are in Chinese (team is Chinese-speaking). Code comments, commit messages, and CHANGELOG are Chinese as well. This README.en.md exists only to give non-Chinese readers an entry point.
