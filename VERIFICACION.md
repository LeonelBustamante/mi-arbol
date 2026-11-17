# Verificación — Firebase Spark sin correos

16 de noviembre de 2026.

- Frontend: TypeScript y compilación Vite correctos.
- Pruebas unitarias y React: **52 aprobadas**.
- SDK web contra Firestore Emulator con reglas reales: **18 aprobadas**.
- Total del flujo actual: **70 pruebas aprobadas**.

La suite Spark cubre inicialización exclusiva del propietario con Google verificado; bloqueo de otros proveedores/correos y revocación; aportes sin sesión y sin foto; privados inaccesibles; aprobación, rechazo y proyección pública exacta; fotos pendientes privadas y conversión al aprobar; conservación de datos privados en correcciones; revisiones desactualizadas; creación y eliminación de vínculos, ciclos e idempotencia; hipótesis privadas; eliminación de personas; recibos y contadores atómicos; cuota global que el cliente no puede reiniciar; privacidad; aportes y aprobaciones simultáneos. No se escriben registros de correo.

Las 52 pruebas unitarias incluyen fechas parciales, validación de genealogía y fotos, borradores, interacción con nodos de React Flow y revisión modal. Las pruebas de integración anteriores con Cloud Functions ya no representan la arquitectura actual; `test:emulators` ejecuta `tests/spark.test.ts`.

## Configuración real preparada

- Proyecto `mi-arbol-19103`, base `(default)` Standard en `southamerica-east1`, marcada `freeTier: true` por Google.
- Reglas e índices Spark desplegados correctamente; las fotos base64 no se indexan.
- Authentication inicializado y Google habilitado.
- Dominio `leonelbustamante.github.io` autorizado.
- App Check registrado con reCAPTCHA Enterprise para los dominios del sitio; variables públicas cargadas en GitHub.
- Ninguna Cloud Function, servicio de correo ni facturación habilitada por este trabajo.
- Compilación productiva separada en `.local/production-dist`, con Firebase real y emuladores desactivados.

## Publicación completada

URL: https://leonelbustamante.github.io/mi-arbol/ — HTTP 200. GitHub Pages publicó desde `gh-pages` con `.nojekyll`, sin usar el workflow de CI bloqueado por facturación de la cuenta.

Se trasladaron y contaron 47 documentos desde el emulador, en una transacción sin sobrescribir registros existentes: 5 personas, 3 vínculos, 6 aportes, 19 auditorías, versión del grafo, proyecciones públicas y revisiones. Respaldo privado: `.local/spark-migration-private.json`, excluido de Git. No se trasladaron usuarios simulados, roles del emulador ni correos.

Antes de activar App Check se comprobó por REST que las colecciones públicas entregaban solo sus campos previstos y que personas privadas y aportes devolvían 403. App Check de Firestore quedó en `ENFORCED`. Google confirmó `billingEnabled: false`.

Las pruebas completas contra reglas reales y React están aprobadas. No se completó la comprobación visual del dominio final, del teléfono ni el inicio de sesión real del propietario. Telegram se descartó por decisión del propietario; no hay notificaciones.

Los datos locales originales y las copias automáticas permanecen conservados. Ningún dato familiar ni foto se incluyó en las ramas de código o archivos estáticos de Pages.

## Corrección de App Check

Se diagnosticó un 403 de intercambio de tokens porque `firebaseappcheck.googleapis.com` estaba deshabilitada. Se habilitó la API, se completó su identidad de servicio y se volvió a registrar la misma clave reCAPTCHA. Se conservaron enforcement y las reglas de Firestore. Tras recargar, Chrome mostró los cinco nodos y los tres vínculos publicados sin el error de carga; el formulario que estaba completando el usuario se preservó.

## Conexiones genealógicas

Se reemplazó la distribución por identificadores por grupos familiares y alineación según ascendencia. Nuevas líneas de pareja y ramas compartidas para hijos, con dimensiones de tarjetas estables. Se aprobaron 10 pruebas dirigidas de distribución, recorrido de líneas y apertura de nodos (7 nuevas y 3 existentes). Compilación productiva y TypeScript correctos. No se modificó la base de datos.

## Reorganización por grupos familiares

Se revisó la geometría de las 27 personas publicadas y sus conexiones en un diagrama local, excluido de Git. Se reemplazó la distribución anterior por ELK: espacio reservado para cada grupo, parejas alineadas, conexiones ortogonales que evitan las tarjetas y colores por rama. Se agregó un selector visible para ver la descendencia de familias de cualquier generación.

Se aprobaron 14 pruebas dirigidas: jerarquía, alineación de parejas, separación de tarjetas, ausencia de conexiones que atraviesen personas, estabilidad de distribución, agrupación de hermanos e hipótesis, parentescos entre generaciones, estado vacío, selector de familias y conservación de la apertura de nodos por clic y teclado. TypeScript y compilación productiva correctos. No se escribieron datos familiares.
