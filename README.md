# Mi árbol familiar

Árbol colaborativo en español con React, TypeScript, Vite, React Flow y **Firebase Spark**, sin Cloud Functions, Storage ni envío de correos. El frontend está preparado para GitHub Pages y usa rutas hash (`/#/admin`).

**Web publicada:** https://leonelbustamante.github.io/mi-arbol/

Repositorio: https://github.com/LeonelBustamante/mi-arbol. Proyecto Firebase: `mi-arbol-19103`.

## Uso

Los visitantes ven el árbol público, agregan familiares y proponen correcciones al tocar un nodo, sin cuenta ni login. El nombre de quien carga el aporte es obligatorio; no se pide correo. La foto es opcional. Las fechas admiten DDMMYYYY, MMYYYY o YYYY, también con barras, conservando la precisión conocida.

`aleobustamante@gmail.com` es el propietario. Desde **Administración → Administradores** puede habilitar otras cuentas de Google por correo, revocarlas y reactivarlas. Cada administrador habilitado puede revisar y aprobar aportes, editar el árbol y consultar los datos privados. Solo el propietario puede gestionar accesos; su cuenta queda protegida contra la revocación desde el panel.

Para agregar un administrador: escribir su correo de Google, pulsar **Habilitar administrador** y compartirle el enlace del árbol. La persona ingresa con Google desde Administración. No se crean contraseñas ni se envían correos. El panel muestra si ya ingresó por primera vez. Al revocar se bloquean las siguientes lecturas y escrituras en el servidor, incluso si la sesión sigue abierta; los datos ya descargados no se pueden retirar del dispositivo.

Las reglas requieren Google verificado, un registro `members/{uid}` con rol `admin` y, para los invitados, una habilitación activa en `adminInvitations/{email}`. Tener otro correo o un rol falso no da acceso. Los permisos se verifican en Firestore y la interfaz escucha las revocaciones.

El panel abre cada aporte en un modal con colaborador, foto y comparación de los datos. **Aprobar y publicar** actualiza el árbol de forma atómica. Rechazar conserva el registro privado. Las correcciones desactualizadas se bloquean; los campos vacíos conservan datos privados que el visitante no podía consultar.

El administrador puede crear familiares directamente, sin una propuesta pendiente de aprobación, editar un nodo, unir familiares como padre, madre o pareja y quitar vínculos. Las altas confirmadas se publican al guardar; las hipótesis permanecen privadas. Los reintentos de la misma alta no crean duplicados. Se validan referencias, duplicados, reemplazos explícitos y ciclos. Los vínculos y personas «Creo que...» permanecen privados. Las operaciones de parentesco actualizan las revisiones de las personas afectadas para evitar que una corrección antigua deshaga vínculos recientes.

## Seguridad y guardado

`src/spark.ts` usa el SDK web de Firestore. La autorización real está en `firestore.rules`, independientemente de los controles visuales. No hay funciones desplegadas ni secretos en el navegador.

| Colecciones                                           | Acceso público                                                     | Escritura                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `publicPersons`                                       | Nombre y fecha de nacimiento aprobados                             | Administrador                                                |
| `publicRelationships`, `publicPersonPhotos`           | Vínculos y fotos aprobados                                         | Administrador                                                |
| `publicPersonVersions`                                | Número de revisión                                                 | Administrador                                                |
| `persons`, `relationships`, `personPhotos`            | Sin acceso                                                         | Administrador                                                |
| `submissions`, `submissionPhotos`, `privacyRequests`  | Sin lectura; solo crear solicitudes pendientes validadas           | Visitantes y moderación administrativa                       |
| `members`                                             | Registro propio autenticado; listado exclusivo del propietario     | Inicialización propia con Google verificado y habilitación   |
| `adminInvitations`                                    | Invitación propia; listado exclusivo del propietario               | Solo el propietario: habilitación, revocación y reactivación |
| `auditLogs`, `relationshipOperations`, `system/graph` | Sin acceso                                                         | Administrador                                                |
| `publicReceipts`                                      | Solo consulta individual por UUID, sin listado ni datos familiares | Creación atómica junto con el aporte                         |
| `publicLimits`                                        | Contadores globales de recepción                                   | Incremento validado junto con un aporte nuevo                |

