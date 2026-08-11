import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

interface Lead {
  name: string;
  email: string;
  postal?: string;
  services?: string;
  createdAt: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const lead: Lead = {
      name: String(body.name ?? ''),
      email: String(body.email ?? ''),
      postal: body.postal ? String(body.postal) : undefined,
      services: body.services ? String(body.services) : undefined,
      createdAt: new Date().toISOString(),
    };

    if (!lead.name || !lead.email) {
      return new Response(JSON.stringify({ error: 'Name and email are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const dataPath = path.join(process.cwd(), 'src', 'data', 'leads.json');
    let leads: Lead[] = [];
    try {
      leads = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    } catch {
      // file doesn't exist yet, start empty
    }
    leads.push(lead);
    fs.writeFileSync(dataPath, JSON.stringify(leads, null, 2));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
