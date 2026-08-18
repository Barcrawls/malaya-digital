// Vercel Serverless Function — dispara los correos del diagnóstico vía Resend.
// No requiere configuración adicional: Vercel detecta este archivo automáticamente
// porque vive en /api. La clave de Resend se lee de una variable de entorno
// (RESEND_API_KEY) configurada en el proyecto de Vercel — nunca queda expuesta al navegador.

export default async function handler(req, res) {
  // CORS básico: solo permitimos que malayadigital.co llame a esta función.
  res.setHeader('Access-Control-Allow-Origin', 'https://malayadigital.co');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY no configurada');
    return res.status(500).json({ error: 'Configuración de servidor incompleta' });
  }

  try {
    const { lead, total, banda, mayorFuga, plan, desglose, respuestas } = req.body || {};

    // Validación mínima: sin estos campos no hay nada que mandar.
    if (!lead || !lead.email || typeof total !== 'number') {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Escapado simple para evitar que texto del usuario rompa el HTML del correo.
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    const desgloseHtml = (desglose || [])
      .map(d => `<tr><td style="padding:4px 12px 4px 0">${esc(d.nombre)}</td><td style="padding:4px 0"><strong>${d.puntos}/${d.max}</strong></td></tr>`)
      .join('');

    const respuestasHtml = (respuestas || [])
      .map((r, i) => `<li style="margin-bottom:6px"><strong>${i + 1}. ${esc(r.pregunta)}</strong><br>→ ${esc(r.respuesta)}</li>`)
      .join('');

    // ---- Correo 1: lead completo para Ciro ----
    const emailInterno = {
      from: 'Diagnóstico Malaya <hola@malayadigital.co>',
      to: ['hola@malayadigital.co'],
      subject: `Nuevo diagnóstico: ${esc(lead.negocio || lead.nombre)} — ${total}/100`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#14424A">Nuevo lead del diagnóstico</h2>
          <p><strong>Puntaje: ${total}/100 — ${esc(banda)}</strong></p>
          <table style="border-collapse:collapse;margin-bottom:16px">
            <tr><td style="padding:4px 12px 4px 0">Nombre</td><td><strong>${esc(lead.nombre)}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0">Negocio</td><td><strong>${esc(lead.negocio)}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0">Email</td><td><strong>${esc(lead.email)}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0">WhatsApp</td><td><strong>${esc(lead.whatsapp)}</strong></td></tr>
          </table>
          <p><strong>Mayor fuga:</strong> ${esc(mayorFuga)}</p>
          <p><strong>Plan sugerido:</strong> ${esc(plan)}</p>
          <h3 style="color:#14424A;margin-top:24px">Desglose por área</h3>
          <table style="border-collapse:collapse">${desgloseHtml}</table>
          <h3 style="color:#14424A;margin-top:24px">Respuestas completas</h3>
          <ol style="padding-left:20px">${respuestasHtml}</ol>
        </div>
      `,
    };

    // ---- Correo 2: confirmación para la persona ----
    const emailPersona = {
      from: 'Malaya Digital <hola@malayadigital.co>',
      to: [lead.email],
      subject: `Tu diagnóstico de visibilidad: ${total}/100`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#14424A">Hola ${esc(lead.nombre)},</h2>
          <p>Gracias por completar el diagnóstico de <strong>${esc(lead.negocio)}</strong>. Aquí está tu resultado:</p>
          <div style="background:#F6F0E2;border-radius:12px;padding:24px;text-align:center;margin:20px 0">
            <div style="font-size:3rem;font-weight:bold;color:#E8503A">${total}<span style="font-size:1.2rem;color:#888">/100</span></div>
            <p style="font-weight:bold">${esc(banda)}</p>
          </div>
          <p><strong>Tu mayor fuga:</strong> ${esc(mayorFuga)}</p>
          <p><strong>Plan recomendado:</strong> ${esc(plan)}</p>
          <p>Te escribiremos pronto para revisar esto contigo. Si quieres adelantarte, responde este correo o escríbenos por WhatsApp.</p>
          <p style="color:#888;font-size:.85rem;margin-top:24px">Malaya Digital · malayadigital.co</p>
        </div>
      `,
    };

    const enviar = (payload) => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const [rInterno, rPersona] = await Promise.all([
      enviar(emailInterno),
      enviar(emailPersona),
    ]);

    if (!rInterno.ok) {
      const err = await rInterno.text();
      console.error('Error enviando correo interno:', err);
    }
    if (!rPersona.ok) {
      const err = await rPersona.text();
      console.error('Error enviando correo a la persona:', err);
    }

    // Consideramos éxito si al menos el correo interno (el que te avisa a ti) salió bien.
    if (!rInterno.ok) {
      return res.status(502).json({ error: 'No se pudo enviar el correo' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error en enviar-diagnostico:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