Cada propuesta se guarda junto con un recibo mínimo y un contador, en una transacción. Las reglas exigen los tres registros, campos y tamaños limitados, fecha del servidor, estado pendiente y colaborador declarado sin verificar. Reintentar el mismo envío no crea duplicados ni consume otra recepción; reutilizar su ID con otros datos se rechaza. El recibo contiene solo ID, tipo de colección y huella SHA-256; nunca nombres ni fotos.

Para proteger las cuotas de Spark se aceptan **100 aportes y 20 solicitudes de privacidad por cada período global de 24 horas**. Es un límite compartido por toda la familia, no por dirección IP. App Check protege el acceso de la app cuando se activa enforcement de Firestore. Ningún cliente público puede aprobar, modificar solicitudes existentes o escribir el árbol publicado. App Check y los contadores reducen abuso; no garantizan disponibilidad ante todos los ataques ni amplían las cuotas de Firebase.

Las ediciones administrativas usan transacciones y un documento de versión global. Como el SDK web no permite consultar colecciones dentro de una transacción, primero se lee el grafo del servidor y después se verifica su versión dentro de la transacción. Un conflicto provoca una nueva lectura; todas las escrituras del grafo deben incrementar esa versión según las reglas. La validación completa de genealogía corre en la sesión del propietario, que ya tiene autoridad de escritura; las reglas separan el acceso y limitan las proyecciones públicas.

Las fotos se convierten en el navegador a JPEG de hasta 512 px y 180.000 caracteres, y se guardan en documentos privados separados. Las reglas limitan su formato y tamaño. Al aprobar, la sesión administradora vuelve a decodificar y convertir la foto antes de publicarla, retirando metadatos. No se usa Firebase Storage. El contenido base64 no se indexa.

No se envían emails ni se necesita Resend, SMTP, Secret Manager o facturación. Si se agotan las cuotas de Spark, el servicio puede dejar de aceptar operaciones hasta su renovación. No se activa Blaze automáticamente.

## Desarrollo local

Se requiere Node 22.12+ y Java 21 para el emulador.

```sh
npm ci
npm run local:backend
```

En otra terminal:

```sh
npm run dev
```

`.env.local` debe usar `demo-mi-arbol-local`, `VITE_USE_EMULATORS=true` y `VITE_BASE_PATH=/`. El script local inicia únicamente Auth y Firestore, restaura `.local/firebase-data` y exporta una copia cada 20 segundos. **Preservar esa carpeta:** contiene los datos manuales locales y está excluida de Git. El propietario y el login Google locales son simulados; no otorgan acceso productivo.

La migración local agrega las revisiones públicas a las personas ya aprobadas sin borrar datos. No se trasladan datos familiares ni fotos al repositorio de código. Un traslado a producción debe hacerse de manera privada, conservando los estados de moderación.

## Verificación

```sh
npm test
npm run test:emulators
npm run build
```

Las pruebas Spark usan el SDK web real con reglas, en proyecto y puertos aislados (`demo-mi-arbol-spark`, Firestore 8180 y Auth 9199), sin tocar el backend manual. Cubren aportes sin cuenta, autorización, publicación exacta, fotos privadas, correcciones, revisiones, vínculos, ciclos, revocación, cuotas, idempotencia y concurrencia. Las pruebas de React comprueban clic en nodos y revisión modal.

Los archivos antiguos de Cloud Functions y sus pruebas se conservan como referencia de la implementación anterior. No se usan por el frontend, no se incluyen en el despliegue actual y ya no tienen un trigger de correo. Las suites antiguas `tests/integration.test.ts` y `tests/rules.test.ts` no describen la arquitectura Spark; se reemplazaron por `tests/spark.test.ts` en el comando de verificación.

## Publicación sin Blaze

1. Mantener el proyecto en Spark. Crear Firestore Standard y habilitar Google en Authentication.
2. Autorizar `leonelbustamante.github.io` en Authentication y registrar App Check para ese dominio.
3. Cargar las variables públicas de `.env.example` en GitHub Actions; ninguna `VITE_*` es secreta. Para este repositorio, `VITE_BASE_PATH=/mi-arbol/`.
4. Desplegar solamente reglas e índices:

