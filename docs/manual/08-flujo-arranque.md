# 08 — Flujo de arranque y Gate Chain

## Gate chain completo

Al arrancar Houston, la UI pasa por una cadena de "gates" (puertas) en secuencia. Cada gate bloquea el resto de la app hasta que su condición se cumple. Desde la tropicalización Lunaria, el gate de la intro es el primero en ejecutarse.

```tsx
// app/src/main.tsx (simplificado)
<QueryClientProvider>
  <I18nextProvider>
    <TooltipProvider>
      <StartupEffects>          {/* inicializa logging, Sentry, etc. */}
        <LunariaIntroGate>      {/* ← NUEVO: intro arcade first-run */}
          <ConnectionGate>      {/* espera que el host responda */}
            <EngineGate>        {/* espera handshake del motor */}
              <LanguageGate>    {/* carga i18n */}
                <DisclaimerGate>{/* ToS aceptado? */}
                  <App />       {/* la app real */}
                </DisclaimerGate>
              </LanguageGate>
            </EngineGate>
          </ConnectionGate>
        </LunariaIntroGate>
      </StartupEffects>
    </TooltipProvider>
  </I18nextProvider>
</QueryClientProvider>
```

### Responsabilidades de cada gate

| Gate | Qué espera | Qué muestra mientras espera |
|------|-----------|----------------------------|
| `StartupEffects` | — | Inicializa efectos globales al montar |
| `LunariaIntroGate` | Flag de localStorage | Intro arcade pixel-art (solo primer arranque) |
| `ConnectionGate` | `GET /v3/ping` responde 200 | Pantalla de "connecting..." |
| `EngineGate` | `whenEngineReady()` resuelve | Texto "Starting..." (el loader que reemplaza la intro) |
| `LanguageGate` | Archivos i18n cargados | Spinner |
| `DisclaimerGate` | Usuario aceptó ToS | Modal de aceptación |

---

## LunariaIntroGate: lógica detallada

```typescript
// lunaria-intro-gate.tsx
export function LunariaIntroGate({ children }: { children: ReactNode }) {
  // useState con initializer síncrona (lee localStorage ANTES del primer render)
  const [showIntro, setShowIntro] = useState(() => !hasSeenLunariaIntro());

  if (!showIntro) return <>{children}</>;  // passthrough si ya vio la intro

  return (
    <LunariaArcadeIntro
      onEnter={() => {
        markLunariaIntroSeen();  // escribe flag en localStorage
        setShowIntro(false);      // deja pasar al resto de la cadena
      }}
    />
  );
}
```

**Por qué es el gate más externo:** Así la intro corre ANTES de que ConnectionGate bloquee esperando el host. El motor arranca en paralelo (el proceso sidecar existe desde que Tauri spawna); la intro corre a su propio ritmo mientras el motor bootea.

---

## Flag de localStorage

```typescript
// state.ts
const LUNARIA_INTRO_SEEN_KEY = "houston.lunaria.introSeen";
const SEEN_VALUE = "1";

export function hasSeenLunariaIntro(): boolean {
  try {
    return localStorage.getItem(LUNARIA_INTRO_SEEN_KEY) === SEEN_VALUE;
  } catch {
    // localStorage puede lanzar en contextos restrictivos (p.ej. modo incógnito estricto)
    return true; // fail-safe: si no podemos leer, asumimos que ya vio la intro
                 // (no queremos atrapar al usuario en un loop si el store falla)
  }
}

export function markLunariaIntroSeen(): void {
  try {
    localStorage.setItem(LUNARIA_INTRO_SEEN_KEY, SEEN_VALUE);
  } catch {
    // silencioso: si no podemos escribir, al menos la intro corrió esta vez
  }
}
```

**Para ver la intro de nuevo** (desarrollo/testing):
```javascript
// En DevTools del webview de Tauri:
localStorage.removeItem("houston.lunaria.introSeen")
// Luego recargar la ventana (Ctrl+R)
```

---

## Boot decoupling: la intro no bloquea el motor

Este es el diseño más importante de la intro. El motor Rust/TS arranca como proceso sidecar en paralelo con React. Si el usuario presiona START antes de que el motor esté listo:

```typescript
// lunaria-arcade-intro.tsx
const enter = useCallback(() => {
  if (enteredRef.current) return;  // guard: solo entra una vez
  enteredRef.current = true;

  if (isEngineReady()) {
    onEnter();  // ya listo → entra inmediatamente
    return;
  }

  // Motor no listo aún → modo booting
  setBooting(true);
  void whenEngineReady().then(onEnter);  // entra automáticamente cuando listo
}, [onEnter]);
```

Cuando `booting = true`, la intro reemplaza el botón "PRESS START" por el mensaje `"WAKING LUNARIA..."` (localizado). El usuario no ve el loader gris de `EngineGate` nunca.

### Funciones de engine readiness

```typescript
// app/src/lib/engine.ts (existentes en Houston base)

// Retorna true si el motor ya completó el handshake inicial
export function isEngineReady(): boolean

// Promise que resuelve cuando el motor esté listo
// (inmediatamente si ya lo está; con delay si no)
export function whenEngineReady(): Promise<void>
```

Estas funciones existen en Houston base y no fueron modificadas. La intro las consume directamente.

---

## Interacción con StartupEffects

`StartupEffects` es un componente de efectos puros (no renderiza UI):

```tsx
export function StartupEffects({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Inicializa Sentry, logging, global error handlers
    // Registra el FS watcher para reactivity
    // ...
  }, []);
  return <>{children}</>;
}
```

La intro corre DENTRO de `StartupEffects`, así que Sentry y el logging ya están activos cuando la intro está en pantalla. Si la intro crashea, Sentry lo captura.

---

## Tests del gate

```typescript
// app/tests/lunaria-intro-state.test.ts
// Usa node --experimental-strip-types --test (sin transpilador)

class MemoryStorage { ... }  // simula Web Storage en Node

test("fresh install → hasSeenLunariaIntro returns false", ...)
test("after marking → hasSeenLunariaIntro returns true", ...)
test("marking is idempotent", ...)
test("hostile store (throws) → hasSeenLunariaIntro returns true", ...)
```

Los 4 tests pasan. El cuarto verifica el fail-safe: si localStorage lanza (p.ej. en un webview con políticas restrictivas), la función retorna `true` para no atrapar al usuario.

---

## Diagrama de tiempo en primer arranque

```
t=0    Tauri abre la ventana
t=0    React monta, LunariaIntroGate detecta primer arranque
t=0    Motor sidecar empieza a bootear (en paralelo, proceso separado)
t=0.1  Intro arcade visible: estrellas, luna, lore animado
t=1.5  Lore completo visible, "PRESS START" aparece parpadeando
t=2    Usuario presiona cualquier tecla
t=2    isEngineReady()? → probablemente Sí (boot ~1-3s en Windows)
t=2    onEnter() → ConnectionGate → EngineGate → resto de la app
       (Si motor no listo aún: "WAKING LUNARIA..." hasta que listo)
```

El usuario nunca ve el texto "Starting..." del EngineGate original.
