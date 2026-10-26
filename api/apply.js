// POST /api/apply
// Receives the founding-seat application and creates or updates the contact in GoHighLevel (API v2).
// Needs two Vercel environment variables: GHL_PRIVATE_TOKEN (Private Integration token) and GHL_LOCATION_ID.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// Custom field keys looked up in GHL. Create these as contact custom fields to store each answer in its own field.
// Any that don't exist are skipped; every answer is also written to a contact note either way.
const FIELD_KEYS = {
  profession: 'contact.profession',
  role: 'contact.clinic_role',
  booked: 'contact.booked_ahead',
  patients_per_day: 'contact.patients_per_day',
  sources: 'contact.new_patient_sources',
  tried: 'contact.marketing_tried',
  change_12_months: 'contact.second_front_door_change',
  ready: 'contact.ready_to_start',
  consent_at: 'contact.pdpa_consent_at',
};

const ALLOWED = {
  profession: ['Doctor', 'Dentist'],
  role: ['I own the clinic', "I don't own it, but I decide its marketing", 'A healthcare group decides the marketing'],
  booked: ['Same week', '1 to 4 weeks', '1 to 3 months', 'More than 3 months'],
  sources: ['Referrals', 'Insurance panels', 'Google search', 'Walk-ins', 'Social media', 'Other'],
  ready: ['Yes', 'Yes, after I discuss it with a partner', 'Not right now'],
};

// Every new application becomes an open opportunity in this pipeline, at this stage (matched by name).
const PIPELINE_NAME = 'TLG Rainmaker MY';
const STAGE_NAME = 'Lead';
const VALUE_BY_ROUTE = { review: 12500, 'not-now': 12500, 'ra-pack': 5750 }; // founding prices, MYR

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function route(data) {
  if (data.role === 'A healthcare group decides the marketing') return 'ra-pack';
  if (data.booked === 'More than 3 months') return 'not-now';
  return 'review';
}

