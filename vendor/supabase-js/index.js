class QueryBuilder {
  constructor(baseUrl, apiKey, table) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.table = table;
    this._method = 'GET';
    this._params = new URLSearchParams();
    this._headers = {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    this._body = undefined;
    this._singleMode = null;
    this._throwOnNoRows = false;
  }

  select(columns = '*', options = {}) {
    this._params.set('select', columns);
    if (options.head) this._method = 'HEAD';
    if (options.count) this._headers.Prefer = `count=${options.count}`;
    return this;
  }

  eq(column, value) {
    this._params.append(column, `eq.${value}`);
    return this;
  }

  or(expression) {
    this._params.set('or', `(${expression})`);
    return this;
  }

  order(column, { ascending = true } = {}) {
    this._params.set('order', `${column}.${ascending ? 'asc' : 'desc'}`);
    return this;
  }

  maybeSingle() {
    this._singleMode = 'maybe';
    return this;
  }

  single() {
    this._singleMode = 'single';
    this._throwOnNoRows = true;
    return this;
  }

  update(payload) {
    this._method = 'PATCH';
    this._body = payload;
    return this;
  }

  upsert(payload, options = {}) {
    this._method = 'POST';
    this._body = payload;
    const prefs = ['resolution=merge-duplicates'];
    if (options.onConflict) this._params.set('on_conflict', options.onConflict);
    this._headers.Prefer = prefs.join(',');
    return this;
  }

  async _execute() {
    const query = this._params.toString();
    const url = `${this.baseUrl}/rest/v1/${this.table}${query ? `?${query}` : ''}`;
    const response = await fetch(url, {
      method: this._method,
      headers: this._headers,
      body: this._body !== undefined ? JSON.stringify(this._body) : undefined
    });

    if (this._method === 'HEAD') {
      const contentRange = response.headers.get('content-range') || '';
      const count = Number((contentRange.split('/')[1] || '0'));
      return response.ok ? { data: null, error: null, count } : { data: null, error: new Error(await response.text()), count: null };
    }

    const text = await response.text();
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
    }

    if (!response.ok) {
      return { data: null, error: new Error(parsed?.message || parsed?.error || text || `Supabase error ${response.status}`), count: null };
    }

    let data = parsed;
    if (this._singleMode) {
      if (Array.isArray(parsed)) {
        if (!parsed.length) data = null;
        else data = parsed[0];
      }
      if (this._throwOnNoRows && data == null) {
        return { data: null, error: new Error('No rows found'), count: null };
      }
    }

    return { data, error: null, count: null };
  }

  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }
}

function createClient(url, key) {
  const baseUrl = String(url || '').replace(/\/$/, '');
  return {
    from(table) {
      return new QueryBuilder(baseUrl, key, table);
    }
  };
}

module.exports = { createClient };
