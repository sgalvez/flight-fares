# Radar de vuelos SCL ↔ IQQ

Radar personal de tarifas para los próximos 60 días. Prioriza LATAM, compara una maleta de cabina, combina viajes de 2–4 noches y envía oportunidades verificadas y un resumen diario a Telegram.

## Qué está implementado

- Dos rutas independientes: SCL → IQQ e IQQ → SCL.
- Descubrimiento mediante Amadeus con límite mensual local y margen de seguridad del 20%.
- Adaptadores Playwright configurables para LATAM, SKY y JetSMART.
- Circuit breaker de 24 horas después de tres fallas consecutivas.
- Precio comparable con impuestos, cargos, equipaje de cabina y descuentos confirmados.
- Preferencia LATAM cuando queda dentro de 10% del competidor.
- Detección relativa de ofertas con percentil 20 durante el arranque y mediana histórica después de 21 observaciones.
- Viajes completos de 2, 3 o 4 noches, incluso mezclando aerolíneas.
- Escaneo de promociones públicas compatible con banco/producto y LATAM Pass.
- Historial SQLite local por defecto (PostgreSQL opcional), deduplicación de 24 horas y retención de 400 días.
- Telegram, ejecución manual y dos horarios automáticos en GitHub Actions.
- Ninguna compra automática, sesión personal, tarjeta o credencial de aerolínea.

## Puesta en marcha local

Requisito: Node.js 22. El modo predeterminado usa un archivo SQLite local y no necesita Neon ni otro servicio de base de datos.

```bash
npm install
cp .env.example .env
npx playwright install chromium
npm run build
npm run db:migrate
npm test
npm run radar -- run
```

Cuando Chromium esté instalado, `npm run test:browser` valida el parser de navegador contra una página local de prueba. La suite normal omite esta prueba porque algunos sandboxes no permiten iniciar Chromium.

Node no carga `.env` automáticamente. Para desarrollo se puede ejecutar el JavaScript compilado con `node --env-file=.env dist/cli.js run`, exportar las variables en la terminal o usar el gestor de secretos del entorno. Sin `DATABASE_URL`, el CLI conserva automáticamente el historial en `data/radar.sqlite`. `EPHEMERAL_STORE=true` habilita explícitamente el modo temporal para diagnóstico.

Comandos disponibles:

```bash
npm run radar -- discover  # Amadeus, sujeto a cuota
npm run radar -- verify    # páginas oficiales configuradas
npm run radar -- digest    # promociones, alertas y resumen
npm run radar -- run       # ciclo completo
npm run radar -- evening   # verificación y resumen, sin consumir Amadeus
npm run radar -- health    # resumen y estado de fuentes
npm run radar -- backfill  # descubrimiento sin alertas
npm run radar -- miles 50000 4000 10000  # calcula CLP efectivos por milla
```

## Configuración obligatoria

1. Crear un bot con BotFather, iniciar una conversación con él y guardar `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.
2. Crear una aplicación Amadeus, moverla a producción y copiar su cuota gratuita visible en el workspace a `AMADEUS_MONTHLY_CAP`.
3. No habilitar facturación automática en Amadeus. El radar detiene llamadas cuando su contador local alcanza 80% de la cuota configurada.

El entorno de prueba de Amadeus contiene datos limitados. Para observaciones reales debe usarse `https://api.amadeus.com`, aunque sus precios sigan siendo señales estimadas hasta verificarlos en la aerolínea.

## Adaptadores de aerolíneas

`BROWSER_SOURCES_JSON` es un arreglo JSON. Su forma está en [config/browser-sources.example.json](config/browser-sources.example.json). Cada adaptador necesita:

- una URL pública que acepte origen, destino y fecha;
- un selector estable para el precio final mostrado;
- opcionalmente selectores de vuelo, horarios y familia tarifaria;
- la regla vigente de maleta de cabina para esa tarifa.

Antes de habilitar un adaptador:

1. Revisar los términos y `robots.txt` del sitio.
2. Probar 20 búsquedas manuales/anónimas.
3. Comparar el valor extraído con el último paso anterior al pago.
4. Habilitarlo solo si al menos 18 búsquedas funcionan sin CAPTCHA y sin discrepancias materiales.

