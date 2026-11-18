# AuraChat

Self-hosted, claude.ai-style chat UI that works with **your own API keys**.

- Anthropic models (default **Claude Sonnet 4.5**), hundreds more through **OpenRouter**, and any **OmniRoute / OpenAI- or Anthropic-compatible gateway**
- Set keys and gateway URL from the website itself (Settings → API & Providers), with a Test button
- claude.ai-style layout: sidebar with starred/recent chats and search, artifacts panel (live HTML/SVG preview), model/skill/thinking menus, dark mode
- Streaming replies, Markdown + code highlighting, chat history, retry, stop
- **Skills** (instruction packs you toggle on/off, create your own)
- **Memory** skill **on by default**: the model saves durable facts about you and recalls them in every chat
- Password login, SQLite storage, mobile friendly, dark mode

## One-command install (VPS, as root)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ominusfgas7-bit/aurachat/main/install.sh)
```

It installs Node, clones this repo to `/opt/aurachat`, asks for your password + API keys, and sets up a systemd service.
Re-run the same command to update (your `.env` and chats are kept).

Non-interactive:

```bash
ANTHROPIC_API_KEY=sk-ant-xxx OPENROUTER_API_KEY=sk-or-xxx ADMIN_PASSWORD=secret \
  bash <(curl -fsSL https://raw.githubusercontent.com/ominusfgas7-bit/aurachat/main/install.sh)
```

## Config (`/opt/aurachat/.env`)

| Var | Meaning |
|---|---|
| `ADMIN_PASSWORD` | Login password (required) |
| `ANTHROPIC_API_KEY` | Enables Claude models |
| `OPENROUTER_API_KEY` | Enables all OpenRouter models |
| `PORT` | Default 3000 |
| `DEFAULT_MODEL` | e.g. `anthropic:claude-sonnet-4-5` |

After editing: `systemctl restart aurachat`. Logs: `journalctl -u aurachat -f`.

## HTTPS

Put it behind a Cloudflare Tunnel or Caddy. Sessions use a Secure cookie automatically when the proxy sends `X-Forwarded-Proto: https`.

## Run locally

```bash
npm install && cp .env.example .env   # edit .env
npm start
```

## Connectors (GitHub / MCP)

Settings → Connectors → **+ GitHub**, paste a GitHub token (scope `repo`), Save. Chats can then read, search, create and push files in your repos
(toggle per chat in the **+** menu). Any HTTP MCP server URL works under **+ Custom MCP server**. Use "Only tools containing…" to keep the tool list short,
and **Read-only** to block writes. Needs a model that supports tool calling.

## Files

When a reply contains code files, the code is hidden behind cards (View / Copy / Download) and a **Download all (.zip)** card is added.
