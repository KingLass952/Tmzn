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
- `working_hours`: sender's local hours as `HH:MM-HH:MM`; an end time at or before the start is treated as overnight

Optional inputs:

- `target_working_hours`: client's local hours in the same format; defaults to `working_hours`
- `date`: sender-local calendar date as `YYYY-MM-DD`; defaults to today's date in `source_timezone`
- `min_overlap_minutes`: minimum overlap to report; defaults to `0`

The result includes every qualifying overlap across the requested and neighboring target dates in `overlaps`. The legacy `overlap` field contains the longest one, or `null` when there is no overlap. Each result includes sender/client local strings and the UTC interval. Nonexistent local times on the requested date are errors; nonexistent times on neighboring target dates are skipped.

### `format_pitch_times`

Pass `slots` as local `YYYY-MM-DD HH:MM` strings and provide `target_timezone`. `source_timezone` defaults to `Africa/Johannesburg`; `duration_minutes` defaults to `30`; and `hour_format` defaults to `12` (`12` or `24`). The response gives client-ready start/end times with weekday and timezone abbreviations, with `CAT` used for Johannesburg.

## Run

```bash
npm run inspect
```

This builds the server and opens MCP Inspector. In VS Code, `.vscode/mcp.json` launches the built server using the workspace-relative path.