El código vuelve a revisar `robots.txt`, usa una sola sesión secuencial, agrega una pausa aleatoria, no inicia sesión y no intenta resolver desafíos. Una captura se conserva siete días únicamente cuando falla el parser.

Las páginas cambian con frecuencia, por lo que no se incluyen selectores pretendidamente universales. Mantenerlos como secreto permite repararlos sin publicar detalles del sitio o desplegar cambios de código.

## Promociones y beneficios

`PROMOTION_URLS_JSON` contiene páginas públicas como el ejemplo de [config/promotion-urls.example.json](config/promotion-urls.example.json). `BANK_PRODUCTS` admite nombres separados por coma, por ejemplo `Santander LATAM Pass,WorldMember`.

Solo se guardan nombres de productos, categoría LATAM Pass y pertenencia al Club. Nunca se deben introducir números de tarjeta, RUT, cuenta, saldo, cookies o contraseñas.

Una promoción potencial se muestra separada del precio. Solo debe descontarse del total cuando sus fechas, ruta, medio de pago, cupo y tope estén confirmados. Los canjes de millas quedan fuera de la automatización porque requieren una sesión personal.

## GitHub Actions

El workflow usa SQLite y restaura `data/radar.sqlite` desde el caché privado de GitHub Actions al comenzar; al terminar correctamente guarda una nueva versión. La concurrencia está serializada para que dos ejecuciones no escriban simultáneamente.

Este almacenamiento no tiene costo ni requiere credenciales adicionales, pero el caché de Actions es recuperable solo bajo las políticas de retención de GitHub y no sustituye un backup permanente. Para máxima autonomía, ejecutar el mismo proyecto con cron o systemd en un computador, NAS, Raspberry Pi o servidor propio mantiene el archivo SQLite íntegramente bajo tu control.

Guardar como secretos:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `AMADEUS_API_KEY`
- `AMADEUS_API_SECRET`
- `BROWSER_SOURCES_JSON`
- `BANK_PRODUCTS`

`DATABASE_URL` es opcional. Si se configura, PostgreSQL/Neon toma precedencia sobre SQLite.

Guardar como variables no sensibles:

- `AMADEUS_MONTHLY_CAP`
- `PROMOTION_URLS_JSON`
- `LATAM_PASS_TIER`
- `LATAM_PASS_CLUB`

El workflow ejecuta descubrimiento a las 07:17 y verificación, promociones y resumen a las 19:43, hora de Santiago. También admite ejecución manual. GitHub puede retrasar tareas programadas; la base conserva la hora de cada corrida para evidenciar esos saltos.

## Interpretación de alertas

- `signal`: observación interesante, incluida solo en el resumen si no está verificada.
- `good`: al menos 15% bajo su referencia.
- `exceptional`: al menos 25% bajo su referencia.
- Un competidor puede generar recomendación si ahorra al menos 20% frente a LATAM.
- Una alerta se repite después de 24 horas o antes si el precio cae otro 5%.

El precio de una alerta nunca constituye una reserva. Hay que abrir el enlace, reconfirmar equipaje, condiciones y total, y comprar personalmente.

## Roadmap de hasta US$20

La siguiente mejora recomendada es mover cron y navegador a Cloudflare Workers Paid/Browser Run y agregar Duffel para LATAM, con un corte cercano a 2.880 búsquedas al mes. La interfaz `FlightSource` y `RadarStore` permite hacerlo sin cambiar las reglas, Telegram ni el modelo de datos.

La distribución objetivo es: fechas a 14 días dos veces al día, 15–30 cada dos días, 31–60 cada cuatro días y una segunda validación de candidatos. El límite mensual debe seguir siendo obligatorio; aumentar frecuencia nunca debe habilitar cargos ilimitados.

## Seguridad operativa

- Todos los secretos provienen del entorno y están excluidos de Git.
- El archivo SQLite y sus archivos WAL están excluidos de Git; en Actions se almacenan únicamente en el caché privado del repositorio.
- Los errores y resúmenes no incluyen cuerpos completos de proveedores ni tokens.
- El repositorio puede ser privado; GitHub Free incluye minutos mensuales suficientes para el volumen esperado, pero se debe activar un presupuesto con corte en cero.
- Revisar mensualmente cuota de APIs, minutos de Actions, tamaño/backup de SQLite y salud de selectores.