function validate(body) {
  const d = {
    name: clean(body.name, 120),
    email: clean(body.email, 160).toLowerCase(),
    whatsapp: clean(body.whatsapp, 40),
    clinic: clean(body.clinic, 160),
    profession: clean(body.profession, 40),
    role: clean(body.role, 80),
    booked: clean(body.booked, 40),
    patients_per_day: clean(String(body.patients_per_day ?? ''), 6),
    sources: (Array.isArray(body.sources) ? body.sources : [body.sources]).filter((s) => ALLOWED.sources.includes(s)),
    tried: clean(body.tried, 2000),
    change_12_months: clean(body.change_12_months, 2000),
    ready: clean(body.ready, 60),
    consent: body.consent === 'yes',
  };
  const errors = [];
  if (!d.name) errors.push('name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.push('email');
  if (!/^[+\d][\d\s-]{6,}$/.test(d.whatsapp)) errors.push('whatsapp');
  if (!d.clinic) errors.push('clinic');
  for (const k of ['profession', 'role', 'booked', 'ready']) if (!ALLOWED[k].includes(d[k])) errors.push(k);
  if (!/^\d{1,5}$/.test(d.patients_per_day)) errors.push('patients_per_day');
  if (!d.sources.length) errors.push('sources');
  if (!d.tried) errors.push('tried');
  if (!d.change_12_months) errors.push('change_12_months');
  if (!d.consent) errors.push('consent');
  return { d, errors };
}

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

async function customFieldIds(locationId) {
  const r = await ghl(`/locations/${encodeURIComponent(locationId)}/customFields?model=contact`);
  if (!r.ok || !r.json || !Array.isArray(r.json.customFields)) return {};
  const byKey = {};
  for (const f of r.json.customFields) if (f.fieldKey) byKey[f.fieldKey] = f.id;
  return byKey;
}

const norm = (s) => String(s || '').trim().toLowerCase();
let pipelineCache = null;

async function findStage(locationId) {
  if (pipelineCache) return pipelineCache;
  const r = await ghl(`/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`);
  if (!r.ok || !r.json || !Array.isArray(r.json.pipelines)) {
    console.error('GHL pipelines lookup failed', r.status);
    return null;
  }
  const pipeline = r.json.pipelines.find((p) => norm(p.name) === norm(PIPELINE_NAME));
  const stage = pipeline && (pipeline.stages || []).find((s) => norm(s.name) === norm(STAGE_NAME));
  if (!pipeline || !stage) {
    console.error('GHL pipeline or stage not found', { pipeline: !!pipeline, stage: !!stage });
    return null;
  }
  pipelineCache = { pipelineId: pipeline.id, stageId: stage.id };
  return pipelineCache;
}

async function addToPipeline(locationId, contactId, d, r) {
  const target = await findStage(locationId);
  if (!target) return false;
  const q = `location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contactId)}&pipeline_id=${encodeURIComponent(target.pipelineId)}`;
  const existing = await ghl(`/opportunities/search?${q}`);
  if (existing.ok && existing.json && Array.isArray(existing.json.opportunities) && existing.json.opportunities.length) {
    return true; // Already in the pipeline from an earlier application; leave its stage alone.
  }
  const created = await ghl('/opportunities/', {
    method: 'POST',
    body: JSON.stringify({
      locationId,
      pipelineId: target.pipelineId,
      pipelineStageId: target.stageId,
      contactId,
      name: `${d.name} | ${d.clinic}`,
      status: 'open',
      monetaryValue: VALUE_BY_ROUTE[r] || 0,
      source: 'Founding seat application',
    }),
  });
  if (!created.ok) console.error('GHL opportunity create failed', created.status, created.json && created.json.message);
  return created.ok;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // Only accept submissions from this site.
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  let originHost = '';
  try { originHost = origin ? new URL(origin).host : ''; } catch (_) { originHost = 'invalid'; }
  if (origin && originHost !== host) return res.status(403).json({ ok: false, error: 'forbidden' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (_) { return res.status(400).json({ ok: false, error: 'invalid' }); }
  }

  // Honeypot: real people never fill this hidden field. Pretend success so bots learn nothing.
  if (clean(body.website, 200)) return res.status(200).json({ ok: true, route: 'review' });

  const { d, errors } = validate(body);
  if (errors.length) return res.status(400).json({ ok: false, error: 'invalid', fields: errors });

  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) return res.status(500).json({ ok: false, error: 'not_configured' });

  const r = route(d);
  const consentAt = new Date().toISOString();
  const nameNoTitle = d.name.replace(/^(dr\.?|dato'?\s*dr\.?|datin\s*dr\.?)\s+/i, '');
  const [firstName, ...rest] = nameNoTitle.split(/\s+/);

  try {
    const ids = await customFieldIds(locationId);
    const values = {
      profession: d.profession,
      role: d.role,
      booked: d.booked,
      patients_per_day: d.patients_per_day,
      sources: d.sources.join(', '),
      tried: d.tried,
      change_12_months: d.change_12_months,
      ready: d.ready,
      consent_at: consentAt,
    };
    const customFields = Object.entries(FIELD_KEYS)
      .filter(([, key]) => ids[key])
      .map(([k, key]) => ({ id: ids[key], field_value: values[k] }));

    const up = await ghl('/contacts/upsert', {
      method: 'POST',
      body: JSON.stringify({
        locationId,
        firstName,
        lastName: rest.join(' ') || undefined,
        name: d.name,
        email: d.email,
        phone: d.whatsapp,
        companyName: d.clinic,
        source: 'Founding seat application',
        customFields: customFields.length ? customFields : undefined,
      }),
    });
    const contactId = up.json && up.json.contact && up.json.contact.id;
    if (!up.ok || !contactId) {
      console.error('GHL upsert failed', up.status, up.json && up.json.message);
      return res.status(502).json({ ok: false, error: 'crm_unavailable' });
    }

    // Tags are added separately so existing tags on a returning contact are kept.
    const tags = ['founding-applicant', `route-${r}`, `profession-${d.profession.toLowerCase()}`, 'pdpa-consent-application'];
    const tagRes = await ghl(`/contacts/${contactId}/tags`, { method: 'POST', body: JSON.stringify({ tags }) });
    if (!tagRes.ok) console.error('GHL tags failed', tagRes.status);

    const note = [
      'Founding seat application',
      `Route: ${r}`,
      `Clinic: ${d.clinic}`,
      `Profession: ${d.profession}`,
      `Role: ${d.role}`,
      `Booked ahead: ${d.booked}`,
      `Patients a day: ${d.patients_per_day}`,
      `New patients come from: ${d.sources.join(', ')}`,
      `Tried so far: ${d.tried}`,
      `What a second front door would change: ${d.change_12_months}`,
      `Ready to start within 30 days: ${d.ready}`,
      `PDPA consent given: ${consentAt}`,
    ].join('\n');
    const noteRes = await ghl(`/contacts/${contactId}/notes`, { method: 'POST', body: JSON.stringify({ body: note }) });
    if (!noteRes.ok) console.error('GHL note failed', noteRes.status);

    // The contact is already saved, so a pipeline problem is logged rather than shown to the applicant.
    try { await addToPipeline(locationId, contactId, d, r); } catch (e) { console.error('GHL pipeline step error', e && e.message); }

    return res.status(200).json({ ok: true, route: r });
  } catch (err) {
    console.error('Apply handler error', err && err.message);
    return res.status(502).json({ ok: false, error: 'crm_unavailable' });
  }
};
