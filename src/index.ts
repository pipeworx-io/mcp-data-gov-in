interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * India Open Government Data (OGD) Platform MCP — data.gov.in
 *
 * BYO key: requires a free data.gov.in API key. Register at
 * https://data.gov.in (My Account → "Generate API Key"). The key is passed
 * via the _apiKey parameter and sent to the API as the ?api-key= query param.
 *
 * Tools:
 * - resource_data: fetch records from any OGD resource by resourceId, with
 *   optional limit/offset, per-field `filters`, `fields` projection, and `sort`.
 * - resource_meta: fetch a resource's schema (title, org, sector, field list)
 *   so an agent can discover the filterable/sortable field ids before querying.
 *
 * India OGD quirk: a wrong resourceId returns HTTP 200 with
 * {"status":"error","message":"Meta not found","records":[]} — NOT an HTTP
 * error. A bad/unauthorised key returns HTTP 403 {"error":"Key not authorised"}.
 * We surface the API's own status/message whenever `records` comes back empty
 * so the caller can tell "no matching rows" from "wrong resourceId".
 */


const BASE = 'https://api.data.gov.in/resource';
const UA = 'pipeworx-mcp-data-gov-in/1.0 (+https://pipeworx.io)';

// ── Helpers ───────────────────────────────────────────────────────────

function extractKey(args: Record<string, unknown>): string {
  const key = args._apiKey as string;
  delete args._apiKey;
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error(
      'data.gov.in API key required. Register free at https://data.gov.in (My Account → "Generate API Key") and pass it via _apiKey.',
    );
  }
  return key.trim();
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v.trim();
}

