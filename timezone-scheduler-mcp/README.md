# tmzn-scheduler-mcp

A TypeScript MCP server for timezone-aware scheduling. The default sender timezone is `Africa/Johannesburg` (UTC+2), displayed as `CAT` in client-facing text. South Africa's standard abbreviation is technically SAST; both labels refer to UTC+2 here.

## Setup

```bash
npm install
npm run build
npm test
```

## Tools

### `convert_window`

Required inputs:

- `source_timezone`: sender IANA timezone, for example `Africa/Johannesburg`
- `target_timezone`: client IANA timezone, for example `America/Chicago`
- `working_hours`: sender's local hours as `HH:MM-HH:MM`

Optional inputs:

- `target_working_hours`: client's local hours in the same format
- `date`: calendar date as `YYYY-MM-DD`; defaults to today's UTC date
- `min_overlap_minutes`: minimum overlap to report; defaults to `0`

The result includes the overlap in both zones and its UTC interval as JSON in the text response. When target hours are omitted, the sender's full window is shown in the target timezone.

### `format_pitch_times`

Pass `slots` as local `YYYY-MM-DD HH:MM` strings and provide `target_timezone`. `source_timezone` defaults to `Africa/Johannesburg`; `duration_minutes` defaults to `30`; and `hour_format` defaults to `12` (`12` or `24`). The response gives client-ready start/end times with the sender's local time alongside each one.

## Run

```bash
npm run inspect
```

This builds the server and opens MCP Inspector. In VS Code, `.vscode/mcp.json` launches the built server from its absolute path. Update that path if the workspace is located elsewhere.