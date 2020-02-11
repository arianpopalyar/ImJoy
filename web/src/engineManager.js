import { randId, assert } from "./utils.js";
import { evil_engine } from "./evilEngine.js";

export class EngineManager {
  constructor({ event_bus = null, config_db = null, client_id = null }) {
    this.event_bus = event_bus;
    this.config_db = config_db;
    assert(this.event_bus);
    assert(this.config_db, "config database is not available");
    this.client_id = client_id || randId();
    this.engines = [];
    this.engine_factories = [];
  }

  async init() {
    this.register(evil_engine, true);
  }

  matchEngineByType(pluginType) {
    return this.engines.filter(engine => {
      return engine.pluginType === pluginType;
    });
  }

  findEngine(plugin_config) {
    const egs = this.engines.filter(engine => {
      return plugin_config.type && engine.pluginType === plugin_config.type;
    });

    if (!egs || egs.length <= 0) {
      return null;
    }

    if (plugin_config.engine_mode === "auto") {
      return egs.filter(eg => {
        return eg.connected;
      })[0];
    }

    return egs.filter(eg => {
      return eg.name === plugin_config.engine_mode;
    })[0];
  }

  getEngineByUrl(url) {
    for (let e of this.engines) {
      if (e.url === url) {
        return e;
      }
    }
    return null;
  }

  async register(engine_, disable_heartbeat) {
    const engine = Object.assign({}, engine_);
    // backup the engine api
    engine.api = engine_;
    if (engine_ && engine_ === evil_engine) {
      // make an exception for localhost debugging
      if (
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost"
      ) {
        engine._is_evil = false;
      } else {
        engine._is_evil = true;
      }
    } else {
      engine._is_evil = false;
    }
    for (let i = 0; i < this.engines.length; i++) {
      if (this.engines[i].name === engine.name) {
        this.engines.splice(i, 1);
        break;
      }
    }
    engine.connected = false;
    engine.engine_status = engine.engine_status || {};
    if (engine.getEngineInfo) {
      Promise.resolve(engine.getEngineInfo()).then(engine_info => {
        engine.engine_info = engine_info;
      });
    }

    const check_connectivity = async () => {
      const live = await engine.heartbeat();
      if (!engine.connected && live) {
        engine.connected = true;
        this.event_bus.emit("engine_connected", engine);
      } else if (engine.connected && !live) {
        engine.connected = false;
        this.event_bus.emit("engine_disconnected", engine);
        for (let p of engine._plugins) {
          p.terminate();
        }
        // clearInterval(timerId);
      } else {
        engine.connected = live;
      }
    };

    engine._plugins = [];
    engine.registerPlugin = p => {
      engine._plugins.push(p);
    };
    this.engines.push(engine);
    engine.connect();

    await check_connectivity();
    if (!disable_heartbeat) {
      engine.heartbeat_timer = setInterval(check_connectivity, 5000);
    }
  }

  unregister(engine) {
    engine = this.getEngineByUrl(engine.url);
    if (!engine) throw `Engine ${engine.url} not found.`;
    const index = this.engines.indexOf(engine);
    for (let p of engine._plugins) {
      p.terminate();
    }
    if (index > -1) {
      this.engines.splice(index, 1);
    }
    if (engine.heartbeat_timer) clearInterval(engine.heartbeat_timer);
    this.event_bus.emit("engine_disconnected", engine);
  }

  registerFactory(factory_) {
    const factory = Object.assign({}, factory_);
    //backup the factory api
    factory.api = factory_;
    for (let i = 0; i < this.engine_factories.length; i++) {
      if (this.engine_factories[i].name === factory.name) {
        this.engine_factories.splice(i, 1);
        break;
      }
    }
    this.engine_factories.push(factory);
  }

  unregisterFactory(factory) {
    factory = this.getFactory(factory.name);
    const index = this.engine_factories.indexOf(factory);
    if (index > -1) {
      this.engine_factories.splice(index, 1);
    }
  }

  getFactory(name) {
    for (let e of this.engine_factories) {
      if (e.name === name) {
        return e;
      }
    }
    return null;
  }

  destroy() {
    for (let e of this.engines) {
      this.unregister(e);
    }
  }
}
