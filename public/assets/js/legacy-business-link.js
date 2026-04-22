function buildLegacyLinkFunctionUrl(app, functionName) {
    const projectId = String(app?.options?.projectId || '').trim();
    if (!projectId) {
        throw new Error('missing-project-id');
    }

    return `https://us-central1-${projectId}.cloudfunctions.net/${functionName}`;
}

function getLinkCacheKey(uid) {
    return `citymart:legacy-business-link:${uid}`;
}

export async function linkLegacyBusinessesByEmail({ app, authUser, force = false } = {}) {
    const uid = String(authUser?.uid || '').trim();
    const email = String(authUser?.email || '').trim();

    if (!uid || !email) {
        return { ok: false, skipped: true, reason: 'missing-auth-context' };
    }

    const cacheKey = getLinkCacheKey(uid);
    if (!force) {
        try {
            if (sessionStorage.getItem(cacheKey) === 'done') {
                return { ok: true, skipped: true, reason: 'already-attempted' };
            }
        } catch (error) {
            console.warn('[legacy-link] No se pudo leer sessionStorage:', error);
        }
    }

    try {
        const token = await authUser.getIdToken();
        const response = await fetch(buildLegacyLinkFunctionUrl(app, 'linkLegacyBusinessesByEmail'), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || `http-${response.status}`);
        }

        try {
            sessionStorage.setItem(cacheKey, 'done');
        } catch (error) {
            console.warn('[legacy-link] No se pudo guardar sessionStorage:', error);
        }

        return payload;
    } catch (error) {
        console.warn('[legacy-link] No se pudo vincular negocios heredados:', error);
        return {
            ok: false,
            skipped: true,
            reason: error?.message || 'legacy-link-failed'
        };
    }
}
