// Access token detection. Pure functions: used by the service worker and the UI.

const JWT_RE = /^(?:Bearer\s+)?(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/;
const OPAQUE_RE = /^(?:Bearer\s+)?([A-Za-z0-9._~+/=-]{16,})$/;
const MAX_DEPTH = 5;

function base64UrlDecode(part) {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

export function decodeJwt(token) {
    const m = JWT_RE.exec(String(token || '').trim());
    if (!m) return null;
    const [header, payload] = m[1].split('.');
    try {
        return { header: JSON.parse(base64UrlDecode(header)), payload: JSON.parse(base64UrlDecode(payload)) };
    } catch (_) {
        return null;
    }
}

export function stripBearer(token) {
    return String(token || '').trim().replace(/^Bearer\s+/i, '');
}

export function tokenMeta(token, now = Date.now()) {
    const jwt = decodeJwt(token);
    if (!jwt) return { jwt: false };
    const p = jwt.payload || {};
    const meta = { jwt: true, header: jwt.header, payload: p };
    if (typeof p.exp === 'number') {
        meta.exp = p.exp;
        meta.expiresInSec = Math.round(p.exp - now / 1000);
        meta.expired = meta.expiresInSec <= 0;
    }
    meta.subject = p.email || p.preferred_username || p.upn || p.unique_name || p.name || p.sub || '';
    return meta;
}

function keyScore(name) {
    const k = String(name || '').toLowerCase();
    let s = 0;
    if (/refresh/.test(k)) s -= 80;
    if (/access[_-]?token|accesstoken/.test(k)) s += 45;
    else if (/id[_-]?token|idtoken/.test(k)) s += 20;
    else if (/^(token|jwt|bearer|authorization|auth|authtoken|auth[_-]token)$/.test(k)) s += 30;
    else if (/token|jwt|bearer|auth/.test(k)) s += 15;
    return s;
}

function scoreCandidate(c, now) {
    let s = keyScore(c.field) + (c.field !== c.key ? keyScore(c.key) / 3 : 0);
    if (c.jwt) {
        s += 40;
        const meta = tokenMeta(c.token, now);
        if (meta.expired) s -= 25;
        else if (meta.exp) s += 10;
        const typ = String((meta.payload && (meta.payload.typ || meta.payload.token_type || meta.payload.token_use)) || '').toLowerCase();
        if (typ.includes('refresh')) s -= 80;
        if (typ === 'access' || typ === 'bearer') s += 15;
        if (typ === 'id') s -= 5;
    }
    if (c.source !== 'cookies') s += 3;
    return Math.round(s);
}

function looksLikeJson(str) {
    const t = str.trim();
    return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function walk(value, ctx, path, field, out, depth) {
    if (depth > MAX_DEPTH || value === null || value === undefined) return;
    if (typeof value === 'string') {
        const str = value.trim();
        const jwt = JWT_RE.exec(str);
        if (jwt) {
            out.push({ ...ctx, path, field, token: jwt[1], jwt: true });
            return;
        }
        if (looksLikeJson(str)) {
            try {
                walk(JSON.parse(str), ctx, path, field, out, depth + 1);
                return;
            } catch (_) { /* not JSON */ }
        }
        // Opaque tokens are only trusted when the field name says so.
        if (keyScore(field) > 0 && !/\s/.test(str.replace(/^Bearer\s+/i, ''))) {
            const m = OPAQUE_RE.exec(str);
            if (m) out.push({ ...ctx, path, field, token: m[1], jwt: false });
        }
        return;
    }
    if (typeof value !== 'object') return;
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    for (const [k, v] of entries.slice(0, 200)) {
        walk(v, ctx, [...path, k], Array.isArray(value) ? field : k, out, depth + 1);
    }
}

// sources: { localStorage: {k: v}, sessionStorage: {k: v}, cookies: [{name, value}] }
export function findTokens(sources, now = Date.now()) {
    const out = [];
    for (const source of ['localStorage', 'sessionStorage']) {
        for (const [key, value] of Object.entries(sources[source] || {})) {
            walk(value, { source, key }, [], key, out, 0);
        }
    }
    for (const c of sources.cookies || []) {
        let value = c.value;
        try {
            value = decodeURIComponent(value);
        } catch (_) { /* keep raw */ }
        walk(value, { source: 'cookies', key: c.name }, [], c.name, out, 0);
    }
    const seen = new Set();
    return out
        .map(c => ({ ...c, score: scoreCandidate(c, now) }))
        .sort((a, b) => b.score - a.score)
        .filter(c => {
            if (seen.has(c.token)) return false;
            seen.add(c.token);
            return true;
        });
}

export function sameSource(a, b) {
    return !!a && !!b && a.source === b.source && a.key === b.key && (a.path || []).join('\u0000') === (b.path || []).join('\u0000');
}

export function pickToken(candidates, pin) {
    if (pin) {
        const pinned = candidates.find(c => sameSource(c, pin));
        if (pinned) return pinned;
    }
    return candidates.find(c => c.score > 0) || null;
}

export function describeSource(c) {
    const store = { localStorage: 'localStorage', sessionStorage: 'sessionStorage', cookies: 'cookie' }[c.source] || c.source;
    return [store, c.key, ...(c.path || [])].join(' › ');
}
