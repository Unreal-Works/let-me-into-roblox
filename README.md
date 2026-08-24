# let-me-into-roblox

Small utilities for finding a Roblox cookie and creating Roblox Open Cloud API keys.

## Installation

```bash
npm install let-me-into-roblox
```

## Usage

```js
import { createApiKey, getRoblosecurity } from "let-me-into-roblox";

const roblosecurity = getRoblosecurity();

if (!roblosecurity) {
  throw new Error("Could not find a Roblox authentication cookie");
}

const context = await createApiKey({
  roblosecurity,
  name: "my-api-key",
  description: "API key for my application",
  allowedCidrs: ["203.0.113.10/32"],
});

console.log(context.apiKey);
```

## API

### `getRoblosecurity()`

Returns the `.ROBLOSECURITY` cookie, or `undefined` when it cannot be found. It checks:

1. The `ROBLOSECURITY` environment variable.
2. An authenticated Roblox Studio installation on Windows or macOS.

### `createApiKey(options)`

Creates a Roblox Open Cloud API key and returns an object containing `id`, `userId`, `apiKey`, and `roblosecurity`.

The required option is `roblosecurity`. Optional options include `name`, `description`, `isEnabled`, `allowedCidrs`, `scopes`, and `url`. The URL defaults to Roblox's Open Cloud API key endpoint.

**When `allowedCidrs` or `scopes` are omitted, the library uses broad defaults.** Set both explicitly for production use and grant only the permissions your application needs.

## Supported Platforms

- Windows
- macOS
- Linux (WSL only)

## Development

```bash
bun install
bun test
bun run build
```
