const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function createQueryBuilder(table) {
  let filters = [];
  let order = null;
  let inFilter = null;
  let limit = null;

  const api = {
    select(columns = '*', options = {}) {
      api._select = columns;
      api._head = !!options.head;
      api._count = options.count || null;
      return api;
    },
    insert(payload) { api._method = 'POST'; api._payload = payload; return api; },
    delete() { api._method = 'DELETE'; return api; },
    eq(col, val) { filters.push(`${col}=eq.${encodeURIComponent(val)}`); return api; },
    in(col, vals) { inFilter = `${col}=in.(${vals.map((v) => encodeURIComponent(v)).join(',')})`; return api; },
    order(col, opts = {}) { order = `${col}.${opts.ascending === false ? 'desc' : 'asc'}`; return api; },
    limit(v) { limit = Number(v); return api; },
    async single() { const res = await exec(true); if (res.error) return res; return { data: Array.isArray(res.data) ? res.data[0] : res.data, error: null }; },
    async maybeSingle() { return api.single(); },
    then(resolve, reject) { return exec(false).then(resolve, reject); }
  };

  async function exec(forceSelectAfterMutation) {
    if (!supabaseUrl || !supabaseServiceRoleKey) return { data: null, error: new Error('Missing Supabase env') };

    const method = api._method || 'GET';
    const query = [];
    if (api._select) query.push(`select=${encodeURIComponent(api._select)}`);
    if (api._count) query.push('count=exact');
    query.push(...filters);
    if (inFilter) query.push(inFilter);
    if (order) query.push(`order=${order}`);
    if (limit) query.push(`limit=${limit}`);

    const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}${query.length ? `?${query.join('&')}` : ''}`;
    const headers = {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: forceSelectAfterMutation || method !== 'GET' ? 'return=representation' : 'return=minimal'
    };

    const response = await fetch(url, {
      method,
      headers,
      body: api._payload !== undefined ? JSON.stringify(api._payload) : undefined
    });

    if (!response.ok) {
      let payload;
      try { payload = await response.json(); } catch (_) { payload = { message: response.statusText }; }
      return { data: null, error: new Error(payload.message || payload.error || `Supabase ${response.status}`) };
    }

    if (api._head) {
      const countHeader = response.headers.get('content-range');
      const count = countHeader ? Number(countHeader.split('/')[1] || 0) : 0;
      return { data: null, error: null, count };
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    return { data, error: null };
  }

  return api;
}

const supabase = {
  from(table) {
    return createQueryBuilder(table);
  }
};

module.exports = { supabase };
