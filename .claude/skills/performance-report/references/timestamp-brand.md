# Timestamp — brand kit (para el informe)

Extraído de https://www.timestamp.cl/ (2026-09-23). Aplicar al informe HTML/PDF
y a la portada del Claude Doc. Es la marca propia de Timestamp (la consultora)
sobre su propio entregable al cliente.

## Logo (mark, SVG embebible)

```html
<svg width="36" height="36" viewBox="0 0 100 100" fill="none" aria-hidden="true"><rect width="100" height="100" rx="20" fill="#1a1a1a"/><path d="M28 28h44v10H56v36H44V38H28V28z" fill="#faf9f7"/><circle cx="72" cy="72" r="6" fill="#c97a4e"/></svg>
```

Marca: cuadrado redondeado negro (`#1a1a1a`) con una "T" hueso (`#faf9f7`) y un
punto terracota (`#c97a4e`) abajo a la derecha. Wordmark: **Timestamp** (en Space
Grotesk). Favicon oficial: `https://www.timestamp.cl/favicon.svg`.

## Colores (tokens)

Claro:
- Accent (terracota): `#c97a4e` · hover `#b56a3f` · subtle `rgba(201,122,78,.08)`
- Fondo: `#faf9f7` · alt `#f4f1ec` · surface `#ffffff`
- Borde: `#e8e5e0` · subtle `#f0ede8`
- Texto: primario `#1a1a1a` · secundario `#6b6b6b` · terciario `#999999`
- Éxito (verde): `#2d8a56`

Oscuro:
- Fondo `#1a1a1a` · texto `#e8e5e0` · secundario `#999999` · borde `rgba(255,255,255,.1)`

Uso en el informe: fondo `#faf9f7`, texto `#1a1a1a`; títulos, acentos y enlaces
en `#c97a4e`; PASS/OK en `#2d8a56`; FAIL en un rojo sobrio (p. ej. `#c0392b`);
métricas y Run IDs en la fuente mono.

## Tipografía (Google Fonts)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
```

- Títulos: `"Space Grotesk", sans-serif`
- Cuerpo: `"Inter", sans-serif`
- Métricas / código / IDs: `"JetBrains Mono", monospace`

## Voz / posicionamiento (portada y pie)

- Tagline: "Agentes de IA, tecnología y equipos dedicados para tu industria".
- "+10 años construyendo tecnología para banca, minería, retail, seguros y
  telecomunicaciones".
- Estilo: corporativo-tecnológico, sobrio y cálido (paleta hueso + terracota, no
  el azul corporativo genérico).

## Encabezado sugerido

```
[logo SVG]  Timestamp   ·   Informe de pruebas de carga — <Cliente>
<fecha> · <ventana horaria> · <ambiente>
```

Pie: `Timestamp · timestamp.cl · <Cliente> · confidencial`.