/** Strip a leading/trailing slash and any accidental full URL the caller pasted. */
function normalizeResourceId(raw: string): string {
  let id = raw.trim();
  const m = id.match(/\/resource\/([^/?#]+)/);
  if (m) id = m[1];
  return id.replace(/^\/+|\/+$/g, '');
}

async function ogdGet(resourceId: string, apiKey: string, params: URLSearchParams): Promise<Record<string, unknown>> {
  const url = `${BASE}/${encodeURIComponent(resourceId)}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`data.gov.in: ${res.status} ${body}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

// ── Tool definitions ──────────────────────────────────────────────────

const tools: McpToolExport['tools'] = [
  {
    name: 'resource_data',
    description:
      'Fetch records from any India Open Government Data (data.gov.in) resource by its resourceId. ' +
      'Supports pagination, per-field filtering, field projection, and sorting. ' +
      'The resourceId is the UUID shown on a dataset\'s page on data.gov.in (and in its API URL, e.g. ' +
      'api.data.gov.in/resource/<resourceId>). Example resourceId 9ef84268-d588-465a-a308-a864a43d0070 ' +
      'is "Current Daily Price of Various Commodities from Various Markets (Mandi)" with fields like ' +
      'state, district, market, commodity, variety, grade, arrival_date, min_price, max_price, modal_price. ' +
      'Use resource_meta first if you do not know a resource\'s field ids.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: { type: 'string', description: 'data.gov.in API key' },
        resourceId: {
          type: 'string',
          description: 'The dataset resource UUID from its data.gov.in page (e.g. "9ef84268-d588-465a-a308-a864a43d0070").',
        },
        limit: {
          type: 'number',
          description: 'Max records to return (default 10). The API caps page size; use offset to page.',
        },
        offset: {
          type: 'number',
          description: 'Records to skip for pagination (default 0).',
        },
        filters: {
          type: 'object',
          description:
            'Per-field exact-match filters, mapped to filters[field]=value query params. ' +
            'Field ids come from the resource schema (see resource_meta), e.g. {"state":"Punjab","commodity":"Apple"}.',
          additionalProperties: { type: 'string' },
        },
        fields: {
          type: 'string',
          description: 'Optional comma-separated list of field ids to return (projection), e.g. "state,commodity,modal_price".',
        },
        sort: {
          type: 'object',
          description:
            'Optional sort spec mapped to sort[field]=direction, where direction is "asc" or "desc", ' +
            'e.g. {"modal_price":"desc"}.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['_apiKey', 'resourceId'],
    },
  },
  {
    name: 'resource_meta',
    description:
      'Fetch the schema/metadata for a data.gov.in resource by resourceId: title, publishing org, sector, ' +
      'last-updated time, and the list of fields (each with name, id, type). Use this to discover the ' +
      'filterable/sortable field ids before calling resource_data. The resourceId is the UUID from the ' +
      'dataset\'s page on data.gov.in.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: { type: 'string', description: 'data.gov.in API key' },
        resourceId: {
          type: 'string',
          description: 'The dataset resource UUID from its data.gov.in page (e.g. "9ef84268-d588-465a-a308-a864a43d0070").',
        },
      },
      required: ['_apiKey', 'resourceId'],
    },
  },
];

// ── callTool dispatcher ───────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const key = extractKey(args);

  switch (name) {
    case 'resource_data':
      return resourceData(key, args);
    case 'resource_meta':
      return resourceMeta(key, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Tool implementations ───────────────────────────────────────────────

async function resourceData(apiKey: string, args: Record<string, unknown>) {
  const resourceId = normalizeResourceId(reqStr(args, 'resourceId', '"9ef84268-d588-465a-a308-a864a43d0070"'));

  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10;
  const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;

  const params = new URLSearchParams();
  params.set('api-key', apiKey);
  params.set('format', 'json');
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  if (typeof args.fields === 'string' && args.fields.trim()) {
    params.set('fields', args.fields.trim());
  }

  if (args.filters && typeof args.filters === 'object' && !Array.isArray(args.filters)) {
    for (const [field, value] of Object.entries(args.filters as Record<string, unknown>)) {
      if (value == null) continue;
      params.set(`filters[${field}]`, encodeURIComponent(String(value)));
    }
  }

  if (args.sort && typeof args.sort === 'object' && !Array.isArray(args.sort)) {
    for (const [field, dir] of Object.entries(args.sort as Record<string, unknown>)) {
      if (dir == null) continue;
      const d = String(dir).toLowerCase() === 'asc' ? 'asc' : 'desc';
      params.set(`sort[${field}]`, d);
    }
  }

  const data = await ogdGet(resourceId, apiKey, params);

  const records = Array.isArray(data.records) ? (data.records as unknown[]) : [];
  const status = (data.status as string) ?? null;
  const message = (data.message as string) ?? null;
  const total = (data.total as number) ?? null;

  // OGD quirk: wrong resourceId => HTTP 200 with status:"error" + empty records.
  // Always surface the API's status/message so empty results are unambiguous.
  if (records.length === 0) {
    return {
      found: false,
      resourceId,
      status,
      message,
      total,
      count: 0,
      records: [],
      hint:
        status === 'error'
          ? `data.gov.in returned an error for resourceId "${resourceId}" (message: ${message ?? 'unknown'}). Verify the resourceId from the dataset's page on data.gov.in.`
          : 'No records matched. If you used filters, check the field ids/values via resource_meta; field ids are case-sensitive and filter values are matched exactly.',
    };
  }

  return {
    found: true,
    resourceId,
    status,
    message,
    total,
    count: records.length,
    offset,
    limit,
    records,
  };
}

async function resourceMeta(apiKey: string, args: Record<string, unknown>) {
  const resourceId = normalizeResourceId(reqStr(args, 'resourceId', '"9ef84268-d588-465a-a308-a864a43d0070"'));

  // limit=1 keeps the payload small; we only want the meta envelope + field list.
  const params = new URLSearchParams();
  params.set('api-key', apiKey);
  params.set('format', 'json');
  params.set('limit', '1');

  const data = await ogdGet(resourceId, apiKey, params);

  const status = (data.status as string) ?? null;
  const message = (data.message as string) ?? null;
  const fields = Array.isArray(data.field) ? (data.field as unknown[]) : [];

  if (status === 'error' || (fields.length === 0 && !Array.isArray(data.records))) {
    return {
      found: false,
      resourceId,
      status,
      message,
      hint: `data.gov.in could not resolve resourceId "${resourceId}" (message: ${message ?? 'unknown'}). Verify the UUID from the dataset's page on data.gov.in.`,
    };
  }

  return {
    found: true,
    resourceId,
    status,
    message,
    title: data.title ?? null,
    org: data.org ?? null,
    org_type: data.org_type ?? null,
    sector: data.sector ?? null,
    source: data.source ?? null,
    updated_date: data.updated_date ?? null,
    created_date: data.created_date ?? null,
    total: data.total ?? null,
    fields, // each: { name, id, type } — use `id` as the filter/sort/fields key
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
