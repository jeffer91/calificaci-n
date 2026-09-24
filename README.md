# Encuesta de satisfacción estudiantil

Sistema con dos accesos públicos:

- Estudiantes: https://jeffer91.github.io/calificaci-n/estudiantes/
- Administrador: https://jeffer91.github.io/calificaci-n/administrador/

## Arquitectura

- GitHub Pages: interfaz.
- Firebase UTET / Firestore: consulta del estudiante por cédula.
- Neon Postgres: almacenamiento de encuestas y evaluaciones.
- Neon Functions + AI Gateway: clasificación automática de comentarios.
- IA principal: gpt-oss-20b.
- IA de respaldo: meta-llama-3.3-70b-instruct.

## Flujo estudiante

Cédula → datos automáticos desde Firestore → búsqueda predictiva de área → calificación → problemas por categorías → comentario → envío.

## Panel administrador

Incluye indicadores, promedio de satisfacción, casos críticos detectados por IA, estadísticas por área, problemas frecuentes, filtros y respuestas individuales.

## Seguridad

La cédula no se almacena en texto plano en Neon: la función guarda un hash. Los datos de contacto solo se guardan cuando el estudiante solicita seguimiento. La conexión a Neon y las credenciales de IA permanecen en el backend.

## Backend

El código está en backend/. Para activarlo hay que desplegar la función en el proyecto Neon, ejecutar backend/schema.sql y colocar la URL resultante en assets/config.js.
