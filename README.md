# Encuesta de satisfacción estudiantil · ITSQMET

Sistema institucional de encuesta con dos accesos públicos:

- Estudiantes: https://jeffer91.github.io/calificaci-n/estudiantes/
- Administrador: https://jeffer91.github.io/calificaci-n/administrador/

## Arquitectura

- **GitHub Pages:** interfaz pública.
- **Firebase UTET / Firestore:** consulta del estudiante por cédula.
- **Neon Postgres:** almacenamiento de encuestas y evaluaciones.
- **Neon Functions:** API de envío y administración.
- **Neon AI Gateway:** clasificación automática de respuestas.
- **IA principal:** `gpt-oss-20b`.
- **IA de respaldo:** `meta-llama-3-3-70b-instruct`.
- **Fallback local:** reglas básicas si los modelos de IA no responden.

## Flujo del estudiante

1. Ingresa su cédula.
2. La aplicación consulta sus datos institucionales en Firebase UTET.
3. Puede registrar:
   - **Lo que hicieron bien:** de 0 a 2 áreas.
   - **Lo que podemos mejorar:** de 0 a 2 áreas.
4. El comentario es opcional.
5. Revisa y envía.
6. La API valida nuevamente la información antes de almacenarla.

## Seguridad y privacidad

- La cédula no se almacena en texto plano en Neon.
- El identificador del estudiante se genera mediante **HMAC-SHA256** con `HASH_PEPPER`.
- Los datos de contacto solo se almacenan cuando el estudiante solicita seguimiento.
- El panel administrativo usa una clave privada `ADMIN_KEY`, validada en el backend.
- La API limita CORS al origen `https://jeffer91.github.io`.
- Los secretos **no deben guardarse en este repositorio**.

## Backend Neon

El backend se encuentra en `backend/`.

Variables privadas requeridas en el despliegue:

- `ADMIN_KEY`: clave segura para el panel administrativo.
- `HASH_PEPPER`: valor aleatorio largo utilizado para anonimizar la cédula.

Neon inyecta automáticamente `DATABASE_URL` en la Function. El AI Gateway también se declara en `backend/neon.ts`.

La función incluye un endpoint de diagnóstico:

```
GET /health
```

Debe devolver `ok: true`, `database: true`, `adminConfigured: true` y `hashPepperConfigured: true` antes de habilitar la aplicación.

## Despliegue de Neon

Desde la carpeta `backend`, con Neon CLI autenticado y el proyecto correcto vinculado:

```bash
npm install
neon deploy
neon functions get survey
```

El último comando devuelve `invocation_url`. Esa URL debe colocarse en:

```js
// assets/config.js
apiBase: "https://...neon.tech"
```

Mientras `apiBase` esté vacío, la interfaz muestra que Neon todavía no está enlazado y bloquea el envío.

## Base de datos

La Function crea de forma idempotente las tablas e índices requeridos cuando recibe la primera operación. También se conserva `backend/schema.sql` como referencia del esquema.

Tablas principales:

- `surveys`
- `evaluations`

## Panel administrador

El panel presenta:

- total de encuestas;
- reconocimientos;
- aspectos por mejorar;
- promedio de satisfacción;
- casos de severidad alta;
- estadísticas por área;
- categorías detectadas por IA;
- filtros y búsqueda;
- respuestas individuales.

## Comprobación final de producción

Antes de usar la encuesta con estudiantes deben verificarse estas cinco condiciones:

1. GitHub Pages desplegado correctamente.
2. Consulta de estudiante en Firebase funcionando.
3. Neon Function `survey` desplegada.
4. `/health` completamente saludable.
5. `assets/config.js` apuntando al `invocation_url` real de Neon.
