import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

interface Contact {
  name: string;
  email: string;
  message: string;
  createdAt: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const contact: Contact = {
      name: String(body.name ?? ''),
      email: String(body.email ?? ''),
      message: String(body.message ?? ''),
      createdAt: new Date().toISOString(),
    };

    if (!contact.name || !contact.email || !contact.message) {
      return new Response(JSON.stringify({ error: 'Name, email, and message are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const dataPath = path.join(process.cwd(), 'src', 'data', 'contacts.json');
    let contacts: Contact[] = [];
    try {
      contacts = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    } catch {
      // file doesn't exist yet
    }
    contacts.push(contact);
    fs.writeFileSync(dataPath, JSON.stringify(contacts, null, 2));

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
