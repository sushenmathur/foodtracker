// Async key-value storage backed by localStorage.
// Mirrors the window.storage API the Tracker component was written against:
//   get(key)   -> { key, value } | null
//   set(key, value)
//   delete(key)
//   list(prefix) -> { keys: string[] }
const NAMESPACE = "foodtracker:";

const storage = {
  async get(key) {
    const value = localStorage.getItem(NAMESPACE + key);
    return value === null ? null : { key, value };
  },
  async set(key, value) {
    localStorage.setItem(NAMESPACE + key, value);
  },
  async delete(key) {
    localStorage.removeItem(NAMESPACE + key);
  },
  async list(prefix = "") {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NAMESPACE + prefix)) {
        keys.push(k.slice(NAMESPACE.length));
      }
    }
    return { keys: keys.sort() };
  },
};

if (!window.storage) {
  window.storage = storage;
}

export default storage;
