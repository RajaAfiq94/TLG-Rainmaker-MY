// POST /api/newsletter
// Adds the newsletter opt-in to a contact who has just applied (doctors booked more than 3 months out).
// Only tags an EXISTING contact found by email, so this endpoint can't be used to sign up strangers.
// A GHL workflow triggered by the "newsletter-optin" tag should start the newsletter sequence.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

async function ghl(path, init = {}) {
  const res = await fetch(GHL_BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GHL_PRIVATE_TOKEN}`,
      Version: GHL_VERSION,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, json };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  let originHost = '';
  try { originHost = origin ? new URL(origin).host : ''; } catch (_) { originHost = 'invalid'; }
  if (origin && originHost !== host) return res.status(403).json({ ok: false, error: 'forbidden' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (_) { return res.status(400).json({ ok: false, error: 'invalid' }); }
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 160) : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.newsletter_consent !== 'yes') {
    return res.status(400).json({ ok: false, error: 'invalid' });
  }

  const locationId = process.env.GHL_LOCATION_ID;
  if (!process.env.GHL_PRIVATE_TOKEN || !locationId) return res.status(500).json({ ok: false, error: 'not_configured' });

  try {
    const found = await ghl(`/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&email=${encodeURIComponent(email)}`);
    const contactId = found.ok && found.json && found.json.contact && found.json.contact.id;
    if (!contactId) return res.status(404).json({ ok: false, error: 'not_found' });

    const consentAt = new Date().toISOString();
    const tagRes = await ghl(`/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags: ['newsletter-optin', 'pdpa-consent-newsletter'] }),
    });
    if (!tagRes.ok) {
      console.error('GHL newsletter tag failed', tagRes.status);
      return res.status(502).json({ ok: false, error: 'crm_unavailable' });
    }
    const noteRes = await ghl(`/contacts/${contactId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: `Newsletter opt-in (AI and marketing for clinics), email. PDPA consent given: ${consentAt}` }),
    });
    if (!noteRes.ok) console.error('GHL newsletter note failed', noteRes.status);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Newsletter handler error', err && err.message);
    return res.status(502).json({ ok: false, error: 'crm_unavailable' });
  }
};
