# Agencia Shein

Aplicación web de Agencia Shein con frontend responsive, autenticación mediante misión pública de Habbo, API Node.js y MySQL 8.

## Desarrollo local

1. Para la demo no necesitas crear un archivo `.env`.
2. Levanta la aplicación con `docker compose up --build`.
3. Abre `http://localhost:3000`.

Para desplegar la demostración con acceso simulado:

```env
DEMO_MODE=true
```

En este modo cualquier nombre de Habbo con formato válido obtiene acceso de propietario a las vistas demostrativas. La interfaz indica claramente que las operaciones son simuladas.

La aplicación crea las tablas automáticamente al iniciar. `BOOTSTRAP_OWNER` define el primer propietario; si el usuario ya existe como pendiente, se eleva a propietario durante el arranque.

## Despliegue en Coolify (Oracle VPS)

1. Crea un recurso desde el repositorio y selecciona **Docker Compose**. Coolify utilizará `docker-compose.yml`, que contiene únicamente la demo.
2. Para esta demo no hay variables obligatorias ni dependencia de MySQL.
3. Asigna el dominio al servicio `app`, puerto `3000`, y activa HTTPS en Coolify.

La versión completa con MySQL se conserva en `docker-compose.full.yml`. Para utilizarla posteriormente, configura sus secretos y selecciónala expresamente en Coolify.

Para convertirla posteriormente en una aplicación real, configura `DEMO_MODE=false`, mantén `ALLOW_DEMO_VERIFICATION=false` y usa contraseñas distintas para MySQL root y la aplicación.

## API principal

- `GET /api/health`: salud de aplicación y MySQL.
- `POST /api/auth/challenge`: genera la misión temporal.
- `POST /api/auth/verify`: comprueba el perfil público y crea la sesión.
- `GET /api/session`: usuario y vistas permitidas.
- `GET /api/members`: directorio paginado.
- `PATCH /api/members/:id`: actualiza rol o estado (administración).
- `GET/PUT /api/settings`: configuración persistente.

Las contraseñas de Habbo no se solicitan. La cookie de sesión es `HttpOnly`, `SameSite=Strict` y segura en producción.
