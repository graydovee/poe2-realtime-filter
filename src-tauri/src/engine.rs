use rquickjs::{Context, Function, Object, Runtime};
use serde::{de::DeserializeOwned, Serialize};

pub type Result<T> = std::result::Result<T, String>;

struct Engine {
    context: Context,
    _runtime: Runtime,
}

impl Engine {
    fn new() -> rquickjs::Result<Self> {
        let runtime = Runtime::new()?;
        runtime.set_memory_limit(128 * 1024 * 1024);
        let context = Context::full(&runtime)?;
        context.with(|ctx| ctx.eval::<(), _>(include_str!("../generated/engine.js")))?;
        Ok(Self {
            context,
            _runtime: runtime,
        })
    }
}

thread_local! {
    static ENGINE: std::cell::RefCell<Option<Engine>> = const { std::cell::RefCell::new(None) };
}

pub fn call<T: DeserializeOwned>(method: &str, payload: impl Serialize) -> Result<T> {
    let payload = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    ENGINE.with(|engine| {
        let mut engine = engine.borrow_mut();
        if engine.is_none() {
            *engine = Some(Engine::new().map_err(|error| error.to_string())?);
        }
        let json = engine.as_ref().unwrap().context.with(|ctx| {
            let module: Object<'_> = ctx
                .globals()
                .get("desktopEngine")
                .map_err(|error| error.to_string())?;
            let dispatch: Function<'_> =
                module.get("dispatch").map_err(|error| error.to_string())?;
            dispatch
                .call::<_, String>((method, payload.as_str()))
                .map_err(|error| {
                    if error.is_exception() {
                        let exception = ctx.catch();
                        if let Some(object) = exception.as_object() {
                            if let Ok(message) = object.get::<_, String>("message") {
                                return message;
                            }
                        }
                    }
                    error.to_string()
                })
        })?;
        serde_json::from_str(&json).map_err(|error| error.to_string())
    })
}
