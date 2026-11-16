# Mi árbol familiar

Aplicación colaborativa en español con React, TypeScript, Vite, React Flow y Firebase. El frontend es estático y usa rutas hash (`/#/admin`) para funcionar en GitHub Pages sin reglas de reescritura. **No está desplegada ni conectada a un proyecto Firebase real.**

No se incluyeron personas o parentescos inventados. `data/tree.template.json` contiene las ocho ramas solicitadas y listas vacías. La interfaz muestra el estado vacío hasta importar o aprobar datos reales.

## Desarrollo local

El proyecto ya tiene `.env.local` configurado con el proyecto aislado **`demo-mi-arbol-local`**. No contiene claves privadas ni conecta a Firebase productivo. La aplicación puede recibir aportes sin foto y mantenerlos pendientes de revisión en este equipo.

```sh
npm ci
npm run local:backend
# En otra terminal:
npm run dev
```

Abrir `http://localhost:5173`. El backend necesita Java 21; si todavía existe el runtime temporal preparado en `/private/tmp/mi-arbol-java`, el script lo reutiliza automáticamente. En una instalación nueva, instalar Java 21 o indicar `JAVA_HOME`.

`local:backend` inicia Auth, Firestore y Functions, restaura `.local/firebase-data` si existe y hace una copia cada 20 segundos, además de exportar al detenerse normalmente. La carpeta `.local` está ignorada por Git: preservarla para conservar los datos locales. Un cierre abrupto puede perder los últimos segundos desde la última copia. No se envían correos reales. El inicio de sesión de Google del emulador es simulado y solo sirve para pruebas locales; el script prepara el rol de la cuenta administradora dentro del emulador.

`.env.local` usa estos valores públicos de demostración:

```dotenv
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=demo-mi-arbol-local.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-mi-arbol-local
VITE_FIREBASE_APP_ID=1:123456789:web:local
VITE_USE_EMULATORS=true
VITE_FUNCTIONS_REGION=us-central1
VITE_BASE_PATH=/
```

La foto es opcional tanto en el formulario como en el backend. Solo son obligatorios el nombre de quien carga y el nombre del familiar. Sin configuración o sin backend disponible, el envío no puede guardarse; no se presenta como un requisito de imagen.

Para conservar el formulario de alta durante una recarga, se guarda temporalmente el borrador no enviado en `sessionStorage` de esa pestaña por hasta dos horas. Se elimina al enviar correctamente y no se guardan borradores de ediciones privadas del administrador. Los aportes enviados se conservan en el backend local, no en ese borrador temporal.

Las pruebas automáticas usan otro proyecto, **`demo-mi-arbol`**, para separarse de los aportes ingresados manualmente. `npm run test:emulators` usa `firebase.test.json` con puertos separados (Firestore 8180, Auth 9199, Functions 5101), por lo que puede ejecutarse sin detener el backend manual. No apuntar los tests al proyecto local manual.

## Colaboración sin login

Cualquier visitante puede ver la proyección pública, abrir **Agregar familiar** o **Proponer una corrección** y enviar el formulario sin cuenta. No se usa inicio de sesión anónimo de Firebase. Debe indicar el **nombre de quien lo carga**; no se pide correo en el formulario de familiares. El nombre es declarado, sin verificar, y queda privado en el panel administrativo.

La vista principal dedica todo el viewport al árbol, sin sidebar ni tarjetas de resumen. El aporte se guarda con estado `pending`. No se incorpora a `persons`, `publicPersons` ni al árbol hasta que el administrador lo apruebe. La aprobación verifica los datos, duplicados, parentescos y ciclos y publica de forma atómica. Las propuestas rechazadas nunca se publican.

El botón **Administrar** inicia sesión con Google solo para `aleobustamante@gmail.com`. También se exige el rol `admin`, asignado mediante el script confiable de bootstrap. El correo por sí solo no otorga permisos, y asignar un rol a un correo diferente no le da acceso. No hay solicitudes de acceso, colaboradores con cuenta ni aprobación de usuarios.

## Editar desde un nodo y unir familiares

Al tocar o hacer clic en un nodo público se abre directamente **Proponer editar datos**. El visitante indica su nombre y envía la corrección, sin cuenta y sin modificar el árbol publicado. Los datos privados no se descargan al formulario público. La corrección queda pendiente de la revisión del administrador.

