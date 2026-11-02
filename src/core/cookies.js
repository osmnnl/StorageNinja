// Cookie access for a tab. Keeps every attribute (hostOnly, sameSite, partitionKey, session)
// so copy → paste round-trips without changing the cookie.

export async function storeIdForTab(tabId) {
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find(s => (s.tabIds || []).includes(tabId));
    return store ? store.id : undefined;
}

// Widest domain to query; cookies are then filtered to the ones that apply to the host.
export function baseDomain(host) {
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return host;
    return host.split('.').slice(-2).join('.');
}

function bareDomain(domain) {
    return (domain || '').replace(/^\./, '');
}

export function appliesToHost(cookie, host) {
    const d = bareDomain(cookie.domain);
    if (cookie.hostOnly) return d === host;
    return host === d || host.endsWith('.' + d);
}

function cookieKey(c) {
    const pk = c.partitionKey ? c.partitionKey.topLevelSite || '' : '';
    return [c.name, c.domain, c.path, pk].join('|');
}

export function serializeCookie(c) {
    const out = {
        name: c.name,
        value: c.value,
        domain: c.domain,
        hostOnly: !!c.hostOnly,
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        sameSite: c.sameSite || 'unspecified',
        session: !!c.session
    };
    if (!c.session && c.expirationDate) out.expirationDate = c.expirationDate;
    if (c.partitionKey) out.partitionKey = c.partitionKey;
    return out;
}

async function getAllSafe(details) {
    try {
        return await chrome.cookies.getAll(details);
    } catch (_) {
        return [];
    }
}

