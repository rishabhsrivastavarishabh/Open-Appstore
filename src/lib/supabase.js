function hasServiceRole(env) {
  const k = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k || k === env.SUPABASE_ANON_KEY) return false;
  try {
    const payload = JSON.parse(atob(k.split(".")[1]));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}
function serviceKey(env) {
  return hasServiceRole(env) ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
}
function baseHeaders(env, token) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || env.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}
function adminHeaders(env) {
  const key = serviceKey(env);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}
async function sbSelect(env, table, query, token, opts) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const headers = baseHeaders(env, token);
  if (opts?.count) headers.Prefer = "count=exact";
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return { data: null, error: json?.message || `Request failed (${res.status})`, status: res.status };
    }
    // PostgREST reports the unpaginated row count as "0-24/312" when asked.
    let count = null;
    const range = res.headers.get("content-range");
    if (range) {
      const total = range.split("/")[1];
      if (total && total !== "*") count = Number(total);
    }
    return { data: json, error: null, status: res.status, count };
  } catch (e) {
    return { data: null, error: e?.message || "Network error", status: 500 };
  }
}
/**
 * Like sbSelect, but with the service-role key so Row Level Security is
 * bypassed. Only for callers that have ALREADY established the tenant boundary
 * themselves — e.g. the /api/v1 developer API, which authenticates a `dev_…`
 * key and then scopes every query to that developer's own `developer_id`.
 *
 * This is required rather than merely convenient: RLS on `apps` exposes only
 * `status = 'published'` rows to the anon key, so a developer reading back
 * their own *draft* through an anon-key select gets an empty result.
 *
 * Never call this with a filter derived from unvalidated user input alone.
 */
async function sbAdminSelect(env, table, query, opts) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const headers = adminHeaders(env);
  if (opts?.count) headers.Prefer = "count=exact";
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return { data: null, error: json?.message || `Request failed (${res.status})`, status: res.status };
    }
    let count = null;
    const range = res.headers.get("content-range");
    if (range) {
      const total = range.split("/")[1];
      if (total && total !== "*") count = Number(total);
    }
    return { data: json, error: null, status: res.status, count };
  } catch (e) {
    return { data: null, error: e?.message || "Network error", status: 500 };
  }
}
async function sbWrite(env, table, method, body, query = "", token) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { ...baseHeaders(env, token), Prefer: "return=representation" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return { data: null, error: json?.message || json?.hint || `Request failed (${res.status})`, status: res.status };
    }
    return { data: json, error: null, status: res.status };
  } catch (e) {
    return { data: null, error: e?.message || "Network error", status: 500 };
  }
}
async function sbAdminWrite(env, table, method, body, query = "") {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { ...adminHeaders(env), Prefer: "return=representation" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return {
        data: null,
        error: json?.message || json?.hint || `Request failed (${res.status})`,
        status: res.status
      };
    }
    return { data: json, error: null, status: res.status };
  } catch (e) {
    return { data: null, error: e?.message || "Network error", status: 500 };
  }
}
async function sbAuth(env, path, init = {}) {
  const url = `${env.SUPABASE_URL}/auth/v1/${path.replace(/^\//, "")}`;
  try {
    const res = await fetch(url, {
      method: init.method || "GET",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        ...init.token ? { Authorization: `Bearer ${init.token}` } : {}
      },
      body: init.body === void 0 ? void 0 : JSON.stringify(init.body)
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return {
        data: null,
        error: json?.msg || json?.error_description || json?.message || `Auth failed (${res.status})`,
        status: res.status
      };
    }
    return { data: json, error: null, status: res.status };
  } catch (e) {
    return { data: null, error: e?.message || "Network error", status: 500 };
  }
}
function bearer(header) {
  if (!header) return void 0;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : void 0;
}
export {
  bearer,
  hasServiceRole,
  sbAdminSelect,
  sbAdminWrite,
  sbAuth,
  sbSelect,
  sbWrite,
  serviceKey
};
