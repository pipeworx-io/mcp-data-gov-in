# mcp-data-gov-in

India Open Government Data (OGD) Platform MCP — data.gov.in

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `resource_data` | Fetch records from any India Open Government Data (data.gov.in) resource by its resourceId. Supports pagination, per-field filtering, field projection, and sorting. The resourceId is the UUID shown on a dataset's page on data.gov.in (and in its API URL, e.g. api.data.gov.in/resource/<resourceId>). Example resourceId 9ef84268-d588-465a-a308-a864a43d0070 is "Current Daily Price of Various Commodities from Various Markets (Mandi)" with fields like state, district, market, commodity, variety, grade, arrival_date, min_price, max_price, modal_price. Use resource_meta first if you do not know a resource's field ids. |
| `resource_meta` | Fetch the schema/metadata for a data.gov.in resource by resourceId: title, publishing org, sector, last-updated time, and the list of fields (each with name, id, type). Use this to discover the filterable/sortable field ids before calling resource_data. The resourceId is the UUID from the dataset's page on data.gov.in. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "data-gov-in": {
      "url": "https://gateway.pipeworx.io/data-gov-in/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/data-gov-in/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Data Gov In data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/data_gov_in_resource_data \
  -H 'Content-Type: application/json' \
  -d '{"resourceId":"9ef84268-d588-465a-a308-a864a43d0070","limit":10,"offset":0}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/data_gov_in_resource_data`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.