export async function listCookies(tabId, url) {
    const { hostname: host } = new URL(url);
    const storeId = await storeIdForTab(tabId);
    const domain = baseDomain(host);
    // Unpartitioned and partitioned (CHIPS) cookies come from separate queries on some Chrome versions.
    const [plain, partitioned] = await Promise.all([
        getAllSafe({ domain, storeId }),
        getAllSafe({ domain, storeId, partitionKey: {} })
    ]);
    const map = new Map();
    for (const c of [...plain, ...partitioned]) {
        if (!appliesToHost(c, host)) continue;
        if (c.partitionKey && c.partitionKey.topLevelSite) {
            const top = c.partitionKey.topLevelSite.replace(/^https?:\/\//, '');
            if (top !== domain && !host.endsWith('.' + top) && host !== top) continue;
        }
        map.set(cookieKey(c), c);
    }
    return { storeId, cookies: [...map.values()].map(serializeCookie) };
}

function cookieUrl(domain, path, secure, protocol) {
    const scheme = secure ? 'https:' : (protocol || 'https:');
    return `${scheme}//${bareDomain(domain)}${path || '/'}`;
}

export async function removeCookie(cookie, storeId) {
    const details = {
        url: cookieUrl(cookie.domain, cookie.path, cookie.secure),
        name: cookie.name,
        storeId
    };
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    let removed = await chrome.cookies.remove(details);
    if (!removed && !cookie.secure) {
        details.url = cookieUrl(cookie.domain, cookie.path, false, 'http:');
        removed = await chrome.cookies.remove(details);
    }
    return !!removed;
}

// Accepts the v2 array format, the 1.x array format and the 1.x { name: { value, ... } } map.
export function normalizeCookieInput(data) {
    if (data && typeof data === 'object' && Array.isArray(data.cookies)) data = data.cookies;
    let items;
    if (Array.isArray(data)) {
        items = data;
    } else if (data && typeof data === 'object') {
        items = Object.entries(data).map(([name, v]) => (v && typeof v === 'object' ? { name, ...v } : { name, value: String(v) }));
    } else {
        throw new Error('Clipboard data is not in cookie format');
    }
    items = items.filter(c => c && typeof c === 'object' && typeof c.name === 'string' && c.name && 'value' in c);
    if (!items.length && (Array.isArray(data) ? data.length : Object.keys(data).length)) {
        throw new Error('Clipboard data is not in cookie format');
    }
    return items;
}

// Writes one cookie for `target` ({ host, protocol }). A cookie whose domain does not apply to the
// target host is moved onto it as a host-only cookie (e.g. prod → localhost).
export async function setCookie(input, storeId, target) {
    const host = target.host;
    let domain = bareDomain(input.domain);
    let hostOnly = input.hostOnly !== undefined ? !!input.hostOnly : !(input.domain || '').startsWith('.');
    let moved = false;
    if (!domain) {
        domain = host;
        hostOnly = true;
    }
    const applies = hostOnly ? domain === host : host === domain || host.endsWith('.' + domain);
    if (!applies) {
        domain = host;
        hostOnly = true;
        moved = true;
    }

    const sameSite = input.sameSite || 'unspecified';
    let secure = !!input.secure;
    if (sameSite === 'no_restriction' || input.partitionKey) secure = true;

    // A partitioned cookie's URL must be same-site with its top-level site, scheme included
    // (http://localhost vs https://localhost differ).
    let protocol = target.protocol;
    let urlSecure = secure;
    if (input.partitionKey && input.partitionKey.topLevelSite && !moved) {
        protocol = new URL(input.partitionKey.topLevelSite).protocol;
        urlSecure = protocol === 'https:';
    }

    const details = {
        url: cookieUrl(domain, input.path, urlSecure, protocol),
        name: input.name,
        value: String(input.value ?? ''),
        path: input.path || '/',
        secure,
        httpOnly: !!input.httpOnly,
        sameSite,
        storeId
    };
    if (!hostOnly) details.domain = '.' + domain;
    const exp = Number(input.expirationDate);
    if (!input.session && exp) {
        if (exp * 1000 < Date.now()) return { skipped: true, reason: 'expired' };
        details.expirationDate = exp;
    }
    if (input.partitionKey) {
        details.partitionKey = moved
            ? { topLevelSite: `https://${baseDomain(host)}` }
            : input.partitionKey;
    }

    const result = await chrome.cookies.set(details);
    if (!result) {
        const err = chrome.runtime.lastError;
        throw new Error(`Cookie '${input.name}' could not be set${err ? ': ' + err.message : ''}`);
    }
    return { moved };
}

export async function clearCookies(tabId, url) {
    const { storeId, cookies } = await listCookies(tabId, url);
    let count = 0;
    for (const c of cookies) {
        if (await removeCookie(c, storeId)) count++;
    }
    return { count };
}

export async function setCookies(tabId, info, data, mode = 'merge') {
    const items = normalizeCookieInput(data);
    if (mode === 'replace') await clearCookies(tabId, info.url);
    const storeId = await storeIdForTab(tabId);
    const summary = { count: 0, moved: 0, skipped: 0, errors: [] };
    for (const item of items) {
        try {
            const r = await setCookie(item, storeId, info);
            if (r.skipped) summary.skipped++;
            else {
                summary.count++;
                if (r.moved) summary.moved++;
            }
        } catch (e) {
            summary.errors.push(e.message);
        }
    }
    if (summary.errors.length && !summary.count) throw new Error(summary.errors[0]);
    return summary;
}

// Edits a cookie in place: removes the original when its identity (name/domain/path) changed.
export async function saveCookie(tabId, info, cookie, original) {
    const storeId = await storeIdForTab(tabId);
    const sameIdentity = original
        && original.name === cookie.name
        && (original.path || '/') === (cookie.path || '/')
        && bareDomain(original.domain) === bareDomain(cookie.domain || original.domain)
        && !!original.hostOnly === !!cookie.hostOnly;
    if (original && !sameIdentity) {
        await removeCookie(original, storeId);
    }
    return setCookie(cookie, storeId, info);
}

export async function deleteCookie(tabId, cookie) {
    const storeId = await storeIdForTab(tabId);
    const ok = await removeCookie(cookie, storeId);
    if (!ok) throw new Error(`Cookie '${cookie.name}' could not be deleted`);
    return true;
}