Con la sesión de administrador, cada nodo abre su ficha con **Editar datos** y **Unir con otro familiar**. También hay un botón global **Unir familiares**, y se puede arrastrar desde un conector de un nodo a otro para abrir la asignación del parentesco. Arrastrar por sí solo no publica: hay que elegir el tipo y guardar.

El formulario admite padre, madre, pareja o hijo/a indicando si el otro familiar es el padre o la madre. Muestra una frase con los dos nombres para revisar la dirección del vínculo. Conserva los vínculos ajenos a la operación. Si ya existe otro padre o madre, exige seleccionar explícitamente el reemplazo. También permite quitar un vínculo sin eliminar ninguna de las dos personas.

`manageRelationship` exige el correo propietario y el rol administrativo en el servidor. Valida referencias, autorrelaciones, duplicados y ciclos. La relación privada, su proyección pública y la auditoría se guardan atómicamente. Las operaciones son idempotentes y actualizan las revisiones afectadas para que una propuesta antigua no deshaga un parentesco más reciente. Los vínculos «Creo que...» permanecen privados hasta confirmarse.

## Arquitectura y privacidad

| Colección                                                   | Lectura desde el navegador                                              | Escritura         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| `publicPersons`                                             | Pública; exclusivamente `id`, `fullName`, `birthDate`                   | Backend           |
| `publicRelationships`                                       | Pública; exclusivamente `id`, `from`, `to`, `type`                      | Backend           |
| `persons`, `relationships`                                  | Solo administrador propietario                                          | Backend           |
| `members`                                                   | Registro propio; el rol debe coincidir además con el correo propietario | Backend confiable |
| `submissions`, `privacyRequests`                            | Solo administrador propietario                                          | Backend           |
| `auditLogs`, `mailOutbox`                                   | Solo administrador propietario                                          | Backend           |
| `rateLimits`, `imports`, `system`, `relationshipOperations` | Sin lectura desde clientes                                              | Backend           |

Las reglas no permiten escrituras directas desde ningún cliente, ni siquiera el administrador. `submitContribution` y `submitPrivacy` son funciones callable públicas protegidas con App Check productivo, validación, campo trampa y límites por origen. No requieren ni crean usuarios de Firebase Auth. Se usa un hash diario del origen en el backend para limitar a 10 aportes y 5 solicitudes de privacidad por hora; no se guarda la IP literal. Usuarios que comparten conexión pueden compartir el límite.

Las funciones administrativas verifican el token de Google, correo verificado del propietario y rol `admin` dentro de la transacción. Los antiguos registros `family_member` no otorgan acceso. Los datos privados no se descargan a visitantes ni se guardan en localStorage; no se habilita persistencia Firestore en disco. Fuentes y observaciones se muestran como texto, sin HTML arbitrario.

Cada formulario usa un UUID y un fingerprint del contenido: repetir exactamente el envío no crea registros ni notificaciones adicionales. No existe un listado público de propuestas ni consultas públicas a sus estados, contactos o datos privados. La respuesta pública es solo un acuse de recepción, aunque un envío anterior ya haya sido revisado.

Para correcciones se toman la revisión y los valores privados en el servidor. Un campo vacío conserva el dato existente: el visitante no puede borrar involuntariamente información que nunca vio. Los parentescos nuevos solo pueden seleccionar IDs públicos. El administrador puede retirar datos o vínculos desde su edición privada. Si la persona cambia después de recibir una propuesta, se rechaza la aprobación desactualizada.

Los cambios publicados leen y actualizan `system/graph`, serializando publicaciones concurrentes. Se validan referencias, padre/madre únicos, vínculos consigo mismo, duplicados y ciclos de ascendencia. Las decisiones repetidas son idempotentes; las contradictorias se rechazan. Cada operación queda auditada.

Las personas o vínculos hipotéticos quedan en la vista privada del administrador. Las relaciones públicas requieren certeza confirmada y ambos extremos publicados. No se infieren parentescos por apellidos. Las fechas admiten `DDMMYYYY`, `MMYYYY` o `YYYY`, además de los formatos con separadores. Se guardan como `YYYY-MM-DD`, `YYYY-MM` o `YYYY`, preservando la precisión sin inventar datos. Las fechas desconocidas pueden dejarse vacías. La cronología y los duplicados comparan los intervalos compatibles con esa precisión.

El árbol está pensado para una familia de tamaño moderado. Las validaciones y la visualización leen las personas y relaciones completas del árbol correspondiente. Cada importación admite hasta 100 personas y 100 vínculos. Para miles de personas sería necesario particionar estas operaciones.