```sh
npx firebase deploy --only firestore --project mi-arbol-19103
```

5. Compilar con configuración productiva y `VITE_USE_EMULATORS=false`. Publicar `dist` con el workflow manual de Pages, o como sitio estático ya compilado desde una rama `gh-pages` con `.nojekyll`.
6. Verificar el dominio final, aporte público, Google del propietario, aprobación, fotos y privacidad. Activar enforcement de App Check en Firestore tras comprobar la configuración de la app.

La web se publicó desde la rama `gh-pages`, con archivos compilados localmente y `.nojekyll`. GitHub bloquea el workflow de CI por la facturación de su cuenta, pero permitió la publicación nativa de Pages. No hace falta habilitar Blaze ni contratar runners para la publicación actual.

Por elección del propietario, no se envían notificaciones ni se utiliza Telegram. La revisión y aprobación se realizan exclusivamente desde el panel web.

El administrador puede exportar JSON desde el panel. Ese respaldo incluye datos privados y fotos: guardarlo fuera del repositorio público. Eliminar una persona borra sus proyecciones y vínculos, pero las propuestas, auditorías y respaldos pueden conservar versiones anteriores; revisar esos registros ante solicitudes de eliminación.

Referencias: [plan Spark](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [reglas](https://firebase.google.com/docs/firestore/security/rules-conditions), [transacciones](https://firebase.google.com/docs/firestore/manage-data/transactions), [App Check](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).

## Dibujo del árbol

El motor ELK organiza grupos familiares completos y reserva espacio para su descendencia. Los cónyuges comparten fila y los conectores ortogonales se trazan alrededor de las tarjetas. Una unión familiar conecta a los progenitores registrados con sus hijos, sin convertir automáticamente a otros cónyuges en padres. Cada rama tiene un color estable.

El selector visible **Ver familia** permite alternar entre el árbol completo y la descendencia de cualquier grupo con hijos, incluyendo familias de generaciones intermedias. La vista incluye cónyuges y otros progenitores necesarios como contexto, sin incorporar automáticamente sus antepasados y hermanos. Los clics siguen abriendo la edición de la persona canónica. La distribución no cambia los parentescos guardados.

El cálculo es asíncrono y se vuelve a ejecutar solo cuando cambia la estructura del árbol o la familia seleccionada. La búsqueda puede volver al árbol completo y centrar a la persona encontrada. Las figuras temporales de revisión con datos reales se guardan exclusivamente en `.local`, fuera del repositorio.

## Interfaz y navegación

La interfaz usa azul, fondos claros, estados con etiquetas de texto y foco de teclado visible. El panel incluye un resumen de aportes pendientes, privacidad y familiares. En celular, la cabecera separa la marca de las acciones, las acciones se pueden desplazar horizontalmente y los formularios se apilan; los controles principales tienen un mínimo de 44 px. Hay un enlace de salto al contenido para navegar con teclado.

Los selectores de familiares de los modales de edición y parentesco permiten buscar por nombre sin distinguir mayúsculas ni tildes. Sus opciones y las familias del selector del árbol se ordenan alfabéticamente en español. La selección funciona con teclado (flechas y Enter); Escape cierra primero la lista y conserva el valor guardado si solo se estaba buscando.

## Nombres en mayúsculas

Los nombres de familiares y colaboradores se normalizan a mayúsculas al cargar, proponer, aprobar, editar e importar, conservando tildes y eñes. Las reglas de Firestore rechazan nuevos nombres en minúsculas. La búsqueda sigue funcionando sin distinguir mayúsculas. Los nombres que aparecen en registros históricos se muestran en mayúsculas conservando el contenido original de las auditorías.

La migración de datos existentes se puede revisar con `node scripts/uppercase-names.cjs`; `--apply` crea un respaldo privado en `.local`, convierte únicamente campos de nombre y verifica el resultado. Usa el acceso existente de Firebase CLI al proyecto `mi-arbol-19103`. El lote es atómico y comprueba las versiones de los documentos para rechazar cambios concurrentes. No modifica vínculos, fotos, fechas, correos ni permisos.
