// Exportar informe: HTML autocontenido + Markdown con errores, red, enlaces, CSS responsive y rendimiento.
const Report = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SEV = { error: 'Error', warning: 'Aviso', notice: 'Nota' };
  const kb = (n) => (n == null ? '—' : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

  function build(ctx) {
    const s = Sessions.snapshot();
    const msgs = [...s.messages].sort((a, b) => ({ error: 0, warning: 1, notice: 2 }[a.sev] - { error: 0, warning: 1, notice: 2 }[b.sev]));
    const count = (sev) => s.messages.filter((m) => m.sev === sev).length;
    const when = new Date().toLocaleString();
    const md = [];
    const html = [];
    const h = (title, level = 2) => { md.push(`\n${'#'.repeat(level)} ${title}\n`); html.push(`<h${level}>${esc(title)}</h${level}>`); };
    const p = (text) => { md.push(`${text}\n`); html.push(`<p>${esc(text)}</p>`); };
    const table = (head, rows) => {
      if (!rows.length) return;
      md.push(`| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |`);
      rows.forEach((r) => md.push(`| ${r.map((c) => String(c == null ? '' : c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`));
      md.push('');
      html.push(`<table><thead><tr>${head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    };

    md.push(`# Informe LiveProject — ${ctx.project}\n`);
    html.push(`<h1>Informe LiveProject — ${esc(ctx.project)}</h1>`);
    p(`Generado el ${when} · URL ${ctx.url || '—'} · Sesión iniciada ${new Date(s.startedAt).toLocaleString()}`);
    p(`Dispositivos activos: ${ctx.devices.map((d) => `${d.name} (${d.width}×${d.height})`).join(', ') || 'ninguno'}`);

    h('Resumen');
    table(['Área', 'Resultado'], [
      ['Errores / avisos / notas', `${count('error')} / ${count('warning')} / ${count('notice')}`],
      ['Peticiones de red', `${s.network.total} (${s.network.failed.length} con fallo)`],
      ['Enlaces y recursos', s.links ? `${s.links.total} comprobados, ${s.links.broken.length} rotos, ${s.links.anchors.length} anclajes rotos` : 'sin comprobar'],
      ['CSS responsive', s.csslint ? `${s.csslint.findings.length} hallazgo(s) en ${s.csslint.devices.length} dispositivo(s)` : 'sin analizar'],
      ['Rendimiento', s.perf.length ? s.perf.map((x) => `${x.device}: ${x.score ?? '—'}`).join(' · ') : 'sin medir']
    ]);

    h('Mensajes y errores');
    if (!msgs.length) p('Sin mensajes en esta sesión.');
    table(['Gravedad', 'Lenguaje', 'Mensaje', 'Origen', 'Veces'], msgs.map((m) => [SEV[m.sev], m.lang, m.title, (m.origins || []).join(', '), m.count]));
    for (const m of msgs.filter((x) => x.ai)) {
      md.push(`**Explicación de IA — ${m.title}**\n\n${m.ai}\n`);
      html.push(`<details><summary>Explicación de IA — ${esc(m.title)}</summary><pre>${esc(m.ai)}</pre></details>`);
    }

    h('Red');
    table(['Vista', 'Petición', 'Estado'], s.network.failed.map((r) => [r.device, `${r.method} ${r.url}`, r.error || r.status]));
    if (!s.network.failed.length) p('Sin peticiones fallidas.');
    h('Más lentas', 3);
    table(['Vista', 'URL', 'Tiempo'], s.network.slow.map((r) => [r.device, r.url, `${r.ms} ms`]));
    h('Más pesadas', 3);
    table(['Vista', 'URL', 'Tamaño'], s.network.heavy.map((r) => [r.device, r.url, kb(r.size)]));

    h('Enlaces y recursos');
    if (!s.links) p('No se ha ejecutado el comprobador de enlaces.');
    else {
      p(`${s.links.device} · ${s.links.page} · ${new Date(s.links.at).toLocaleString()}`);
      table(['Tipo', 'URL', 'Resultado'], s.links.broken.map((b) => [b.kind, b.url, b.error || b.status]));
      table(['Anclaje', 'Texto'], s.links.anchors.map((a) => [a.raw, a.text]));
      table(['Contenido mixto'], s.links.mixed.map((u) => [u]));
      table(['URL', 'Redirige a', 'Código'], s.links.redirects.map((r) => [r.url, r.to, r.status]));
      if (!s.links.broken.length && !s.links.anchors.length) p('✔ Sin enlaces ni recursos rotos.');
    }

    h('CSS responsive');
    if (!s.csslint) p('No se ha ejecutado el linter de CSS responsive.');
    else {
      p(`Dispositivos analizados: ${s.csslint.devices.map((d) => `${d.name} (${d.vw}px)`).join(', ')}`);
      table(['Gravedad', 'Problema', 'Dispositivos', 'Ejemplos', 'Corrección sugerida'], s.csslint.findings.map((f) => [SEV[f.sev], `${f.title}${f.count > 1 ? ` ×${f.count}` : ''}`, f.devices.join(', '), f.examples.join('; '), f.fix]));
      if (!s.csslint.findings.length) p('✔ Sin hallazgos.');
    }

    h('Rendimiento');
    if (!s.perf.length) p('Sin mediciones.');
    for (const x of s.perf) {
      p(`${x.device} — nota ${x.score ?? '—'}/100`);
      table(['Métrica', 'Valor', 'Nivel'], x.metrics.map((m) => [m.id, m.value, m.level]));
    }

    const css = 'body{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#1c1c22}h1{border-bottom:2px solid #6c8cff;padding-bottom:6px}h2{margin-top:32px;border-bottom:1px solid #ddd}table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px}th,td{border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top;word-break:break-word}th{background:#f1f3ff}pre{background:#f6f6f9;padding:10px;border-radius:6px;white-space:pre-wrap}';
    return { md: md.join('\n'), html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe LiveProject</title><style>${css}</style></head><body>${html.join('\n')}</body></html>` };
  }

  return { build };
})();