## Pruebas

```sh
npm run build
npm test
npm run test:emulators
```

Las pruebas usan solo proyectos `demo-*`. Incluyen aportes y solicitudes de privacidad sin ninguna sesión Auth, nombre de quien carga obligatorio y sin verificar, fechas parciales, fotos pendientes, validación de imágenes y eliminación de EXIF, exclusividad del propietario, reglas privadas, rechazo de escrituras directas, publicaciones atómicas e idempotentes, propuestas competidoras, correcciones que conservan datos y vínculos privados, conflictos, duplicados, ciclos, hipótesis, importación, campo trampa y límites de abuso.

El workflow `ci.yml` compila y ejecuta pruebas unitarias y Emulator Suite con Node 22 y Java 21. No despliega. El correo real, App Check y Google productivo requieren configuración y verificación en el proyecto elegido.

## Importar datos existentes

Completar una copia privada de `data/tree.template.json`. **No subir datos familiares privados al repositorio.** Cada persona tiene un ID estable y `data`. Los parentescos deben estar documentados explícitamente:

```json
{
  "version": 1,
  "branches": [
    "Hecht",
    "Elkin",
    "Berger",
    "Feldman",
    "Bavor",
    "Pennese",
    "Posternak",
    "Bustamante"
  ],
  "persons": [],
  "relationships": []
}
```

El formulario ya no pide rama, observaciones ni fuentes; sus campos históricos se conservan internamente para no perder información importada. La selección de certeza se muestra como «Confirmada» o «Creo que...». No se exige un checkbox de consentimiento para enviar.

Campos del importador en `data`: `fullName` obligatorio; `birthDate`, `birthPlace`, `deathDate`, `deathPlace`, `observations`, `sources` cadenas opcionales; `deceased` booleano; `branch` una de las ocho ramas o `null`; `certainty` `confirmed` o `hypothesis`. Si hay fecha o lugar de fallecimiento, `deceased` debe ser `true`.

Campos de relación: `id`, `from`, `to`, `type` (`father`, `mother`, `partner`), `certainty` (`confirmed`, `hypothesis`). En padre/madre, `from` es el progenitor y `to` el hijo. Los vínculos de pareja no tienen dirección genealógica. Los dos extremos deben existir en el archivo; mantener IDs de relaciones estables para posteriores actualizaciones. La importación es un upsert, no elimina registros omitidos. Para eliminar o cambiar parentescos publicados, usar el panel.

```sh
npm run import:tree -- /ruta/privada/arbol.json
# Escribe solo con --apply y con un ADMIN_UID existente autorizado:
GCLOUD_PROJECT=demo-mi-arbol \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
ADMIN_UID=UID_DEL_ADMIN \
npm run import:tree -- /ruta/privada/arbol.json --apply
```

La misma carga normalizada se registra por SHA-256: repetirla no cambia revisiones ni crea personas, vínculos o auditorías adicionales. El importador vuelve a validar el árbol combinado en el servidor. Las fotos opcionales se eligen como JPG, PNG o WebP (máximo 10 MB), se reducen a JPEG de hasta 512 px y 180.000 caracteres de data URL y se vuelven a validar y procesar en el servidor con Sharp, eliminando metadatos. Las fotos pendientes se guardan separadas en `submissionPhotos`, solo para el administrador. La aprobación copia la foto a `personPhotos` y, si la persona está confirmada, a `publicPersonPhotos` en la misma transacción. No se habilitó Firebase Storage ni otro servicio adicional. La proyección `publicPersons` sigue teniendo exclusivamente nombre y fecha; las fotos se consultan por separado.

Los respaldos de administración incluyen fotos, datos privados y de moderación; son para custodia administrativa y no se publican. El formato del respaldo completo no es el formato de carga: trasladar únicamente las personas y relaciones al esquema anterior si se restaura un árbol.

## Configuración productiva y despliegue

Repositorio: https://github.com/LeonelBustamante/mi-arbol. El propietario autorizó publicar únicamente el código y desplegar en GitHub Pages. El proyecto elegido es `mi-arbol-19103`; su configuración pública está cargada en las variables de Actions. No se habilitaron servicios pagos. Antes de activar facturación hay que confirmar sus costos. La publicación productiva sigue pendiente de completar el backend y la verificación final.

1. Crear o seleccionar el proyecto Firebase. Registrar una app web y obtener su configuración pública. Habilitar Google en Authentication y crear Firestore. Cloud Functions requiere un plan que permita su despliegue; revisar facturación y presupuestos antes de habilitarlo.
2. Configurar App Check para la app con reCAPTCHA Enterprise y el dominio final. Agregar la clave pública `VITE_FIREBASE_APPCHECK_SITE_KEY`. Activar enforcement de Firestore después de validar métricas. En Functions el enforcement ya está activo en el código productivo.
3. Agregar el dominio exacto de GitHub Pages (`USUARIO.github.io`) y, si corresponde, el dominio personalizado a Authentication → Settings → Authorized domains. En desarrollo con Firebase real, agregar `localhost` explícitamente. Configurar OAuth para el dominio de autenticación elegido.
4. Copiar la configuración a `.env.local` para el build local o a **Repository → Settings → Secrets and variables → Actions → Variables** para Pages. Todas las variables `VITE_*` son públicas. `VITE_BASE_PATH=/NOMBRE_REPOSITORIO/`; para `USUARIO.github.io` o dominio propio, `/`. El workflow deriva el nombre del repositorio si no se define; en repositorios de usuario es obligatorio sobrescribirlo a `/`.
5. Elegir un dominio remitente verificado en Resend. Guardar `RESEND_API_KEY` en Secret Manager mediante `npx firebase functions:secrets:set RESEND_API_KEY --project ID_PROYECTO`. No incluir el valor en `.env`, GitHub ni el frontend.
6. Copiar `functions/.env.example` a `functions/.env.ID_PROYECTO` y configurar `APP_URL=https://USUARIO.github.io/NOMBRE_REPOSITORIO/` y `MAIL_FROM` con remitente verificado. El destino es `aleobustamante@gmail.com`. Nunca hay aprobaciones por enlaces públicos: el enlace abre `/#/admin` y exige autenticación y rol.
7. Tras la confirmación, desplegar backend y reglas: `npx firebase deploy --only firestore:rules,firestore:indexes,functions --project ID_PROYECTO`. No hay despliegue automático del backend.
8. Iniciar sesión con Google usando `aleobustamante@gmail.com`. Con credenciales administrativas de confianza (`gcloud auth application-default login`, sin archivos de claves en el proyecto), ejecutar primero la vista previa de `GCLOUD_PROJECT=ID_PROYECTO npm run admin:bootstrap` y luego `-- --apply`. No hay lista de administradores ni elevación de roles en el frontend.
9. GitHub → Settings → Pages → Source: GitHub Actions. El workflow `pages.yml` es **manual** (`workflow_dispatch`) para evitar publicar antes de la confirmación. Configurar un revisor del environment `github-pages` si se necesita aprobación antes de cada publicación. Ejecutar “Publicar en GitHub Pages (manual)” solo cuando se autorice.
10. Verificar en producción: sesión pública sin campos privados (incluyendo solicitudes REST), aportes sin sesión y correo, Google Sign-In únicamente del administrador, revisión, aprobación, actualización del árbol y exportación. Probar teléfono real y dominio final.

### Correo y operación

Las transacciones agregan un registro a `mailOutbox`. Un trigger de Cloud Functions envía texto con identidad y enlace administrativo usando Resend, guarda el resultado y reintenta errores. Usa `Idempotency-Key` para deduplicar entregas dentro de la ventana del proveedor. El panel muestra estados de correo; configurar alertas de Cloud Logging para fallos persistentes y revisar cuotas. La entrega exactamente una vez no está garantizada si un fallo supera la ventana de deduplicación del proveedor.

Las solicitudes de privacidad están disponibles sin iniciar sesión, mediante formulario público o correo. El administrador puede corregir o eliminar una persona y sus vínculos y registrar la resolución. Las auditorías y propuestas pueden contener versiones anteriores: una solicitud de eliminación exige revisar también esos registros y las copias de respaldo según corresponda; no se promete una eliminación total automática.

## Referencias técnicas

- [Firebase: funciones callable y tokens](https://firebase.google.com/docs/functions/callable)
- [Firebase: autorización mediante reglas y roles](https://firebase.google.com/docs/rules/rules-and-auth)
- [Firebase: transacciones](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firebase: App Check en funciones](https://firebase.google.com/docs/app-check/cloud-functions)
- [React Flow](https://reactflow.dev/learn)
- [Vite: despliegue en GitHub Pages](https://vite.dev/guide/static-deploy)
